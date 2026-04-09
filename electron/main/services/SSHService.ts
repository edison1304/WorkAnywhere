import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { EventEmitter } from 'events'
import type { ConnectionConfig } from '../../../shared/types'
import { readFileSync } from 'fs'

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
    for (const session of this.sessions.values()) {
      session.close()
    }
    this.sessions.clear()
    this.client?.end()
    this.client = null
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  // Execute a command and return output
  async exec(command: string): Promise<string> {
    if (!this.client || !this.connected) throw new Error('Not connected')

    return new Promise((resolve, reject) => {
      this.client!.exec(command, (err, stream) => {
        if (err) return reject(err)
        let output = ''
        stream.on('data', (data: Buffer) => { output += data.toString() })
        stream.stderr.on('data', (data: Buffer) => { output += data.toString() })
        stream.on('close', () => resolve(output))
      })
    })
  }

  // Spawn an interactive PTY session (for xterm.js)
  async spawnPTY(command: string, sessionId: string, cols = 120, rows = 30): Promise<SSHSession> {
    if (!this.client || !this.connected) throw new Error('Not connected')

    return new Promise((resolve, reject) => {
      this.client!.shell(
        { term: 'xterm-256color', cols, rows },
        (err, stream) => {
          if (err) return reject(err)

          const dataCallbacks: Array<(data: string) => void> = []
          const closeCallbacks: Array<() => void> = []

          stream.on('data', (data: Buffer) => {
            const str = data.toString()
            for (const cb of dataCallbacks) cb(str)
          })

          stream.on('close', () => {
            this.sessions.delete(sessionId)
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

  // Spawn Claude Code with stream-json output (for structured events)
  async spawnClaudeStreamJSON(
    workspacePath: string,
    prompt: string,
    sessionId: string
  ): Promise<{
    onEvent: (cb: (event: ClaudeStreamEvent) => void) => void
    onClose: (cb: (code: number) => void) => void
    kill: () => void
  }> {
    if (!this.client || !this.connected) throw new Error('Not connected')

    return new Promise((resolve, reject) => {
      const cmd = `cd ${JSON.stringify(workspacePath)} && claude -p ${JSON.stringify(prompt)} --output-format stream-json 2>&1`

      this.client!.exec(cmd, (err, stream) => {
        if (err) return reject(err)

        const eventCallbacks: Array<(event: ClaudeStreamEvent) => void> = []
        const closeCallbacks: Array<(code: number) => void> = []
        let buffer = ''

        stream.on('data', (data: Buffer) => {
          buffer += data.toString()
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

        stream.on('close', (code: number) => {
          for (const cb of closeCallbacks) cb(code)
        })

        resolve({
          onEvent: (cb) => { eventCallbacks.push(cb) },
          onClose: (cb) => { closeCallbacks.push(cb) },
          kill: () => { stream.signal?.('KILL'); stream.close() },
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

  // Check if claude CLI is available
  async checkClaude(): Promise<{ available: boolean; version?: string }> {
    try {
      const output = await this.exec('claude --version 2>/dev/null')
      return { available: true, version: output.trim() }
    } catch {
      return { available: false }
    }
  }

  getSession(id: string): SSHSession | undefined {
    return this.sessions.get(id)
  }
}

// Claude stream-json event types
export interface ClaudeStreamEvent {
  type: string
  content?: string
  tool?: string
  input?: Record<string, unknown>
  output?: string
  session_id?: string
  result?: string
  [key: string]: unknown
}
