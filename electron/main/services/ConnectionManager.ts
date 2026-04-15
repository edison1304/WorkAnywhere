import { EventEmitter } from 'events'
import { SSHService } from './SSHService'
import { LocalService } from './LocalService'
import { RemoteControlService } from './RemoteControlService'
import type { Project, ConnectionConfig, AppConfig } from '../../../shared/types'

export type AnyConnection = SSHService | LocalService | RemoteControlService

interface ConnectionEntry {
  key: string
  connection: AnyConnection
  config: ConnectionConfig    // original config for reconnection
  type: 'ssh' | 'local'
  projectIds: Set<string>    // projects sharing this connection
  reconnecting: boolean
}

/**
 * ConnectionManager — manages per-project connections.
 *
 * Connections are keyed by server identity (host:port:user for SSH, 'local' for local).
 * Multiple projects on the same server share one connection.
 * Connections are created lazily on first use.
 */
export class ConnectionManager extends EventEmitter {
  private entries = new Map<string, ConnectionEntry>()
  private appConfig: AppConfig | null = null

  setAppConfig(config: AppConfig): void {
    this.appConfig = config
    // Update existing connections
    for (const entry of this.entries.values()) {
      if (entry.connection.setClaudeConfig) {
        entry.connection.setClaudeConfig(config)
      }
    }
  }

  getAppConfig(): AppConfig | null {
    return this.appConfig
  }

  /**
   * Get or create a connection for a project.
   * Lazy: connects if not already connected.
   */
  async getConnection(project: Project): Promise<AnyConnection> {
    const key = this.connectionKey(project.connection)

    // Incomplete SSH config → fall back to any available SSH connection
    if (key === '__incomplete_ssh__') {
      for (const entry of this.entries.values()) {
        if (entry.type === 'ssh' && entry.connection.isConnected()) {
          entry.projectIds.add(project.id)
          return entry.connection
        }
      }
      throw new Error('No SSH connection available and project has incomplete SSH config. Reconnect to server first.')
    }

    const existing = this.entries.get(key)

    if (existing) {
      existing.projectIds.add(project.id)
      // If connection died, recreate
      if (!existing.connection.isConnected() && !existing.reconnecting) {
        const newConn = await this.createConnection(project.connection)
        if (newConn instanceof SSHService) {
          newConn.on('disconnected', () => {
            if (!existing.reconnecting) this.handleDisconnect(key, existing)
          })
        }
        existing.connection = newConn
        this.emit('connection:restored', { key, projectIds: [...existing.projectIds] })
      }
      return existing.connection
    }

    // Create new connection
    const conn = await this.createConnection(project.connection)
    const entry: ConnectionEntry = {
      key,
      connection: conn,
      config: project.connection,
      type: project.connection.type,
      projectIds: new Set([project.id]),
      reconnecting: false,
    }
    this.entries.set(key, entry)

    // Monitor connection health (SSH and Remote both emit 'disconnected')
    if (conn instanceof SSHService || conn instanceof RemoteControlService) {
      conn.on('disconnected', () => {
        if (!entry.reconnecting) {
          this.handleDisconnect(key, entry)
        }
      })
    }

    this.emit('connected', { projectId: project.id, key })
    return conn
  }

  /**
   * Check if a project has an active connection (without creating one).
   */
  isConnected(project: Project): boolean {
    const key = this.connectionKey(project.connection)
    const entry = this.entries.get(key)
    return !!entry && entry.connection.isConnected()
  }

  /**
   * Get an existing connection for a project (without creating).
   * Returns null if not connected.
   */
  getExisting(project: Project): AnyConnection | null {
    const key = this.connectionKey(project.connection)
    const entry = this.entries.get(key)
    if (entry && entry.connection.isConnected()) return entry.connection
    return null
  }

  /**
   * Get connection by projectId (searches all entries).
   */
  getByProjectId(projectId: string): AnyConnection | null {
    for (const entry of this.entries.values()) {
      if (entry.projectIds.has(projectId) && entry.connection.isConnected()) {
        return entry.connection
      }
    }
    return null
  }

  /**
   * Disconnect a specific project. If no other projects use the connection, close it.
   */
  async disconnect(projectId: string): Promise<void> {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.projectIds.has(projectId)) {
        entry.projectIds.delete(projectId)
        if (entry.projectIds.size === 0) {
          entry.connection.disconnect()
          this.entries.delete(key)
        }
        this.emit('disconnected', { projectId, key })
        return
      }
    }
  }

  /**
   * Disconnect all connections.
   */
  disconnectAll(): void {
    for (const entry of this.entries.values()) {
      entry.connection.disconnect()
    }
    this.entries.clear()
  }

  /**
   * Get connection status for all projects.
   */
  getStatus(): Array<{ projectId: string; key: string; type: string; connected: boolean }> {
    const result: Array<{ projectId: string; key: string; type: string; connected: boolean }> = []
    for (const entry of this.entries.values()) {
      for (const pid of entry.projectIds) {
        result.push({
          projectId: pid,
          key: entry.key,
          type: entry.type,
          connected: entry.connection.isConnected(),
        })
      }
    }
    return result
  }

  /**
   * Check Claude CLI availability on a project's server.
   */
  async checkClaude(project: Project): Promise<{ available: boolean; version?: string }> {
    const conn = await this.getConnection(project)
    return conn.checkClaude()
  }

  // ─── Reconnection ───

  private async handleDisconnect(key: string, entry: ConnectionEntry): Promise<void> {
    entry.reconnecting = true
    this.emit('connection:lost', { key, projectIds: [...entry.projectIds] })

    const maxRetries = 3
    const delays = [2000, 5000, 10000] // exponential backoff

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.emit('connection:reconnecting', { key, attempt, maxRetries })

      await new Promise(resolve => setTimeout(resolve, delays[attempt - 1] || 10000))

      try {
        const newConn = await this.createConnection(entry.config)

        // Monitor new connection too
        if (newConn instanceof SSHService) {
          newConn.on('disconnected', () => {
            if (!entry.reconnecting) {
              this.handleDisconnect(key, entry)
            }
          })
        }

        entry.connection = newConn
        entry.reconnecting = false
        this.emit('connection:restored', { key, projectIds: [...entry.projectIds] })
        return
      } catch {
        // Retry
      }
    }

    // All retries failed
    entry.reconnecting = false
    this.emit('connection:failed', { key, projectIds: [...entry.projectIds] })
  }

  // ─── Internal ───

  private connectionKey(config: ConnectionConfig): string {
    if (config.type === 'local') return 'local'
    if (config.type === 'remote') return `remote:${config.remote?.link || 'unknown'}`
    if (!config.ssh?.host) return '__incomplete_ssh__'
    return `ssh:${config.ssh.host}:${config.ssh.port || 22}:${config.ssh.username}`
  }

  private async createConnection(config: ConnectionConfig): Promise<AnyConnection> {
    if (config.type === 'local') {
      const local = new LocalService()
      if (this.appConfig) local.setClaudeConfig(this.appConfig)
      await local.connect()
      return local
    }

    if (config.type === 'remote') {
      const remote = new RemoteControlService()
      if (this.appConfig) remote.setClaudeConfig(this.appConfig)
      await remote.connect(config.remote!.link)
      return remote
    }

    if (!config.ssh?.host) {
      throw new Error('SSH config incomplete (missing host). Re-create the project with a valid SSH connection.')
    }
    const ssh = new SSHService()
    if (this.appConfig) ssh.setClaudeConfig(this.appConfig)
    await ssh.connect(config)
    return ssh
  }
}
