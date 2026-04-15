import { EventEmitter } from 'events'
import type { AppConfig } from '../../../shared/types'
import type { ClaudeStreamEvent } from './ConnectionTypes'

/**
 * RemoteControlService — connects to Claude Code via Remote Control link.
 *
 * Architecture:
 *   1. User runs `claude --remote-control` on a server → gets a remote link
 *   2. This service connects to that Main Claude via the link
 *   3. Main Claude acts as an orchestrator: spawns sub-agents, returns their remote links
 *   4. Each sub-agent can be communicated with independently
 *
 * No SSH required. All communication goes through Anthropic's relay.
 */

interface RemoteMessage {
  type: 'message' | 'command' | 'ping'
  content?: string
  commandType?: 'spawn_agent' | 'exec' | 'read_file' | 'list_dir'
  args?: Record<string, unknown>
}

interface RemoteResponse {
  type: 'response' | 'stream' | 'error' | 'agent_spawned' | 'pong'
  content?: string
  remoteLink?: string  // for spawned sub-agents
  sessionId?: string
  data?: unknown
}

interface SubAgent {
  taskId: string
  remoteLink: string
  ws: WebSocket | null
  connected: boolean
}

export class RemoteControlService extends EventEmitter {
  private mainWs: WebSocket | null = null
  private mainLink: string = ''
  private _connected = false
  private subAgents = new Map<string, SubAgent>()
  private responseQueue = new Map<string, (resp: RemoteResponse) => void>()
  private msgCounter = 0

  public engines: Record<string, { command: string; args: string[]; env: Record<string, string>; setupScript: string }> = {
    claude: { command: 'claude', args: [], env: {}, setupScript: '' },
    opencode: { command: 'opencode', args: [], env: {}, setupScript: '' },
  }

  setClaudeConfig(appConfig: AppConfig): void {
    if (appConfig.claudeCommand) this.engines.claude.command = appConfig.claudeCommand
    if (appConfig.claudeArgs) this.engines.claude.args = appConfig.claudeArgs
    if (appConfig.claudeSetupScript) this.engines.claude.setupScript = appConfig.claudeSetupScript
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

  // ─── Connection ───

  async connect(remoteLink: string): Promise<void> {
    this.mainLink = remoteLink
    return new Promise((resolve, reject) => {
      try {
        // Remote link format: either a URL or a code
        // Normalize to WebSocket URL
        const wsUrl = this.normalizeLink(remoteLink)
        this.mainWs = new WebSocket(wsUrl)

        this.mainWs.onopen = () => {
          this._connected = true
          this.emit('connected')
          // Send initial orchestrator setup
          this.sendToMain({
            type: 'command',
            commandType: 'exec',
            args: { command: 'echo "Work Anywhere orchestrator connected"' }
          })
          resolve()
        }

        this.mainWs.onmessage = (event) => {
          try {
            const resp: RemoteResponse = JSON.parse(String(event.data))
            this.handleMainResponse(resp)
          } catch {
            // Non-JSON message, emit as raw
            this.emit('raw', String(event.data))
          }
        }

        this.mainWs.onerror = (err) => {
          this.emit('error', err)
          if (!this._connected) reject(new Error('Remote connection failed'))
        }

        this.mainWs.onclose = () => {
          this._connected = false
          this.emit('disconnected')
        }

      } catch (err) {
        reject(err)
      }
    })
  }

  disconnect(): void {
    // Close all sub-agent connections
    for (const sub of this.subAgents.values()) {
      sub.ws?.close()
    }
    this.subAgents.clear()
    // Close main connection
    this.mainWs?.close()
    this.mainWs = null
    this._connected = false
  }

  isConnected(): boolean {
    return this._connected
  }

  // ─── Command execution via Main Claude ───

  /**
   * Execute a command on the remote server via Main Claude.
   * Main Claude runs the command and returns output.
   */
  async exec(command: string): Promise<string> {
    const resp = await this.sendAndWait({
      type: 'command',
      commandType: 'exec',
      args: { command }
    })
    return String(resp.content || '')
  }

  /**
   * Spawn a sub-agent for a task.
   * Main Claude creates a new claude instance with --remote-control
   * and returns its remote link.
   */
  async spawnSubAgent(
    taskId: string,
    workspacePath: string,
    prompt: string,
    engine: string = 'claude'
  ): Promise<{ remoteLink: string; sessionId?: string }> {
    const resp = await this.sendAndWait({
      type: 'command',
      commandType: 'spawn_agent',
      args: {
        taskId,
        workspacePath,
        prompt,
        engine,
        engineCmd: this.getEngineCmd(engine, ['--remote-control']),
        shellPrefix: this.getShellPrefix(engine),
      }
    })

    if (!resp.remoteLink) {
      throw new Error('Main Claude did not return a remote link for sub-agent')
    }

    // Store sub-agent info
    this.subAgents.set(taskId, {
      taskId,
      remoteLink: resp.remoteLink,
      ws: null,
      connected: false,
    })

    return {
      remoteLink: resp.remoteLink,
      sessionId: resp.sessionId,
    }
  }

  /**
   * Connect to a sub-agent's remote link for interactive communication.
   */
  async connectSubAgent(taskId: string): Promise<void> {
    const sub = this.subAgents.get(taskId)
    if (!sub) throw new Error(`Sub-agent ${taskId} not found`)

    const wsUrl = this.normalizeLink(sub.remoteLink)
    sub.ws = new WebSocket(wsUrl)

    sub.ws.onopen = () => {
      sub.connected = true
      this.emit('subagent:connected', { taskId })
    }

    sub.ws.onmessage = (event) => {
      this.emit('subagent:data', { taskId, data: String(event.data) })
    }

    sub.ws.onclose = () => {
      sub.connected = false
      this.emit('subagent:closed', { taskId })
    }
  }

  /**
   * Send a message to a sub-agent.
   */
  sendToSubAgent(taskId: string, message: string): void {
    const sub = this.subAgents.get(taskId)
    if (sub?.ws && sub.connected) {
      sub.ws.send(JSON.stringify({ type: 'message', content: message }))
    }
  }

  /**
   * Close a sub-agent connection.
   */
  closeSubAgent(taskId: string): void {
    const sub = this.subAgents.get(taskId)
    if (sub) {
      sub.ws?.close()
      this.subAgents.delete(taskId)
    }
  }

  // ─── IConnectionService compat ───

  async spawnAgentStream(
    engine: string,
    workspacePath: string,
    prompt: string,
    _sessionId: string
  ) {
    // In remote mode, we send the prompt to Main Claude which spawns a sub-agent
    // The sub-agent's output is streamed back via events
    const eventCallbacks: Array<(event: ClaudeStreamEvent) => void> = []
    const closeCallbacks: Array<(code: number) => void> = []

    // Ask Main Claude to run the prompt and stream results
    this.sendToMain({
      type: 'command',
      commandType: 'spawn_agent',
      args: {
        workspacePath,
        prompt,
        engine,
        engineCmd: this.getEngineCmd(engine, ['-p', JSON.stringify(prompt), '--output-format', 'stream-json']),
        shellPrefix: this.getShellPrefix(engine),
        stream: true,
      }
    })

    // Stream events will come through handleMainResponse
    const streamHandler = (event: ClaudeStreamEvent) => {
      for (const cb of eventCallbacks) cb(event)
    }
    const closeHandler = (code: number) => {
      for (const cb of closeCallbacks) cb(code)
      this.removeListener('stream:event', streamHandler)
      this.removeListener('stream:close', closeHandler)
    }

    this.on('stream:event', streamHandler)
    this.on('stream:close', closeHandler)

    return {
      onEvent: (cb: (event: ClaudeStreamEvent) => void) => { eventCallbacks.push(cb) },
      onClose: (cb: (code: number) => void) => { closeCallbacks.push(cb) },
      kill: () => {
        this.sendToMain({ type: 'command', commandType: 'exec', args: { command: 'kill_stream' } })
      },
    }
  }

  async spawnPTY(command: string, sessionId: string) {
    // In remote mode, PTY is simulated via message passing
    const dataCallbacks: Array<(data: string) => void> = []
    const closeCallbacks: Array<() => void> = []

    // If we have a sub-agent for this session, connect to it
    const taskId = sessionId.replace('pty-', '')
    const sub = this.subAgents.get(taskId)

    if (sub) {
      await this.connectSubAgent(taskId)

      const dataHandler = (evt: { taskId: string; data: string }) => {
        if (evt.taskId === taskId) {
          for (const cb of dataCallbacks) cb(evt.data)
        }
      }
      const closeHandler = (evt: { taskId: string }) => {
        if (evt.taskId === taskId) {
          for (const cb of closeCallbacks) cb()
          this.removeListener('subagent:data', dataHandler)
          this.removeListener('subagent:closed', closeHandler)
        }
      }

      this.on('subagent:data', dataHandler)
      this.on('subagent:closed', closeHandler)

      return {
        id: sessionId,
        onData: (cb: (data: string) => void) => { dataCallbacks.push(cb) },
        onClose: (cb: () => void) => { closeCallbacks.push(cb) },
        write: (data: string) => { this.sendToSubAgent(taskId, data) },
        resize: () => {},
        close: () => { this.closeSubAgent(taskId) },
      }
    }

    // Fallback: run command via Main Claude
    this.sendToMain({
      type: 'command',
      commandType: 'exec',
      args: { command, interactive: true }
    })

    return {
      id: sessionId,
      onData: (cb: (data: string) => void) => { dataCallbacks.push(cb) },
      onClose: (cb: () => void) => { closeCallbacks.push(cb) },
      write: (data: string) => {
        this.sendToMain({ type: 'message', content: data })
      },
      resize: () => {},
      close: () => {
        this.sendToMain({ type: 'command', commandType: 'exec', args: { command: 'exit' } })
      },
    }
  }

  async checkClaude(): Promise<{ available: boolean; version?: string }> {
    try {
      const output = await this.exec(`${this.getEngineCmd('claude', ['--version'])} 2>/dev/null`)
      return { available: true, version: output.trim() }
    } catch {
      return { available: false }
    }
  }

  // ─── Internal ───

  private normalizeLink(link: string): string {
    // Accept various formats:
    // - Full WebSocket URL: wss://...
    // - HTTPS URL: https://... → convert to wss://
    // - Just a code: abc-123 → construct URL
    if (link.startsWith('wss://') || link.startsWith('ws://')) return link
    if (link.startsWith('https://')) return link.replace('https://', 'wss://')
    if (link.startsWith('http://')) return link.replace('http://', 'ws://')
    // Assume it's a remote control code
    return `wss://api.anthropic.com/remote-control/${link}`
  }

  private sendToMain(msg: RemoteMessage & { id?: string }): void {
    if (!this.mainWs || !this._connected) return
    this.mainWs.send(JSON.stringify(msg))
  }

  private sendAndWait(msg: RemoteMessage): Promise<RemoteResponse> {
    const id = `msg-${++this.msgCounter}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseQueue.delete(id)
        reject(new Error('Remote command timeout'))
      }, 60000)

      this.responseQueue.set(id, (resp) => {
        clearTimeout(timeout)
        this.responseQueue.delete(id)
        if (resp.type === 'error') reject(new Error(String(resp.content)))
        else resolve(resp)
      })

      this.sendToMain({ ...msg, id } as any)
    })
  }

  private handleMainResponse(resp: RemoteResponse & { id?: string }): void {
    // If response has an ID, route to waiting promise
    if ((resp as any).id && this.responseQueue.has((resp as any).id)) {
      this.responseQueue.get((resp as any).id)!(resp)
      return
    }

    // Stream events from agent execution
    if (resp.type === 'stream') {
      try {
        const event: ClaudeStreamEvent = typeof resp.data === 'string'
          ? JSON.parse(resp.data)
          : resp.data as ClaudeStreamEvent
        this.emit('stream:event', event)
      } catch {
        this.emit('stream:event', { type: 'raw', content: String(resp.content || resp.data) })
      }
      return
    }

    // Agent spawned notification
    if (resp.type === 'agent_spawned') {
      this.emit('agent:spawned', {
        remoteLink: resp.remoteLink,
        sessionId: resp.sessionId,
      })
      return
    }
  }
}
