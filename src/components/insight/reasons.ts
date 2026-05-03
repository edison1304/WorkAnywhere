import type { Task, Phase } from '../../../shared/types'

/**
 * Reason chips — short "why" labels next to numbers/states.
 * Discipline: return null when ambiguous. Silence over noise.
 */

export interface ReasonChip {
  text: string
  tone: 'neutral' | 'active' | 'attention' | 'fail' | 'done'
}

// ─── Why this task is in current state ─────────────────

export function taskStateReason(task: Task): ReasonChip | null {
  // Failed → try to surface error type
  if (task.status === 'failed') {
    const err = [...task.logs].reverse().find(l => l.type === 'error')
    if (err) {
      const cls = classifyError(err.content)
      if (cls) return { text: cls, tone: 'fail' }
    }
    return null
  }

  // Running but no recent activity → stalled
  if (task.status === 'running') {
    const last = task.logs[task.logs.length - 1]
    if (last) {
      const idleMs = Date.now() - new Date(last.timestamp).getTime()
      if (idleMs > 90_000) return { text: 'stalled', tone: 'attention' }
    }
  }

  // Review → why
  if (task.status === 'review') {
    return { text: 'needs review', tone: 'attention' }
  }

  // Waiting → why
  if (task.status === 'waiting') {
    return { text: 'awaits input', tone: 'attention' }
  }

  return null
}

// ─── Why this task is high in the schedule ─────────────

export function scheduleReason(
  task: Task,
  nice: number,
  interactionLevel: string,
  weightHint: string,
): ReasonChip | null {
  // Top-priority signals (nice strongly negative)
  if (nice <= -10) {
    if (interactionLevel === 'autonomous' && weightHint === 'heavy') {
      return { text: 'heavy · autonomous', tone: 'active' }
    }
    if (weightHint === 'heavy') return { text: 'heavy', tone: 'active' }
    if (interactionLevel === 'autonomous') return { text: 'autonomous', tone: 'active' }
  }

  // Bottom (positive nice)
  if (nice >= 10) {
    if (interactionLevel === 'interactive') return { text: 'needs you', tone: 'attention' }
  }

  // Middle ground — only annotate if status drives the position
  if (task.status === 'failed') return { text: 'retry', tone: 'fail' }
  if (task.status === 'review') return { text: 'review', tone: 'attention' }
  if (task.status === 'waiting') return { text: 'awaits input', tone: 'attention' }

  return null
}

// ─── Why this phase carries the tone it does ───────────

export function phaseReason(phase: Phase, tasks: Task[]): ReasonChip | null {
  const phaseTasks = tasks.filter(t => t.phaseId === phase.id)
  const failed = phaseTasks.filter(t => t.status === 'failed')
  if (failed.length > 0) {
    return { text: `${failed.length} 실패`, tone: 'fail' }
  }
  const blocked = phaseTasks.filter(t => t.status === 'waiting' || t.status === 'review')
  if (blocked.length > 0) {
    return { text: `${blocked.length} 사용자 대기`, tone: 'attention' }
  }
  // Issues from phase summary
  if (phase.summary?.issues?.length) {
    return { text: `${phase.summary.issues.length} 이슈`, tone: 'fail' }
  }
  return null
}

// ─── Issue dot reason — what kind of issue ─────────────

export function issueReason(task: Task): ReasonChip | null {
  if (task.summary?.issues?.length) {
    return { text: task.summary.issues[0].slice(0, 60), tone: 'fail' }
  }
  const err = [...task.logs].reverse().find(l => l.type === 'error')
  if (err) {
    const cls = classifyError(err.content)
    if (cls) return { text: cls, tone: 'fail' }
    return { text: err.content.slice(0, 60), tone: 'fail' }
  }
  return null
}

// ─── Internal: classify error log content ──────────────

function classifyError(content: string): string | null {
  const lower = content.toLowerCase()
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
  if (lower.includes('not found') || lower.includes('404')) return 'not found'
  if (lower.includes('permission') || lower.includes('denied') || lower.includes('eacces')) return 'permission'
  if (lower.includes('connection') || lower.includes('econnrefused') || lower.includes('network')) return 'network'
  if (lower.includes('parse') || lower.includes('syntax')) return 'parse error'
  if (lower.includes('out of memory') || lower.includes('oom')) return 'OOM'
  if (lower.includes('killed') || lower.includes('sigkill')) return 'killed'
  if (lower.includes('rate limit') || lower.includes('429')) return 'rate limit'
  if (lower.includes('auth') || lower.includes('401') || lower.includes('403')) return 'auth'
  return null
}
