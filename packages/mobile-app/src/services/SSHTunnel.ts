import { NativeModules, NativeEventEmitter } from 'react-native'

/**
 * SSHTunnel — React Native bridge to native SSH + local port forwarding.
 *
 * Uses react-native-ssh-sftp under the hood.
 * Establishes an SSH connection and creates a local port forward:
 *   localhost:localPort → remoteHost:remotePort
 *
 * This allows the app to access the Gateway (running on the server at port 3847)
 * via http://localhost:3847 through the SSH tunnel.
 */

// react-native-ssh-sftp provides SSHClient
const { RNSSHClient } = NativeModules

export interface SSHConfig {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key'
  password?: string
  privateKey?: string
}

export type TunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export class SSHTunnel {
  private client: any = null
  private statusListeners = new Set<(status: TunnelStatus, error?: string) => void>()
  private _status: TunnelStatus = 'disconnected'
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private config: SSHConfig | null = null
  private localPort = 3847
  private remotePort = 3847

  get status(): TunnelStatus {
    return this._status
  }

  get gatewayUrl(): string {
    return `http://localhost:${this.localPort}`
  }

  onStatusChange(cb: (status: TunnelStatus, error?: string) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  private setStatus(status: TunnelStatus, error?: string): void {
    this._status = status
    for (const cb of this.statusListeners) cb(status, error)
  }

  /**
   * Connect via SSH and establish local port forwarding.
   * After this resolves, http://localhost:3847 reaches the server's Gateway.
   */
  async connect(config: SSHConfig): Promise<void> {
    this.config = config
    this.setStatus('connecting')

    try {
      // Create SSH connection
      if (config.authMethod === 'password') {
        this.client = await RNSSHClient.connectWithPassword(
          config.host,
          config.port,
          config.username,
          config.password,
        )
      } else {
        this.client = await RNSSHClient.connectWithKey(
          config.host,
          config.port,
          config.username,
          config.privateKey,
          '', // passphrase
        )
      }

      // Set up local port forwarding: localhost:3847 → server:3847
      await RNSSHClient.startLocalPortForward(
        this.client,
        this.localPort,
        'localhost',
        this.remotePort,
      )

      this.setStatus('connected')
      this.startKeepAlive()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('error', msg)
      throw err
    }
  }

  /**
   * Disconnect SSH tunnel.
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    try {
      if (this.client) {
        await RNSSHClient.disconnect(this.client)
      }
    } catch { /* ignore */ }

    this.client = null
    this.setStatus('disconnected')
  }

  /**
   * Auto-reconnect on connection drop.
   */
  private startKeepAlive(): void {
    // Ping every 30 seconds to keep connection alive
    const ping = async () => {
      if (this._status !== 'connected' || !this.client) return

      try {
        await RNSSHClient.execute(this.client, 'echo ping')
      } catch {
        // Connection lost — attempt reconnect
        this.setStatus('connecting')
        try {
          await this.disconnect()
          if (this.config) {
            await this.connect(this.config)
          }
        } catch {
          this.setStatus('error', 'Reconnection failed')
          // Retry in 5 seconds
          this.reconnectTimer = setTimeout(() => {
            if (this.config) this.connect(this.config).catch(() => {})
          }, 5000)
        }
      }
    }

    setInterval(ping, 30000)
  }

  /**
   * Execute a command on the remote server via SSH.
   * Useful for checking if Gateway is running, starting it, etc.
   */
  async exec(command: string): Promise<string> {
    if (!this.client) throw new Error('Not connected')
    return await RNSSHClient.execute(this.client, command)
  }

  /**
   * Check if Gateway is running on the server, start it if not.
   */
  async ensureGateway(): Promise<{ token: string }> {
    // Check if Gateway is already running
    const healthCheck = await this.exec(
      'curl -s http://localhost:3847/health 2>/dev/null || echo "not_running"'
    ).catch(() => 'not_running')

    if (healthCheck.includes('not_running') || !healthCheck.includes('"ok"')) {
      // Start Gateway on the server
      // Assumes gateway is installed at ~/.workanywhere/gateway/
      await this.exec(
        'cd ~/.workanywhere/gateway && nohup npx tsx src/server.ts > /tmp/gw.log 2>&1 &'
      ).catch(() => {
        // Gateway might not be installed — that's ok, user needs to set it up
      })

      // Wait for startup
      await new Promise(r => setTimeout(r, 3000))
    }

    // Read the gateway token
    const token = await this.exec('cat ~/.workanywhere/.gateway-token 2>/dev/null')
    if (!token.trim()) {
      throw new Error('Gateway token not found. Is the Gateway installed on the server?')
    }

    return { token: token.trim() }
  }
}
