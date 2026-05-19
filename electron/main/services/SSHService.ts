import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { EventEmitter } from 'events'
import { StringDecoder } from 'string_decoder'
import type { ConnectionConfig, AppConfig } from '../../../shared/types'
import type { ClaudeStreamEvent } from './ConnectionTypes'
import { readFileSync } from 'fs'
import { PersistentShell } from './PersistentShell'

export interface EngineExecConfig {
  command: string
  args: string[]
  env: Record<string, string>
  setupScript: string
}

export interface SSHSession {
  id: string
  channel: ClientChannel
  onData: (cb: (data: string) => void) => void
  onClose: (cb: () => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  close: () => void
}

export class SSHService extends EventEmitter {
  private client: Client | null = null
  private connected = false
  private sessions = new Map<string, SSHSession>()
  private persistentShell: PersistentShell | null = null
  private shellReconnecting = false
  // Track open dedicated channels (agents, PTYs, execChannel calls).
  // PersistentShell's single channel is NOT counted here.
  private activeChannels = 0
  private channelWaiters: Array<() => void> = []
  // Conservative limit — SSH default MaxSessions is 10. Reserve slots
  // for PersistentShell(1) + headroom(1).
  private readonly MAX_CHANNELS = 8
  public engines: Record<string, EngineExecConfig> = {
    claude: { command: 'claude', args: [], env: {}, setupScript: '' },
    opencode: { command: 'opencode', args: [], env: {}, setupScript: '' },
  }

  setClaudeConfig(appConfig: AppConfig): void {
    if (appConfig.claudeCommand) this.engines.claude.command = appConfig.claudeCommand
    if (appConfig.claudeArgs) this.engines.claude.args = appConfig.claudeArgs
    if (appConfig.claudeEnv) this.engines.claude.env = appConfig.claudeEnv
    if (appConfig.claudeSetupScript) this.engines.claude.setupScript = appConfig.claudeSetupScript
    if (appConfig.opencodeCommand) this.engines.opencode.command = appConfig.opencodeCommand
    if (appConfig.opencodeArgs) this.engines.opencode.args = appConfig.opencodeArgs
    if (appConfig.opencodeSetupScript) this.engines.opencode.setupScript = appConfig.opencodeSetupScript
  }

  // Build the shell prefix for an engine
  getShellPrefix(engine: string = 'claude'): string {
    const cfg = this.engines[engine] || this.engines.claude
    const parts: string[] = []
    if (cfg.setupScript) parts.push(cfg.setupScript)
    for (const [k, v] of Object.entries(cfg.env)) {
      parts.push(`export ${k}=${JSON.stringify(v)}`)
    }
    return parts.length > 0 ? parts.join(' && ') + ' && ' : ''
  }

  // Build command with custom path + args
  getEngineCmd(engine: string, extraArgs: string[]): string {
    const cfg = this.engines[engine] || this.engines.claude
    const allArgs = [...cfg.args, ...extraArgs]
    return `${cfg.command} ${allArgs.join(' ')}`
  }

  // Backward compat
  private getClaudeCmd(extraArgs: string[]): string {
    return this.getEngineCmd('claude', extraArgs)
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.type !== 'ssh' || !config.ssh) {
      throw new Error('SSH config required')
    }

    return new Promise((resolve, reject) => {
      this.client = new Client()

      const connectConfig: ConnectConfig = {
        host: config.ssh!.host,
        port: config.ssh!.port,
        username: config.ssh!.username,
        // Keep the connection alive — without these, NAT/firewall/load balancers
        // drop idle TCP connections (often after 60-300s of silence), killing
        // long-running agent channels while claude is "thinking" with no stdout.
        keepaliveInterval: 15_000,  // send keepalive every 15s
        keepaliveCountMax: 3,       // disconnect after 3 missed responses (45s)
        readyTimeout: 30_000,       // 30s to establish connection
      }

      if (config.ssh!.authMethod === 'key' && config.ssh!.keyPath) {
        const keyPath = config.ssh!.keyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '')
        connectConfig.privateKey = readFileSync(keyPath)
      } else if (config.ssh!.authMethod === 'password') {
        connectConfig.password = config.ssh!.password
        connectConfig.tryKeyboard = true
      } else if (config.ssh!.authMethod === 'agent') {
        connectConfig.agent = process.env.SSH_AUTH_SOCK
      }

      this.client.on('ready', () => {
        this.connected = true
        this.emit('connected')
        resolve()
      })

      this.client.on('error', (err) => {
        this.connected = false
        this.emit('error', err)
        reject(err)
      })

      this.client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        // Auto-respond with password for keyboard-interactive auth
        if (config.ssh!.password) {
          finish([config.ssh!.password])
        } else {
          finish([])
        }
      })

      this.client.on('close', () => {
        this.connected = false
        this.emit('disconnected')
      })

      this.client.connect(connectConfig)
    })
  }

  disconnect(): void {
    this.persistentShell?.destroy()
    this.persistentShell = null
    for (const session of this.sessions.values()) {
      session.close()
    }
    this.sessions.clear()
    this.activeChannels = 0
    // Wake all waiters so they can fail gracefully
    for (const w of this.channelWaiters) w()
    this.channelWaiters = []
    this.client?.end()
    this.client = null
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  // ─── Channel semaphore ───
  // Waits until a channel slot is available, then increments the counter.
  private async acquireChannel(): Promise<void> {
    if (this.activeChannels < this.MAX_CHANNELS) {
      this.activeChannels++
      console.log(`[SSH] Channel acquired (${this.activeChannels}/${this.MAX_CHANNELS})`)
      return
    }
    console.log(`[SSH] Channel limit reached (${this.activeChannels}/${this.MAX_CHANNELS}), waiting...`)
    await new Promise<void>(resolve => this.channelWaiters.push(resolve))
    this.activeChannels++
    console.log(`[SSH] Channel acquired after wait (${this.activeChannels}/${this.MAX_CHANNELS})`)
  }

  private releaseChannel(): void {
    this.activeChannels = Math.max(0, this.activeChannels - 1)
    console.log(`[SSH] Channel released (${this.activeChannels}/${this.MAX_CHANNELS})`)
    const next = this.channelWaiters.shift()
    if (next) next()
  }

  /** How many dedicated channel slots are available right now. */
  get availableChannels(): number {
    return this.MAX_CHANNELS - this.activeChannels
  }

  // ─── Persistent Shell management ───

  private async getOrCreateShell(): Promise<PersistentShell> {
    if (this.persistentShell?.isAlive) return this.persistentShell
    if (this.shellReconnecting) {
      // Wait for reconnection to complete
      await new Promise<void>(resolve => this.once('shell:ready', resolve))
      if (this.persistentShell?.isAlive) return this.persistentShell
      throw new Error('PersistentShell reconnection failed')
    }
    return this.createShell()
  }

  private async createShell(): Promise<PersistentShell> {
    if (!this.client || !this.connected) throw new Error('Not connected')
    this.shellReconnecting = true
    try {
      this.persistentShell = new PersistentShell(this.client, () => {
        // Shell died — auto-recreate on next exec()
        console.log('[SSHService] PersistentShell died, will recreate on next exec')
        this.persistentShell = null
      })
      await this.persistentShell.init()
      this.shellReconnecting = false
      this.emit('shell:ready')
      return this.persistentShell
    } catch (err) {
      this.shellReconnecting = false
      this.persistentShell = null
      throw err
    }
  }

  // Execute a short-lived command via the persistent shell channel.
  // All commands share ONE shell channel instead of opening a new channel each time.
  // IMPORTANT: Never falls back to execChannel — that would consume a dedicated
  // channel slot and cause deadlocks when agents are running.
  async exec(command: string, useLogin = false): Promise<string> {
    if (!this.client || !this.connected) throw new Error('Not connected')
    const finalCmd = useLogin ? `bash -lc ${JSON.stringify(command)}` : command

    // Retry up to 2 times: if PersistentShell is dead, recreate it
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const shell = await this.getOrCreateShell()
        return await shell.exec(finalCmd)
      } catch (err: any) {
        const msg = err.message || ''
        // Shell died or timed out — destroy and retry with a fresh shell
        if (msg.includes('dead') || msg.includes('timed out') || msg.includes('died') || msg.includes('reconnection')) {
          console.log(`[SSH exec] PersistentShell failed (${msg}), recreating (attempt ${attempt + 1}/3)`)
          this.persistentShell?.destroy()
          this.persistentShell = null
          // Small delay before retry to let SSH recover
          await new Promise(r => setTimeout(r, 500))
          continue
        }
        // Non-retryable error — propagate
        throw err
      }
    }
    throw new Error('PersistentShell failed after 3 attempts')
  }

  // Execute a command via a dedicated SSH channel.
  // Use this for long-running commands (e.g. claude CLI) that would block the
  // persistent shell queue. Also used as fallback when the persistent shell fails.
  // Respects the channel semaphore to avoid exceeding MaxSessions.
  async execChannel(command: string, useLogin = false): Promise<string> {
    if (!this.client || !this.connected) throw new Error('Not connected')
    const finalCmd = useLogin ? `bash -lc ${JSON.stringify(command)}` : command

    await this.acquireChannel()

    try {
      return await new Promise<string>((resolve, reject) => {
        this.client!.exec(finalCmd, (err, stream) => {
          if (err) {
            this.releaseChannel()
            return reject(err)
          }
          let output = ''
          let settled = false
          const settle = (fn: () => void) => { if (!settled) { settled = true; fn() } }
          const decoder = new StringDecoder('utf8')
          const decoderErr = new StringDecoder('utf8')

          stream.on('data', (data: Buffer) => { output += decoder.write(data) })
          stream.stderr.on('data', (data: Buffer) => { output += decoderErr.write(data) })
          stream.on('error', (e: Error) => {
            stream.destroy()
            this.releaseChannel()
            settle(() => reject(e))
          })
          stream.on('close', () => {
            output += decoder.end()
            output += decoderErr.end()
            stream.destroy()
            this.releaseChannel()
            settle(() => resolve(output))
          })
        })
      })
    } catch (err: any) {
      const msg = err?.message || String(err)
      if (msg.includes('Channel open failure')) {
        console.log(`[SSH execChannel] Channel open failure (should not happen with semaphore)`)
      }
      throw err
    }
  }

  // Spawn an interactive PTY session (for xterm.js)
  async spawnPTY(command: string, sessionId: string, cols = 120, rows = 30): Promise<SSHSession> {
    if (!this.client || !this.connected) throw new Error('Not connected')

    await this.acquireChannel()

    return new Promise((resolve, reject) => {
      this.client!.shell(
        { term: 'xterm-256color', cols, rows },
        (err, stream) => {
          if (err) { this.releaseChannel(); return reject(err) }

          const dataCallbacks: Array<(data: string) => void> = []
          const closeCallbacks: Array<() => void> = []

          stream.on('data', (data: Buffer) => {
            const str = data.toString()
            for (const cb of dataCallbacks) cb(str)
          })

          stream.on('error', (err: Error) => {
            console.error(`[PTY ${sessionId}] stream error:`, err.message)
            this.sessions.delete(sessionId)
            stream.destroy()
            this.releaseChannel()
            for (const cb of closeCallbacks) cb()
          })

          stream.on('close', () => {
            this.sessions.delete(sessionId)
            stream.destroy()
            this.releaseChannel()
            for (const cb of closeCallbacks) cb()
          })

          // Send the command to start
          stream.write(command + '\n')

          const session: SSHSession = {
            id: sessionId,
            channel: stream,
            onData: (cb) => { dataCallbacks.push(cb) },
            onClose: (cb) => { closeCallbacks.push(cb) },
            write: (data) => { stream.write(data) },
            resize: (c, r) => { stream.setWindow(r, c, 0, 0) },
            close: () => { stream.close() },
          }

          this.sessions.set(sessionId, session)
          resolve(session)
        }
      )
    })
  }

  // Spawn agent with structured output (claude stream-json or opencode json)
  // resumeSessionId: if provided, resumes an existing conversation
  async spawnAgentStream(
    engine: string,
    workspacePath: string,
    prompt: string,
    sessionId: string,
    resumeSessionId?: string
  ): Promise<{
    onEvent: (cb: (event: ClaudeStreamEvent) => void) => void
    onClose: (cb: (code: number) => void) => void
    kill: () => void
  }> {
    if (!this.client || !this.connected) throw new Error('Not connected')

    await this.acquireChannel()

    return new Promise((resolve, reject) => {
      const prefix = this.getShellPrefix(engine)
      let agentCmd: string
      const resumeArgs = resumeSessionId ? ['--resume', resumeSessionId] : []
      if (engine === 'opencode') {
        agentCmd = this.getEngineCmd('opencode', [...resumeArgs, '-p', JSON.stringify(prompt), '-f', 'json'])
      } else {
        // bypassPermissions: most tools auto-approved (deny rules + hooks
        // still apply). Surviving prompts go through the PTY detector.
        agentCmd = this.getEngineCmd('claude', [...resumeArgs, '-p', JSON.stringify(prompt), '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose'])
      }
      // Build command: setup prefix + cd + agent command
      // prefix already ends with " && " if non-empty, so just concatenate
      const innerCmd = `${prefix}cd ${JSON.stringify(workspacePath)} && ${agentCmd} < /dev/null 2>&1`
      // Use bash -l (login shell) to pick up .bashrc PATH
      const cmd = `bash -l -c ${JSON.stringify(innerCmd)}`

      // Emit debug info
      this.emit('debug', { engine, prefix, agentCmd, innerCmd, cmd })

      this.client!.exec(cmd, (err, stream) => {
        if (err) {
          this.releaseChannel()
          return reject(err)
        }

        const eventCallbacks: Array<(event: ClaudeStreamEvent) => void> = []
        const closeCallbacks: Array<(code: number) => void> = []
        let buffer = ''
        let closed = false
        const decoder = new StringDecoder('utf8')

        stream.on('data', (data: Buffer) => {
          buffer += decoder.write(data)
          // Parse newline-delimited JSON
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // keep incomplete line
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line) as ClaudeStreamEvent
              for (const cb of eventCallbacks) cb(event)
            } catch {
              // Not JSON, emit as raw text
              for (const cb of eventCallbacks) {
                cb({ type: 'raw', content: line })
              }
            }
          }
        })

        stream.on('error', (err: Error) => {
          console.error(`[AgentStream] stream error:`, err.message)
          if (!closed) {
            closed = true
            stream.destroy()
            this.releaseChannel()
            for (const cb of closeCallbacks) cb(-1)
          }
        })

        stream.on('close', (code: number) => {
          if (!closed) {
            closed = true
            stream.destroy()
            this.releaseChannel()
            for (const cb of closeCallbacks) cb(code)
          }
        })

        resolve({
          onEvent: (cb) => { eventCallbacks.push(cb) },
          onClose: (cb) => { closeCallbacks.push(cb) },
          kill: () => { stream.signal?.('KILL'); stream.destroy() },
        })
      })
    })
  }

  // Read a file from remote
  async readFile(path: string): Promise<string> {
    return this.exec(`cat ${JSON.stringify(path)}`)
  }

  // Write a file to remote
  async writeFile(path: string, content: string): Promise<void> {
    const escaped = content.replace(/'/g, "'\\''")
    await this.exec(`mkdir -p "$(dirname ${JSON.stringify(path)})" && cat > ${JSON.stringify(path)} << 'WORKANYWHERE_EOF'\n${content}\nWORKANYWHERE_EOF`)
  }

  // Upload binary file to remote via base64
  async uploadFile(localData: Buffer, remotePath: string): Promise<void> {
    const b64 = localData.toString('base64')
    await this.exec(`mkdir -p "$(dirname ${JSON.stringify(remotePath)})"`)
    // Split into chunks to avoid command line length limits
    const chunkSize = 60000
    await this.exec(`rm -f ${JSON.stringify(remotePath)}.b64tmp`)
    for (let i = 0; i < b64.length; i += chunkSize) {
      const chunk = b64.slice(i, i + chunkSize)
      await this.exec(`printf '%s' ${JSON.stringify(chunk)} >> ${JSON.stringify(remotePath)}.b64tmp`)
    }
    await this.exec(`base64 -d ${JSON.stringify(remotePath)}.b64tmp > ${JSON.stringify(remotePath)} && rm -f ${JSON.stringify(remotePath)}.b64tmp`)
  }

  // Check if an engine CLI is available
  async checkEngine(engine: string = 'claude'): Promise<{ available: boolean; version?: string }> {
    try {
      const prefix = this.getShellPrefix(engine)
      const cmd = this.getEngineCmd(engine, ['--version'])
      const output = await this.exec(`${prefix}${cmd} 2>/dev/null`, true)
      return { available: true, version: output.trim() }
    } catch {
      return { available: false }
    }
  }

  // Backward compat
  async checkClaude() { return this.checkEngine('claude') }

  getSession(id: string): SSHSession | undefined {
    return this.sessions.get(id)
  }
}

// Re-export for backward compatibility
export type { ClaudeStreamEvent } from './ConnectionTypes'
