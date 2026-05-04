/**
 * PlanSyncService — listens to task logs and syncs derived plan state
 * (CHECKLIST.md, NOTES.md) back to disk. Per-task debounced so a busy
 * agent doesn't trigger a write per log entry.
 *
 * - PLAN.md is owned by the user/agent's prose; we never overwrite.
 * - CHECKLIST.md is rewritten from scratch each time (single source of
 *   truth for checkbox state lives in the agent's most recent dump).
 * - NOTES.md gains an appended block of *new* judgments only — never
 *   rewritten — so user-authored notes coexist.
 */

import type { Project, Phase, Task, Plan, JudgmentEntry } from '../../../shared/types'
import {
  buildPlanFromLogs,
  renderChecklistMarkdown,
  renderJudgmentsMarkdown,
} from '../../../shared/planParser'
import type { WorkflowFileService } from './WorkflowFileService'
import {
  taskDir, checklistFile, notesFile,
} from './workflowPaths'

const DEBOUNCE_MS = 1500

interface PerTaskState {
  timer: ReturnType<typeof setTimeout> | null
  /** Snapshot of the plan after the last successful sync. Used to compute
   *  the *new* judgments that need to be appended to NOTES.md. */
  lastPlan?: Plan
}

export class PlanSyncService {
  private state = new Map<string, PerTaskState>()

  constructor(
    private wfs: WorkflowFileService,
    private getTask: (taskId: string) => Task | null,
    private getPhase: (phaseId: string) => Phase | null,
    private getProject: (projectId: string) => Project | null,
    private onPlanUpdate?: (taskId: string, plan: Plan) => void,
  ) {}

  /** Schedule a debounced sync for this task. Call this from the task:log path. */
  notify(taskId: string): void {
    let s = this.state.get(taskId)
    if (!s) {
      s = { timer: null }
      this.state.set(taskId, s)
    }
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => this.flush(taskId).catch(() => {}), DEBOUNCE_MS)
  }

  /** Force immediate sync (e.g., on agent_end). */
  async flushNow(taskId: string): Promise<void> {
    const s = this.state.get(taskId)
    if (s?.timer) { clearTimeout(s.timer); s.timer = null }
    await this.flush(taskId).catch(() => {})
  }

  async flush(taskId: string): Promise<void> {
    const task = this.getTask(taskId)
    if (!task) return
    const phase = this.getPhase(task.phaseId)
    const project = phase ? this.getProject(phase.projectId) : null
    if (!project || !phase) return

    const s = this.state.get(taskId) ?? { timer: null }
    this.state.set(taskId, s)

    // Concatenate the agent's text + tool output (logs the model emitted).
    // We exclude pure user input (`[YOU] ...`) from the parse — checklist
    // state should reflect the agent's reported progress, not what the user
    // wrote in chat.
    const combined = task.logs
      .filter(l =>
        l.type === 'text' || l.type === 'agent_start' || l.type === 'agent_end',
      )
      .map(l => l.content)
      .join('\n')

    const newPlan = buildPlanFromLogs(combined, s.lastPlan ?? task.plan)

    // Decide what to write
    const dir = taskDir(project.workspacePath, project, phase, task)

    // 1) CHECKLIST.md — rewrite if it changed (or was empty)
    if (newPlan.checklist.length > 0) {
      const md = renderChecklistMarkdown(newPlan.checklist, `# Checklist — ${task.name}`)
      // Best-effort write; failures swallowed inside wfs
      await this.wfs.writeFile(project.id, checklistFile(dir), md)
    }

    // 2) NOTES.md — append new judgments only
    const newJudgments = diffJudgments(s.lastPlan?.judgmentLog ?? task.plan?.judgmentLog ?? [], newPlan.judgmentLog)
    if (newJudgments.length > 0) {
      const block =
        '\n' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '\n' +
        renderJudgmentsMarkdown(newJudgments) + '\n'
      await this.wfs.appendFile(project.id, notesFile(dir), block)
    }

    s.lastPlan = newPlan
    this.onPlanUpdate?.(taskId, newPlan)
  }

  /** Forget per-task state (e.g., on task delete). */
  forget(taskId: string): void {
    const s = this.state.get(taskId)
    if (s?.timer) clearTimeout(s.timer)
    this.state.delete(taskId)
  }
}

function diffJudgments(prev: JudgmentEntry[], next: JudgmentEntry[]): JudgmentEntry[] {
  const seen = new Set(prev.map(e => `${e.decision}|${e.reason}`))
  return next.filter(e => !seen.has(`${e.decision}|${e.reason}`))
}
