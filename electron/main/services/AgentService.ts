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

      const stream = await conn.spawnAgentStream(
        engine, workspacePath, enrichedPrompt, `stream-${taskId}`
      )
      agent.streamHandle = stream

      // Parse structured events → Log entries
      stream.onEvent((event) => {
        this.handleStreamEvent(taskId, agent, event)
      })

      // When stream-json finishes → start Phase 2 (PTY resume)
      stream.onClose((code) => {
        agent.streamHandle = null

        if (!this.agents.has(taskId)) return // already stopped

        if (code !== 0 && !agent.claudeSessionId) {
          this.emitStatus(taskId, 'failed')
          this.emitLog(taskId, 'error', `stream-json exited with code ${code}`)
          this.agents.delete(taskId)
          return
        }

        this.emitLog(taskId, 'text', `[Phase 1] Initial prompt completed`)
        this.startPTYResume(taskId, agent, workspacePath)
      })

    } catch (err) {
      this.emitStatus(taskId, 'failed')
      this.emitLog(taskId, 'error', `Failed to start agent: ${err}`)
      this.agents.delete(taskId)
    }
  }

  /**
   * Phase 2: Start interactive PTY by resuming the Claude session.
   */
  private async startPTYResume(
    taskId: string,
    agent: AgentInstance,
    workspacePath: string
  ): Promise<void> {
    try {
      const conn = agent.conn
      const prefix = conn.getShellPrefix(agent.engine)
      const resumeArgs = agent.claudeSessionId
        ? ['--resume', agent.claudeSessionId]
        : []
      const agentCmd = conn.getEngineCmd(agent.engine, resumeArgs)
      const fullCmd = `${prefix}cd ${JSON.stringify(workspacePath)} && ${agentCmd}`

      this.emitLog(taskId, 'text', `[Phase 2] Interactive terminal ready`)

      const ptySession = await conn.spawnPTY(fullCmd, `pty-${taskId}`)
      agent.ptySession = ptySession

      // Forward PTY output to Terminal tab + capture for Log
      let ptyLogBuffer = ''
      let ptyLogTimer: ReturnType<typeof setTimeout> | null = null

      const flushPtyLog = () => {
        if (ptyLogTimer) { clearTimeout(ptyLogTimer); ptyLogTimer = null }
        const allLines = ptyLogBuffer.split('\n').map(l => l.trim())
        console.log(`[FLUSH:${taskId}] buffer=${ptyLogBuffer.length}b, lines=${allLines.length}, sample: "${allLines.slice(0, 3).join(' | ')}"`)

        const lines = allLines
          .filter(l => l.length > 2)
          .filter(l => !/^[─│┌┐└┘├┤┬┴┼━┃╔╗╚╝╠╣╦╩╬▶■●◌○·…\-=_+|]+$/.test(l))
          .filter(l => !/^\d+[ms]?\s*$/.test(l))
          .slice(-30)

        console.log(`[FLUSH:${taskId}] after filter: ${lines.length} lines`)

        if (lines.length > 0) {
          this.emitLog(taskId, 'text', `[Claude] ${lines.join('\n').slice(0, 3000)}`)
        }
        ptyLogBuffer = ''
      }

      ptySession.onData((data) => {
        this.emit('pty:data', { taskId, data })

        // DEBUG: log raw PTY data (hex for first 100 bytes)
        const preview = data.slice(0, 200).replace(/\x1b/g, '\\e')
        console.log(`[PTY:${taskId}] raw(${data.length}b): ${preview}`)

        // Strip ANSI/terminal noise for logging
        const clean = data
          .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
          .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
          .replace(/\x1b[()][0-9A-B]/g, '')
          .replace(/\x1b[>=<]/g, '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')

        console.log(`[PTY:${taskId}] clean(${clean.length}b): "${clean.slice(0, 200)}"`)

        if (clean.trim()) {
          ptyLogBuffer += clean

          // Flush if buffer is large (don't wait for timer)
          if (ptyLogBuffer.length > 500) {
            console.log(`[PTY:${taskId}] flush(size): ${ptyLogBuffer.length}b`)
            flushPtyLog()
            return
          }

          // Debounce: flush after 2s of no data
          if (ptyLogTimer) clearTimeout(ptyLogTimer)
          ptyLogTimer = setTimeout(() => {
            console.log(`[PTY:${taskId}] flush(timer): ${ptyLogBuffer.length}b`)
            flushPtyLog()
          }, 2000)
        }
      })

      ptySession.onClose(() => {
        this.emit('pty:close', { taskId })
        if (this.agents.has(taskId)) {
          // Completed → review (사용자가 검토 후 completed로 전환)
          this.emitStatus(taskId, 'review')
          this.emitLog(taskId, 'agent_end', 'Agent finished — review needed')
          this.cleanupArtifacts(taskId)
          this.agents.delete(taskId)
        }
      })

      // Replay any messages queued during Phase 1
      if (agent.messageQueue.length > 0) {
        // Wait for PTY to initialize
        setTimeout(() => {
          for (const msg of agent.messageQueue) {
            ptySession.write(msg + '\r')
            this.emitLog(taskId, 'text', `[YOU] ${msg}`)
          }
          agent.messageQueue = []
        }, 2000)
      }

    } catch (err) {
      this.emitStatus(taskId, 'failed')
      this.emitLog(taskId, 'error', `Failed to start PTY: ${err}`)
      this.agents.delete(taskId)
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
   * Send a follow-up message to a running agent.
   * If still in Phase 1, queues the message.
   */
  sendMessage(taskId: string, message: string): void {
    const agent = this.agents.get(taskId)
    if (!agent) return

    if (agent.ptySession) {
      console.log(`[SEND:${taskId}] "${message}" → ptySession exists: ${!!agent.ptySession}`)
      // Send message + Enter to PTY
      agent.ptySession.write(message + '\r')
      console.log(`[SEND:${taskId}] wrote "${message}\\r" to PTY`)
      this.emitLog(taskId, 'text', `[YOU] ${message}`)
    } else {
      // Phase 1 still running — queue message for Phase 2
      agent.messageQueue.push(message)
      this.emitLog(taskId, 'text', `[QUEUED] ${message} (waiting for initial prompt to complete)`)
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
   * Resume a Claude session by session ID (Phase 2 only — interactive PTY).
   * Used when reopening a previously completed/failed task.
   */
  async resumeSession(
    taskId: string,
    projectId: string,
    phaseId: string,
    workspacePath: string,
    sessionId: string,
    engine: string = 'claude'
  ): Promise<void> {
    if (this.agents.has(taskId)) {
      throw new Error(`Agent already running for task ${taskId}`)
    }

    const conn = await this.getConn(projectId)

    this.emitStatus(taskId, 'running')
    this.emitLog(taskId, 'agent_start', `Resuming session ${sessionId}`)

    const agent: AgentInstance = {
      taskId, projectId, phaseId, engine, conn,
      ptySession: null,
      streamHandle: null,
      claudeSessionId: sessionId,
      messageQueue: [],
    }
    this.agents.set(taskId, agent)

    await this.startPTYResume(taskId, agent, workspacePath)
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
