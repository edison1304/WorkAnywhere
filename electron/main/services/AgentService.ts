import { EventEmitter } from 'events'
import type { SSHService, SSHSession } from './SSHService'
import type { WorkspaceManager } from './WorkspaceManager'
import type { LogEntry, TaskStatus } from '../../../shared/types'

interface AgentInstance {
  taskId: string
  projectId: string
  phaseId: string
  engine: string
  ptySession: SSHSession
}

export class AgentService extends EventEmitter {
  private agents = new Map<string, AgentInstance>()

  constructor(
    private ssh: SSHService,
    private workspace: WorkspaceManager
  ) {
    super()
  }

  /**
   * Start an interactive Claude agent via PTY.
   * Launches claude in interactive mode, sends the initial prompt as first message.
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

    this.emitStatus(taskId, 'running')

    const engineCfg = this.ssh.engines[engine]
    this.emitLog(taskId, 'agent_start', `Agent started (${engine})`)

    try {
      // Build interactive claude command (no -p, no --output-format)
      const prefix = this.ssh.getShellPrefix(engine)
      const agentCmd = this.ssh.getEngineCmd(engine, [])  // just claude with base args
      const fullCmd = `${prefix}cd ${JSON.stringify(workspacePath)} && ${agentCmd}`

      this.emitLog(taskId, 'text', `[CMD] ${fullCmd}`)

      // Spawn interactive PTY
      const ptySession = await this.ssh.spawnPTY(
        fullCmd,
        `pty-${taskId}`
      )

      const agent: AgentInstance = { taskId, projectId, phaseId, engine, ptySession }
      this.agents.set(taskId, agent)

      // Forward PTY output to renderer (for Terminal tab) + Log
      let logBuffer = ''
      let logFlushTimer: ReturnType<typeof setTimeout> | null = null

      ptySession.onData((data) => {
        this.emit('pty:data', { taskId, data })

        // Buffer raw PTY output for log extraction
        logBuffer += data

        if (!logFlushTimer) {
          logFlushTimer = setTimeout(() => {
            if (logBuffer.trim()) {
              const cleaned = AgentService.extractCleanLog(logBuffer)
              if (cleaned) {
                this.emitLog(taskId, 'text', cleaned)
              }
            }
            logBuffer = ''
            logFlushTimer = null
          }, 1000)  // flush every 1s for more complete chunks
        }
      })

      ptySession.onClose(() => {
        this.emit('pty:close', { taskId })
        this.emitStatus(taskId, 'completed')
        this.emitLog(taskId, 'agent_end', 'Agent session closed')
        this.agents.delete(taskId)
      })

      // Wait a moment for claude to start, then send the initial prompt
      setTimeout(() => {
        if (this.agents.has(taskId)) {
          ptySession.write(prompt + '\n')
          this.emitLog(taskId, 'text', `[YOU] ${prompt}`)
        }
      }, 2000)  // give claude time to initialize

    } catch (err) {
      this.emitStatus(taskId, 'failed')
      this.emitLog(taskId, 'error', `Failed to start agent: ${err}`)
      this.agents.delete(taskId)
    }
  }

  /**
   * Send a follow-up message to a running agent
   */
  sendMessage(taskId: string, message: string): void {
    const agent = this.agents.get(taskId)
    if (agent?.ptySession) {
      agent.ptySession.write(message + '\n')
      this.emitLog(taskId, 'text', `[YOU] ${message}`)
    }
  }

  /**
   * Write raw data to PTY (for xterm.js key input)
   */
  writePTY(taskId: string, data: string): void {
    const agent = this.agents.get(taskId)
    if (agent?.ptySession) {
      agent.ptySession.write(data)
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
   * Stop a running agent
   */
  stopAgent(taskId: string): void {
    const agent = this.agents.get(taskId)
    if (!agent) return

    // Send Ctrl+C then exit
    agent.ptySession.write('\x03')
    setTimeout(() => {
      agent.ptySession.write('exit\n')
      setTimeout(() => {
        agent.ptySession.close()
      }, 500)
    }, 500)

    this.emitStatus(taskId, 'failed')
    this.emitLog(taskId, 'agent_end', 'Agent stopped by user')
    this.agents.delete(taskId)
  }

  isRunning(taskId: string): boolean {
    return this.agents.has(taskId)
  }

  /**
   * Extract only meaningful conversation text from raw PTY output.
   * Strips ANSI escapes, TUI decorations, status bars, logo art, borders.
   */
  static extractCleanLog(raw: string): string {
    // 1. Strip ALL ANSI escape sequences
    let text = raw
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')   // OSC (title, etc.)
      .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')           // CSI sequences
      .replace(/\x1b[()][0-9A-Za-z]/g, '')                   // Character set selection
      .replace(/\x1b[>=<]/g, '')                              // Keypad/mode
      .replace(/\x1b\[\d*[ABCDJKH]/g, '')                    // Cursor movement
      .replace(/\x1b[78]/g, '')                               // Save/restore cursor
      .replace(/\x1b\[?\d*[hl]/g, '')                         // Set/reset mode
      .replace(/\r/g, '')

    // 2. Filter lines
    const lines = text.split('\n').filter(line => {
      const t = line.trim()
      if (!t) return false

      // Block/box-drawing decoration lines
      if (/^[─━═╌╍┄┅│┃├┤┌┐└┘╔╗╚╝▐▛▜▝▘█▌▀▄░▒▓⎿⏵✶✻✳✽●\s·;*]+$/.test(t)) return false

      // Claude Code logo art
      if (/[▐▛▜▝▘█▌▀▄]{3,}/.test(t)) return false

      // Border lines (────)
      if (/^[─━═]{4,}/.test(t)) return false

      // Status bar / chrome
      if (/bypass\s*permissions/i.test(t)) return false
      if (/shift\+tab\s*to\s*cycle/i.test(t)) return false
      if (/Remote\s*Control\s*active/i.test(t)) return false
      if (/Combobulating/i.test(t)) return false
      if (/\/remote-control\s*is\s*active/i.test(t)) return false
      if (/\/ide\s*(for)?\s*(Cursor)?/i.test(t)) return false
      if (/claude\.ai\/code\/session/i.test(t)) return false
      if (/Claude\s+Code\s*v[\d.]+/i.test(t)) return false
      if (/Claude\s+(Max|Pro|Free)/i.test(t)) return false
      if (/Tip:\s*Use\s*\//i.test(t)) return false
      if (/^\s*esc\s*to\s*interrupt/i.test(t)) return false

      // Prompt chrome (just the ❯ symbol alone)
      if (/^❯\s*$/.test(t)) return false

      // Lines that are >60% special/decoration characters
      const printable = t.replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣.,!?:;'"()\-+=%&@#$^*/\\[\]{}<>~`]/g, '')
      if (printable.length < t.length * 0.3 && t.length > 3) return false

      return true
    })

    // 3. Clean up prompt markers for readability
    const cleaned = lines.map(line => {
      // "❯ 안녕" → "[YOU] 안녕"
      const promptMatch = line.match(/❯\s+(.+)/)
      if (promptMatch) return `[YOU] ${promptMatch[1].trim()}`

      // "●response text" → clean response
      const responseMatch = line.match(/●\s*(.+)/)
      if (responseMatch) return responseMatch[1].trim()

      return line.trim()
    })

    return cleaned.join('\n').trim()
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
}
