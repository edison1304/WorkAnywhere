import { EventEmitter } from 'events'
import type { ConnectionManager, AnyConnection } from './ConnectionManager'
import type { ClaudeStreamEvent, StreamHandle, ISession } from './ConnectionTypes'
import type { LogEntry, TaskStatus, Artifact, ArtifactType, Project } from '../../../shared/types'

interface AgentInstance {
  taskId: string
  projectId: string
  phaseId: string
  engine: string
  conn: AnyConnection                  // connection for this agent's project
  ptySession: ISession | null          // null during Phase 1 (stream-json)
  streamHandle: StreamHandle | null    // non-null during Phase 1
  claudeSessionId: string | null
  messageQueue: string[]               // messages queued during Phase 1
}

export class AgentService extends EventEmitter {
  private agents = new Map<string, AgentInstance>()

  constructor(
    private connMgr: ConnectionManager,
    private getProject: (projectId: string) => Project | null
  ) {
    super()
  }

  private async getConn(projectId: string): Promise<AnyConnection> {
    const project = this.getProject(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    return this.connMgr.getConnection(project)
  }

  /**
   * Start a Claude agent using Dual Channel:
   *   Phase 1: stream-json (structured output for Log tab, session_id extraction)
   *   Phase 2: interactive PTY resume (Terminal tab, follow-up messages)
   */
  async startAgent(
    projectId: string,
    phaseId: string,
    taskId: string,
    workspacePath: string,
    prompt: string,
    engine: string = 'claude'
  ): Promise<void> {
    if (this.agents.has(taskId)) {
      throw new Error(`Agent already running for task ${taskId}`)
    }

    // Get connection for this project (lazy connect)
    const conn = await this.getConn(projectId)

    this.emitStatus(taskId, 'running')
    this.emitLog(taskId, 'agent_start', `Agent started (${engine})`)

    const agent: AgentInstance = {
      taskId, projectId, phaseId, engine, conn,
      ptySession: null,
      streamHandle: null,
      claudeSessionId: null,
      messageQueue: [],
    }
    this.agents.set(taskId, agent)

    // ── Load phase context (shared between agents in same phase) ──
    let enrichedPrompt = prompt
    try {
      const contextPath = `${workspacePath}/.workanywhere/phase-${phaseId}-context.md`
      const context = await conn.exec(`cat ${JSON.stringify(contextPath)} 2>/dev/null || true`)
      if (context.trim()) {
        enrichedPrompt = `[Phase Context — other tasks in this phase have reported the following]\n${context.trim()}\n\n[Your Task]\n${prompt}`
        this.emitLog(taskId, 'text', `Phase context loaded (${context.trim().split('\n').length} lines)`)
      }
    } catch { /* no context file yet — fine */ }

    // ── Phase 1: stream-json for structured output ──
    try {
      this.emitLog(taskId, 'text', `[Phase 1] Running prompt via stream-json...`)
      console.log(`[startAgent ${taskId}] spawning stream — prompt=${enrichedPrompt.length} chars, engine=${engine}, cwd=${workspacePath}`)

      const stream = await conn.spawnAgentStream(
        engine, workspacePath, enrichedPrompt, `stream-${taskId}`
      )
      agent.streamHandle = stream
      console.log(`[startAgent ${taskId}] stream spawned, awaiting events`)

      let eventCount = 0
      let firstEventLogged = false

      // Parse structured events → Log entries
      stream.onEvent((event) => {
        eventCount++
        if (!firstEventLogged) {
          console.log(`[stream ${taskId}] FIRST event received — type=${event.type}`)
          firstEventLogged = true
        }
        // Diagnostic: surface raw / unknown events to the console so we can
        // see what claude is actually emitting between system and assistant.
        if (event.type === 'raw') {
          const txt = String((event as any).content || '').slice(0, 200)
          if (txt.trim()) console.log(`[stream ${taskId}] raw: ${txt}`)
        } else if (event.type !== 'system' && event.type !== 'assistant' && event.type !== 'text_delta') {
          console.log(`[stream ${taskId}] event ${eventCount}: type=${event.type}`)
        }
        this.handleStreamEvent(taskId, agent, event)
      })

      // When stream-json finishes → ready for follow-up messages
      stream.onClose((code) => {
        console.log(`[stream ${taskId}] closed — exit code=${code}, total events=${eventCount}`)
        agent.streamHandle = null

        if (!this.agents.has(taskId)) return // already stopped

        if (code !== 0 && !agent.claudeSessionId) {
          this.emitStatus(taskId, 'failed')
          this.emitLog(taskId, 'error', `Agent exited with code ${code}`)
          this.agents.delete(taskId)
          return
        }

        // Ready for follow-up messages via stream-json --resume
        this.emitStatus(taskId, 'waiting')
        this.emitLog(taskId, 'agent_end', 'Ready for follow-up messages')

        // Process any queued messages
        if (agent.messageQueue.length > 0) {
          const queued = [...agent.messageQueue]
          agent.messageQueue = []
          for (const msg of queued) {
            this.sendMessage(taskId, msg)
          }
        }
      })

    } catch (err) {
      this.emitStatus(taskId, 'failed')
      this.emitLog(taskId, 'error', `Failed to start agent: ${err}`)
      this.agents.delete(taskId)
    }
  }

  /**
   * Open an optional PTY terminal (for manual terminal access).
   * Not auto-started — user can open Terminal tab if needed.
   */
  async openTerminal(taskId: string): Promise<void> {
    const agent = this.agents.get(taskId)
    if (!agent || agent.ptySession) return

    try {
      const conn = agent.conn
      const project = this.getProject(agent.projectId)
      const workspacePath = project?.workspacePath || '~'
      const prefix = conn.getShellPrefix(agent.engine)
      const resumeArgs = agent.claudeSessionId ? ['--resume', agent.claudeSessionId] : []
      const agentCmd = conn.getEngineCmd(agent.engine, resumeArgs)
      const fullCmd = `${prefix}cd ${JSON.stringify(workspacePath)} && ${agentCmd}`

      const ptySession = await conn.spawnPTY(fullCmd, `pty-${taskId}`)
      agent.ptySession = ptySession

      ptySession.onData((data) => this.emit('pty:data', { taskId, data }))
      ptySession.onClose(() => {
        this.emit('pty:close', { taskId })
        if (agent) agent.ptySession = null
      })
    } catch (err) {
      this.emitLog(taskId, 'error', `Terminal failed: ${err}`)
    }
  }

  /**
   * Map stream-json events to Log entries.
   */
  private handleStreamEvent(
    taskId: string,
    agent: AgentInstance,
    event: ClaudeStreamEvent
  ): void {
    // Capture session_id from any event that has it
    if (event.session_id && !agent.claudeSessionId) {
      agent.claudeSessionId = event.session_id
      this.emit('task:sessionId', { taskId, sessionId: event.session_id })
    }

    switch (event.type) {
      case 'system':
        // Session metadata — session_id already captured above
        break

      case 'assistant':
        // Assistant text response or tool use
        if (event.content) {
          // content can be a string or array of content blocks
          if (typeof event.content === 'string') {
            this.emitLog(taskId, 'text', event.content)
          } else if (Array.isArray(event.content)) {
            for (const block of event.content as any[]) {
              if (block.type === 'text' && block.text) {
                this.emitLog(taskId, 'text', block.text)
              } else if (block.type === 'tool_use') {
                const inputStr = block.input
                  ? JSON.stringify(block.input).slice(0, 200)
                  : ''
                this.emitLog(taskId, 'tool_call', `${block.name}(${inputStr})`, {
                  tool: block.name,
                })
                // Artifact detection
                if (block.input && typeof block.input === 'object') {
                  this.detectArtifact(taskId, block.name, block.input as Record<string, unknown>)
                }
              }
            }
          }
        }
        break

      case 'tool_use':
        this.emitLog(taskId, 'tool_call', `${event.tool || 'unknown'}`, {
          tool: event.tool,
        })
        if (event.tool && event.input && typeof event.input === 'object') {
          this.detectArtifact(taskId, event.tool, event.input)
        }
        break

      case 'tool_result':
        // Tool output — truncate for readability
        if (event.content || event.output) {
          const output = String(event.content || event.output || '').slice(0, 500)
          this.emitLog(taskId, 'text', `[Tool Result] ${output}`)
        }
        break

      case 'text_delta':
      case 'content_block_delta':
        // Streaming text delta — accumulate would be ideal but emit for now
        if (event.content || (event as any).delta?.text) {
          const text = String(event.content || (event as any).delta?.text || '')
          if (text.trim()) {
            this.emitLog(taskId, 'text', text)
          }
        }
        break

      case 'result':
        // Final result event
        if (event.session_id) {
          agent.claudeSessionId = event.session_id
          this.emit('task:sessionId', { taskId, sessionId: event.session_id })
        }
        if (event.result) {
          this.emitLog(taskId, 'text', String(event.result).slice(0, 1000))
        }
        break

      case 'error':
        this.emitLog(taskId, 'error', String(event.content || event.error || 'Unknown error'))
        break

      case 'raw':
        // Non-JSON output from stream — skip noise
        break

      default:
        // Unknown event type — log if it has content
        if (event.content && typeof event.content === 'string' && event.content.trim()) {
          this.emitLog(taskId, 'text', event.content)
        }
        break
    }
  }

  /**
   * Send a follow-up message via stream-json (--resume sessionId -p "msg").
   * Clean structured response — no TUI parsing needed.
   */
  async sendMessage(taskId: string, message: string): Promise<void> {
    const agent = this.agents.get(taskId)
    if (!agent) return

    // If still processing (stream or PTY active), queue
    if (agent.streamHandle) {
      agent.messageQueue.push(message)
      this.emitLog(taskId, 'text', `[QUEUED] ${message}`)
      return
    }

    if (!agent.claudeSessionId) {
      this.emitLog(taskId, 'error', 'No session ID — cannot send follow-up')
      return
    }

    this.emitLog(taskId, 'text', `[YOU] ${message}`)
    this.emitStatus(taskId, 'running')

    try {
      const conn = agent.conn
      const project = this.getProject(agent.projectId)
      const workspacePath = project?.workspacePath || '~'

      const stream = await conn.spawnAgentStream(
        agent.engine, workspacePath, message,
        `msg-${taskId}-${Date.now()}`,
        agent.claudeSessionId
      )
      agent.streamHandle = stream

      stream.onEvent((event) => {
        if (event.session_id) {
          agent.claudeSessionId = event.session_id
          this.emit('task:sessionId', { taskId, sessionId: event.session_id })
        }
        this.handleStreamEvent(taskId, agent, event)
      })

      stream.onClose((_code) => {
        agent.streamHandle = null
        if (this.agents.has(taskId)) {
          this.emitStatus(taskId, 'waiting')

          // Process next queued message if any
          if (agent.messageQueue.length > 0) {
            const next = agent.messageQueue.shift()!
            this.sendMessage(taskId, next)
          }
        }
      })
    } catch (err) {
      this.emitLog(taskId, 'error', `Send failed: ${err}`)
      this.emitStatus(taskId, 'waiting')
    }
  }

  // Buffer for capturing terminal direct input (keystroke → line)
  private ptyInputBuffers = new Map<string, string>()

  /**
   * Write raw data to PTY (for xterm.js key input)
   * Also captures user input for logging.
   */
  writePTY(taskId: string, data: string): void {
    const agent = this.agents.get(taskId)
    if (agent?.ptySession) {
      agent.ptySession.write(data)
      if (data === '\r') console.log(`[WRITE:${taskId}] Enter key`)
      else if (data.length === 1 && data >= ' ') console.log(`[WRITE:${taskId}] key: "${data}"`)
      else if (data.length > 1) console.log(`[WRITE:${taskId}] data(${data.length}b)`)

      // Capture keystrokes for logging
      let buf = this.ptyInputBuffers.get(taskId) || ''
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          // Enter pressed — log the accumulated line
          if (buf.trim()) {
            this.emitLog(taskId, 'text', `[YOU] ${buf.trim()}`)
          }
          buf = ''
        } else if (ch === '\x7f' || ch === '\b') {
          // Backspace
          buf = buf.slice(0, -1)
        } else if (ch >= ' ') {
          // Printable character
          buf += ch
        }
        // Ignore other control chars (arrows, etc.)
      }
      this.ptyInputBuffers.set(taskId, buf)
    }
  }

  /**
   * Resize PTY terminal
   */
  resizePTY(taskId: string, cols: number, rows: number): void {
    const agent = this.agents.get(taskId)
    if (agent?.ptySession) {
      agent.ptySession.resize(cols, rows)
    }
  }

  /**
   * Stop a running agent — handles both channels
   */
  stopAgent(taskId: string): void {
    const agent = this.agents.get(taskId)
    if (!agent) return

    // Kill stream-json if still running (Phase 1)
    if (agent.streamHandle) {
      agent.streamHandle.kill()
      agent.streamHandle = null
    }

    // Kill PTY if running (Phase 2)
    if (agent.ptySession) {
      agent.ptySession.write('\x03')
      setTimeout(() => {
        agent.ptySession?.write('exit\n')
        setTimeout(() => agent.ptySession?.close(), 500)
      }, 500)
    }

    this.emitStatus(taskId, 'failed')
    this.emitLog(taskId, 'agent_end', 'Agent stopped by user')
    this.cleanupArtifacts(taskId)
    this.agents.delete(taskId)
  }

  /**
   * Resume a Claude session by session ID.
   * Registers the agent with its sessionId so follow-up messages
   * can use --resume via stream-json.
   */
  async resumeSession(
    taskId: string,
    projectId: string,
    phaseId: string,
    _workspacePath: string,
    sessionId: string,
    engine: string = 'claude'
  ): Promise<void> {
    if (this.agents.has(taskId)) {
      throw new Error(`Agent already running for task ${taskId}`)
    }

    const conn = await this.getConn(projectId)

    const agent: AgentInstance = {
      taskId, projectId, phaseId, engine, conn,
      ptySession: null,
      streamHandle: null,
      claudeSessionId: sessionId,
      messageQueue: [],
    }
    this.agents.set(taskId, agent)

    this.emitStatus(taskId, 'waiting')
    this.emitLog(taskId, 'agent_start', `Session resumed (${sessionId.slice(0, 20)}...) — send a message to continue`)
  }

  isRunning(taskId: string): boolean {
    return this.agents.has(taskId)
  }

  private emitStatus(taskId: string, status: TaskStatus): void {
    this.emit('task:status', { taskId, status })
  }

  private emitLog(taskId: string, type: LogEntry['type'], content: string, meta?: LogEntry['meta']): void {
    const log: LogEntry = {
      id: `${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      timestamp: new Date().toISOString(),
      type,
      content,
      meta,
    }
    this.emit('task:log', { taskId, log })
  }

  // ─── Artifact Indexer ───

  private seenArtifacts = new Map<string, Set<string>>() // taskId → set of filePaths

  /**
   * Detect file artifacts from tool_use content blocks.
   * Emits 'task:artifact' for each new file detected.
   */
  private detectArtifact(taskId: string, toolName: string, input: Record<string, unknown>): void {
    let filePath: string | undefined
    let action: Artifact['action'] = 'modified'

    switch (toolName) {
      case 'Edit':
        filePath = input.file_path as string
        action = 'modified'
        break
      case 'Write':
        filePath = input.file_path as string
        action = 'created'
        break
      case 'Read':
        // Don't track reads as artifacts
        return
      case 'Bash': {
        // Try to extract file paths from common patterns
        const cmd = String(input.command || '')
        // Match: > file, >> file, tee file, cp ... file, mv ... file
        const writePatterns = [
          />\s*(\S+\.[\w]+)/,           // redirect: > file.ext
          /tee\s+(\S+\.[\w]+)/,          // tee file.ext
          /cp\s+\S+\s+(\S+\.[\w]+)/,    // cp src dest
          /mv\s+\S+\s+(\S+\.[\w]+)/,    // mv src dest
          /mkdir\s+-?p?\s+(\S+)/,        // mkdir
        ]
        for (const pat of writePatterns) {
          const m = cmd.match(pat)
          if (m) {
            filePath = m[1]
            action = 'created'
            break
          }
        }
        if (!filePath) return
        break
      }
      default:
        return
    }

    if (!filePath) return

    // Deduplicate per task
    if (!this.seenArtifacts.has(taskId)) {
      this.seenArtifacts.set(taskId, new Set())
    }
    const seen = this.seenArtifacts.get(taskId)!
    // For Edit, update action if already created
    if (seen.has(filePath)) {
      action = 'modified'
      // Still emit update for the UI
    }
    seen.add(filePath)

    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const typeMap: Record<string, ArtifactType> = {
      ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code',
      rs: 'code', go: 'code', java: 'code', c: 'code', cpp: 'code',
      h: 'code', css: 'code', scss: 'code', html: 'code', sh: 'code',
      sql: 'code', rb: 'code', php: 'code', swift: 'code', kt: 'code',
      md: 'markdown', markdown: 'markdown',
      yaml: 'yaml', yml: 'yaml',
      json: 'json', jsonl: 'json',
      png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
      bmp: 'image', webp: 'image', svg: 'image',
      pdf: 'pdf',
      txt: 'text', log: 'text', csv: 'text', tsv: 'text',
    }

    const artifact: Artifact = {
      id: `${taskId}-art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      filePath,
      type: typeMap[ext] || 'other',
      action,
      detectedAt: new Date().toISOString(),
    }

    this.emit('task:artifact', { taskId, artifact })
  }

  /**
   * Clean up artifact tracking when agent stops.
   */
  private cleanupArtifacts(taskId: string): void {
    this.seenArtifacts.delete(taskId)
  }
}
