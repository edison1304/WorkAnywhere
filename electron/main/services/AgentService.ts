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

      // Forward PTY output to renderer (Terminal tab only).
      // Log tab uses explicit events only (user messages, lifecycle).
      // Parsing TUI's raw PTY stream for clean text is unreliable.
      ptySession.onData((data) => {
        this.emit('pty:data', { taskId, data })
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
