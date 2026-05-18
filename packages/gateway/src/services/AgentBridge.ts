import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { LogEntry, TaskStatus } from '../../../../shared/types'

interface AgentSession {
  process: ChildProcess
  taskId: string
  projectId: string
  buffer: string
}

/**
 * AgentBridge — spawns and manages Claude CLI agent processes on the server.
 *
 * Since the gateway runs on the same machine as the workspace, it can
 * spawn `claude` directly via child_process (no SSH needed).
 *
 * Emits:
 *   'log'    — { taskId, log: LogEntry }
 *   'status' — { taskId, status: TaskStatus }
 *   'permission' — { taskId, id, text, format }
 */
export class AgentBridge extends EventEmitter {
  private sessions = new Map<string, AgentSession>()

  async start(opts: {
    projectId: string
    phaseId: string
    taskId: string
    workspacePath: string
    prompt: string
  }): Promise<{ success: boolean; error?: string }> {
    if (this.sessions.has(opts.taskId)) {
      return { success: false, error: 'Agent already running for this task' }
    }

    try {
      const proc = spawn('claude', [
        '-p', opts.prompt,
        '--output-format', 'stream-json',
      ], {
        cwd: opts.workspacePath,
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const session: AgentSession = {
        process: proc,
        taskId: opts.taskId,
        projectId: opts.projectId,
        buffer: '',
      }

      this.sessions.set(opts.taskId, session)

      this.emitStatus(opts.taskId, 'running')
      this.emitLog(opts.taskId, 'agent_start', `Agent started for task ${opts.taskId}`)

      proc.stdout?.on('data', (chunk: Buffer) => {
        session.buffer += chunk.toString()
        this.processStreamBuffer(session)
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) {
          this.emitLog(opts.taskId, 'error', text)
        }
      })

      proc.on('close', (code) => {
        this.sessions.delete(opts.taskId)
        this.emitLog(opts.taskId, 'agent_end', `Agent exited with code ${code}`)
        this.emitStatus(opts.taskId, code === 0 ? 'completed' : 'failed')
      })

      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async stop(taskId: string): Promise<{ success: boolean }> {
    const session = this.sessions.get(taskId)
    if (!session) return { success: false }
    session.process.kill('SIGTERM')
    return { success: true }
  }

  async resume(taskId: string): Promise<{ success: boolean; error?: string }> {
    // Resume requires session context — for now, return error
    return { success: false, error: 'Resume not yet supported via gateway' }
  }

  async send(taskId: string, message: string): Promise<{ success: boolean }> {
    const session = this.sessions.get(taskId)
    if (!session || !session.process.stdin) return { success: false }
    session.process.stdin.write(message + '\n')
    return { success: true }
  }

  async respondPermission(
    taskId: string,
    approved: boolean,
    format: 'numbered' | 'yn',
  ): Promise<{ success: boolean }> {
    const session = this.sessions.get(taskId)
    if (!session || !session.process.stdin) return { success: false }

    const response = format === 'yn'
      ? (approved ? 'y' : 'n')
      : (approved ? '1' : '2')

    session.process.stdin.write(response + '\n')
    return { success: true }
  }

  isRunning(taskId: string): boolean {
    return this.sessions.has(taskId)
  }

  /** Parse stream-json output from Claude CLI. */
  private processStreamBuffer(session: AgentSession): void {
    const lines = session.buffer.split('\n')
    session.buffer = lines.pop() || '' // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        this.handleStreamEvent(session.taskId, parsed)
      } catch {
        // Non-JSON output — treat as text
        if (line.trim()) {
          this.emitLog(session.taskId, 'text', line)
        }
      }
    }
  }

  private handleStreamEvent(taskId: string, event: any): void {
    switch (event.type) {
      case 'assistant':
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              this.emitLog(taskId, 'text', block.text)
            } else if (block.type === 'tool_use') {
              this.emitLog(taskId, 'tool_call', `${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`, {
                tool: block.name,
              })
            }
          }
        }
        break
      case 'content_block_delta':
        if (event.delta?.text) {
          this.emitLog(taskId, 'text', event.delta.text)
        }
        break
      case 'result':
        this.emitLog(taskId, 'text', event.result || '')
        break
    }

    // Detect permission requests (heuristic: looking for Y/n or numbered choices)
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text') {
          const text = block.text
          if (/Do you want to proceed\?|Allow|Approve|Y\/n/i.test(text)) {
            this.emit('permission', {
              taskId,
              id: randomUUID(),
              text: text.slice(-500),
              format: /\d\)|\d\./.test(text) ? 'numbered' as const : 'yn' as const,
            })
          }
        }
      }
    }
  }

  private emitLog(taskId: string, type: LogEntry['type'], content: string, meta?: LogEntry['meta']): void {
    const log: LogEntry = {
      id: randomUUID(),
      taskId,
      timestamp: new Date().toISOString(),
      type,
      content,
      meta,
    }
    this.emit('log', { taskId, log })
  }

  private emitStatus(taskId: string, status: TaskStatus): void {
    this.emit('status', { taskId, status })
  }
}
