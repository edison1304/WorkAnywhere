import { EventEmitter } from 'events'
import type { SSHService, ClaudeStreamEvent, SSHSession } from './SSHService'
import type { WorkspaceManager, ServerTask } from './WorkspaceManager'
import type { LogEntry, TaskStatus } from '../../../shared/types'

interface AgentInstance {
  taskId: string
  projectId: string
  phaseId: string
  engine: string                    // 'claude' or 'opencode'
  ptySession?: SSHSession           // interactive terminal
  streamProcess?: {                 // stream-json process
    onEvent: (cb: (e: ClaudeStreamEvent) => void) => void
    onClose: (cb: (code: number) => void) => void
    kill: () => void
  }
  claudeSessionId?: string
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
   * Start a Claude agent for a task
   * Uses dual channel: stream-json for structured events + PTY for interactive terminal
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

    const agent: AgentInstance = { taskId, projectId, phaseId, engine }
    this.agents.set(taskId, agent)

    // Emit status
    this.emitStatus(taskId, 'running')
    const engineCfg = this.ssh.engines[engine]
    this.emitLog(taskId, 'agent_start', `Agent started (${engine})`)
    this.emitLog(taskId, 'text', `[CONFIG] command=${engineCfg?.command || 'default'}, args=${JSON.stringify(engineCfg?.args || [])}, setup=${engineCfg?.setupScript || 'none'}`)

    // Capture debug info from SSH
    const debugHandler = (info: any) => {
      this.emitLog(taskId, 'text', `[DEBUG CMD] ${info.cmd}`)
    }
    this.ssh.once('debug', debugHandler)

    try {
      // Channel 1: structured events (stream-json for claude, json for opencode)
      const streamProc = await this.ssh.spawnAgentStream(
        engine, workspacePath, prompt, `stream-${taskId}`
      )
      agent.streamProcess = streamProc

      streamProc.onEvent((event) => {
        this.handleStreamEvent(taskId, event)
      })

      streamProc.onClose((code) => {
        const status: TaskStatus = code === 0 ? 'completed' : 'failed'
        this.emitStatus(taskId, status)
        this.emitLog(taskId, 'agent_end',
          code === 0 ? 'Agent completed successfully' : `Agent exited with code ${code}`)
        this.agents.delete(taskId)

        // Update workspace file
        this.workspace.updateTask(projectId, phaseId, taskId, {
          status,
          completedAt: new Date().toISOString(),
        }).catch(() => {})
      })

      // Channel 2: interactive PTY
      const prefix = this.ssh.getShellPrefix(engine)
      let ptyCmd: string
      if (engine === 'opencode') {
        ptyCmd = this.ssh.getEngineCmd('opencode', [])
      } else {
        ptyCmd = this.ssh.getEngineCmd('claude', ['--resume', 'last'])
      }
      const ptySession = await this.ssh.spawnPTY(
        `${prefix}cd ${JSON.stringify(workspacePath)} && ${ptyCmd}`,
        `pty-${taskId}`
      )
      agent.ptySession = ptySession

      // Forward PTY data to renderer
      ptySession.onData((data) => {
        this.emit('pty:data', { taskId, data })
      })

      ptySession.onClose(() => {
        this.emit('pty:close', { taskId })
      })

      // Update workspace
      await this.workspace.updateTask(projectId, phaseId, taskId, {
        status: 'running',
        lastRunAt: new Date().toISOString(),
      })

    } catch (err) {
      this.emitStatus(taskId, 'failed')
      this.emitLog(taskId, 'error', `Failed to start agent: ${err}`)
      this.agents.delete(taskId)
    }
  }

  /**
   * Send a message to a running agent's PTY
   */
  sendMessage(taskId: string, message: string): void {
    const agent = this.agents.get(taskId)
    if (agent?.ptySession) {
      agent.ptySession.write(message + '\n')
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

    agent.streamProcess?.kill()
    agent.ptySession?.close()
    this.agents.delete(taskId)

    this.emitStatus(taskId, 'failed')
    this.emitLog(taskId, 'agent_end', 'Agent stopped by user')
  }

  /**
   * Get agent status
   */
  isRunning(taskId: string): boolean {
    return this.agents.has(taskId)
  }

  // ─── Internal handlers ───

  private handleStreamEvent(taskId: string, event: ClaudeStreamEvent): void {
    switch (event.type) {
      case 'text_delta':
      case 'text':
        if (event.content) {
          this.emitLog(taskId, 'text', event.content)
        }
        break

      case 'tool_use':
      case 'tool_call':
        this.emitLog(taskId, 'tool_call', event.content || `${event.tool}: ${JSON.stringify(event.input || {}).slice(0, 200)}`, {
          tool: event.tool as string,
        })
        break

      case 'error':
      case 'system':
        if (event.content) {
          this.emitLog(taskId, 'error', event.content)
        }
        break

      case 'result':
        if (event.result) {
          this.emitLog(taskId, 'text', event.result)
        }
        // Capture session ID for --resume
        if (event.session_id) {
          const agent = this.agents.get(taskId)
          if (agent) agent.claudeSessionId = event.session_id as string
        }
        break

      case 'raw':
        if (event.content) {
          this.emitLog(taskId, 'text', event.content)
        }
        break
    }
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
