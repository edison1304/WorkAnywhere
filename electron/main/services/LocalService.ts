import { EventEmitter } from 'events'
import { spawn, type ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import type { AppConfig } from '../../../shared/types'
import type { ClaudeStreamEvent, ISession } from './ConnectionTypes'

interface LocalSession extends ISession {
  process: ChildProcess
}

/**
 * LocalService — runs Claude CLI directly on the local machine.
 * On Windows, automatically routes through WSL2.
 */
export class LocalService extends EventEmitter {
  private sessions = new Map<string, LocalSession>()
  private _connected = false
  private isWindows = process.platform === 'win32'
  public engines: Record<string, { command: string; args: string[]; env: Record<string, string>; setupScript: string }> = {
    claude: { command: 'claude', args: [], env: {}, setupScript: '' },
    opencode: { command: 'opencode', args: [], env: {}, setupScript: '' },
  }

  /**
   * Convert a Windows path to WSL path.
   * C:\Users\foo\project → /mnt/c/Users/foo/project
   */
  private toWslPath(winPath: string): string {
    if (!this.isWindows) return winPath
    // Already a Unix path
    if (winPath.startsWith('/')) return winPath
    // C:\foo → /mnt/c/foo
    const match = winPath.match(/^([A-Za-z]):[\\\/](.*)$/)
    if (match) {
      const drive = match[1].toLowerCase()
      const rest = match[2].replace(/\\/g, '/')
      return `/mnt/${drive}/${rest}`
    }
    return winPath.replace(/\\/g, '/')
  }

  /**
   * Get the shell command and args for spawning.
   * Windows: ['wsl', 'bash', '-lc', cmd]
   * Linux/Mac: ['bash', '-lc', cmd]
   */
  private shellCmd(command: string): { bin: string; args: string[] } {
    if (this.isWindows) {
      return { bin: 'wsl', args: ['bash', '-lc', command] }
    }
    return { bin: 'bash', args: ['-lc', command] }
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

  getShellPrefix(engine: string = 'claude'): string {
    const cfg = this.engines[engine] || this.engines.claude
    const parts: string[] = []
    if (cfg.setupScript) parts.push(cfg.setupScript)
    for (const [k, v] of Object.entries(cfg.env)) {
      parts.push(`export ${k}=${JSON.stringify(v)}`)
    }
    return parts.length > 0 ? parts.join(' && ') + ' && ' : ''
  }

  getEngineCmd(engine: string, extraArgs: string[]): string {
    const cfg = this.engines[engine] || this.engines.claude
    const allArgs = [...cfg.args, ...extraArgs]
    return `${cfg.command} ${allArgs.join(' ')}`
  }

  async connect(): Promise<void> {
    if (this.isWindows) {
      // Verify WSL is available
      try {
        await this.exec('echo ok')
      } catch {
        throw new Error('WSL not available. Install WSL2 and a Linux distribution to use local mode on Windows.')
      }
    }
    this._connected = true
    this.emit('connected')
  }

  disconnect(): void {
    for (const session of this.sessions.values()) {
      session.close()
    }
    this.sessions.clear()
    this._connected = false
  }

  isConnected(): boolean {
    return this._connected
  }

  async exec(command: string, _useLogin = false): Promise<string> {
    const { bin, args } = this.shellCmd(command)
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { env: { ...process.env } })
      let output = ''
      child.stdout?.on('data', (data: Buffer) => { output += data.toString() })
      child.stderr?.on('data', (data: Buffer) => { output += data.toString() })
      child.on('close', () => resolve(output))
      child.on('error', reject)
    })
  }

  async spawnPTY(command: string, sessionId: string, cols = 120, rows = 30): Promise<LocalSession> {
    const { bin, args } = this.shellCmd(command)
    const child = spawn(bin, args, {
      env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const dataCallbacks: Array<(data: string) => void> = []
    const closeCallbacks: Array<() => void> = []

    child.stdout?.on('data', (data: Buffer) => {
      const str = data.toString()
      for (const cb of dataCallbacks) cb(str)
    })
    child.stderr?.on('data', (data: Buffer) => {
      const str = data.toString()
      for (const cb of dataCallbacks) cb(str)
    })
    child.on('close', () => {
      this.sessions.delete(sessionId)
      for (const cb of closeCallbacks) cb()
    })

    const session: LocalSession = {
      id: sessionId,
      process: child,
      onData: (cb) => { dataCallbacks.push(cb) },
      onClose: (cb) => { closeCallbacks.push(cb) },
      write: (data) => { child.stdin?.write(data) },
      resize: () => { /* No resize for child_process — would need node-pty */ },
      close: () => { child.kill('SIGTERM') },
    }

    this.sessions.set(sessionId, session)
    return session
  }

  async spawnAgentStream(
    engine: string,
    workspacePath: string,
    prompt: string,
    _sessionId: string
  ): Promise<{
    onEvent: (cb: (event: ClaudeStreamEvent) => void) => void
    onClose: (cb: (code: number) => void) => void
    kill: () => void
  }> {
    const prefix = this.getShellPrefix(engine)
    let agentCmd: string
    if (engine === 'opencode') {
      agentCmd = this.getEngineCmd('opencode', ['-p', JSON.stringify(prompt), '-f', 'json'])
    } else {
      agentCmd = this.getEngineCmd('claude', ['-p', JSON.stringify(prompt), '--output-format', 'stream-json', '--verbose'])
    }
    const wslPath = this.toWslPath(workspacePath)
    const innerCmd = `${prefix}cd ${JSON.stringify(wslPath)} && ${agentCmd}`
    const { bin, args } = this.shellCmd(innerCmd)

    const child = spawn(bin, args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const eventCallbacks: Array<(event: ClaudeStreamEvent) => void> = []
    const closeCallbacks: Array<(code: number) => void> = []
    let buffer = ''

    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as ClaudeStreamEvent
          for (const cb of eventCallbacks) cb(event)
        } catch {
          for (const cb of eventCallbacks) {
            cb({ type: 'raw', content: line })
          }
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        for (const cb of eventCallbacks) {
          cb({ type: 'raw', content: text })
        }
      }
    })

    child.on('close', (code) => {
      for (const cb of closeCallbacks) cb(code || 0)
    })

    return {
      onEvent: (cb) => { eventCallbacks.push(cb) },
      onClose: (cb) => { closeCallbacks.push(cb) },
      kill: () => { child.kill('SIGTERM') },
    }
  }

  async readFile(path: string): Promise<string> {
    return readFileSync(path, 'utf-8')
  }

  async uploadFile(_localData: Buffer, _remotePath: string): Promise<void> {
    // Local mode: files are already local, no upload needed
  }

  async checkEngine(engine: string = 'claude'): Promise<{ available: boolean; version?: string }> {
    try {
      const cmd = this.getEngineCmd(engine, ['--version'])
      const output = await this.exec(cmd)
      return { available: true, version: output.trim() }
    } catch {
      return { available: false }
    }
  }

  async checkClaude() { return this.checkEngine('claude') }

  getSession(id: string): LocalSession | undefined {
    return this.sessions.get(id)
  }
}
