import type { Task, Phase, Project, JudgmentEntry, CompactedSession } from '../../../shared/types'

/**
 * Time-ordered event extraction for the Timeline view.
 *
 * Two paths:
 *   - If task.compacted exists → use it (LLM-curated 3-bucket narrative).
 *     This is the primary path once user has clicked 완료.
 *   - Else → fall back to log/judgment auto-extraction (legacy path).
 *
 * Phase/project views aggregate compacted task buckets when available, fall
 * back to lifecycle events otherwise.
 */

export type EventTone = 'success' | 'detour' | 'error' | 'info'

export interface TimelineEvent {
  id: string
  timestamp: string                  // ISO
  tone: EventTone
  category: string                   // short label e.g. "완료" / "우회" / "에러" / "시작"
  title: string                      // main line
  body?: string                      // secondary one-liner (legacy path)
  /** Rich body for compacted cards. Renderer uses this when present. */
  rich?: {
    detail?: string                  // 완료: "어떻게/무엇을"
    reason?: string                  // 우회: "왜"
    cause?: string                   // 에러: "왜 그런 문제가 생겼나"
    fix?: string                     // 에러: "어떻게 고쳤나"
    refs?: { files?: string[]; commits?: string[] }
  }
  entityRef?: { kind: 'task' | 'phase' | 'project'; id: string; name: string }
}

// ─── Detour detection — keyword based ───
// Catches the moments where the agent (or user) chose a different path
// rather than completing or failing the original.
const DETOUR_KEYWORDS = [
  'skip', 'skipped', 'defer', 'deferred', 'bypass', 'bypassed',
  'rollback', 'rolled back', 'reverted', 'instead of', 'workaround',
  '우회', '건너뛰', '보류', '대신', '미뤄', '되돌',
]

function isDetour(text: string): boolean {
  const lower = text.toLowerCase()
  return DETOUR_KEYWORDS.some(k => lower.includes(k))
}

function judgmentTone(j: JudgmentEntry): EventTone {
  if (isDetour(`${j.decision} ${j.reason}`)) return 'detour'
  return 'success'
}

// ─── Task timeline ──────────────────────────────────────

/**
 * Build cards from a task's compacted session. Returns events for the 3
 * columns (완료/우회/에러). Caller should also include lifecycle info bands
 * (created/started) separately.
 */
function buildCompactedEvents(
  task: Task,
  compacted: CompactedSession,
  ref: NonNullable<TimelineEvent['entityRef']>
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  // Anchor any items missing timestamps to compactedAt so they still sort.
  const anchor = compacted.compactedAt
  const tsOr = (t?: string) => t || anchor

  for (const it of compacted.completed) {
    events.push({
      id: it.id,
      timestamp: tsOr(it.timestamp),
      tone: 'success',
      category: '완료',
      title: it.title,
      rich: { detail: it.detail, refs: it.refs },
      entityRef: ref,
    })
  }
  for (const it of compacted.detours) {
    events.push({
      id: it.id,
      timestamp: tsOr(it.timestamp),
      tone: 'detour',
      category: '우회',
      title: it.title,
      rich: { reason: it.reason, refs: it.refs },
      entityRef: ref,
    })
  }
  for (const it of compacted.errors) {
    events.push({
      id: it.id,
      timestamp: tsOr(it.timestamp),
      tone: 'error',
      category: '에러',
      title: it.title,
      rich: { cause: it.cause, fix: it.fix, refs: it.refs },
      entityRef: ref,
    })
  }
  return events
}

export function buildTaskTimeline(task: Task): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const ref = { kind: 'task' as const, id: task.id, name: task.name }

  // Lifecycle: created (always shown as info anchor)
  events.push({
    id: `${task.id}-created`,
    timestamp: task.createdAt,
    tone: 'info',
    category: '생성',
    title: `Task 생성: ${task.name}`,
    body: task.purpose || undefined,
    entityRef: ref,
  })

  // Lifecycle: agent_start logs
  for (const l of task.logs.filter(l => l.type === 'agent_start')) {
    events.push({
      id: l.id,
      timestamp: l.timestamp,
      tone: 'info',
      category: '시작',
      title: 'Agent 실행 시작',
      body: l.content,
      entityRef: ref,
    })
  }

  // Compacted path: prefer LLM-curated 3-bucket narrative.
  if (task.compacted) {
    events.push(...buildCompactedEvents(task, task.compacted, ref))
  } else {
    // Fallback path: auto-extract from judgments + error logs.
    for (const j of task.plan?.judgmentLog ?? []) {
      events.push({
        id: `${task.id}-j-${j.timestamp}-${j.decision.slice(0, 16)}`,
        timestamp: j.timestamp,
        tone: judgmentTone(j),
        category: judgmentTone(j) === 'detour' ? '우회' : '결정',
        title: j.decision,
        body: j.reason,
        entityRef: ref,
      })
    }
    const errLogs = task.logs.filter(l => l.type === 'error')
    const errSeen = new Map<string, { ts: string; count: number }>()
    for (const e of errLogs) {
      const key = e.content.slice(0, 80)
      const prev = errSeen.get(key)
      if (prev) prev.count++
      else errSeen.set(key, { ts: e.timestamp, count: 1 })
    }
    for (const [msg, info] of errSeen) {
      events.push({
        id: `${task.id}-err-${info.ts}`,
        timestamp: info.ts,
        tone: 'error',
        category: '에러',
        title: msg,
        body: info.count > 1 ? `${info.count}회 발생` : undefined,
        entityRef: ref,
      })
    }
  }

  // Lifecycle: terminal status (skip when compacted — already represented).
  if (task.completedAt && !task.compacted) {
    const isFail = task.status === 'failed'
    events.push({
      id: `${task.id}-end`,
      timestamp: task.completedAt,
      tone: isFail ? 'error' : 'success',
      category: isFail ? '실패' : '완료',
      title: isFail ? `Task 실패: ${task.name}` : `Task 완료: ${task.name}`,
      body: task.summary?.progress || task.plan?.retrospective || undefined,
      entityRef: ref,
    })
  }

  return events.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
}

// ─── Phase timeline ─────────────────────────────────────

export function buildPhaseTimeline(phase: Phase, tasks: Task[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const phaseTasks = tasks.filter(t => t.phaseId === phase.id)

  // Phase created
  events.push({
    id: `${phase.id}-created`,
    timestamp: phase.createdAt,
    tone: 'info',
    category: '생성',
    title: `Phase 시작: ${phase.name}`,
    body: phase.description || undefined,
    entityRef: { kind: 'phase', id: phase.id, name: phase.name },
  })

  // Each task in this phase contributes its lifecycle (no errors at this level)
  for (const t of phaseTasks) {
    const ref = { kind: 'task' as const, id: t.id, name: t.name }
    events.push({
      id: `${t.id}-task-create`,
      timestamp: t.createdAt,
      tone: 'info',
      category: 'task 생성',
      title: t.name,
      body: t.purpose || undefined,
      entityRef: ref,
    })
    if (t.completedAt) {
      const fail = t.status === 'failed'
      events.push({
        id: `${t.id}-task-end`,
        timestamp: t.completedAt,
        tone: fail ? 'error' : 'success',
        category: fail ? 'task 실패' : 'task 완료',
        title: t.name,
        body: t.summary?.progress || undefined,
        entityRef: ref,
      })
    }

    // Compacted path: bubble up the task's curated buckets (prefixed with task name)
    if (t.compacted) {
      const inner = buildCompactedEvents(t, t.compacted, ref)
      for (const ev of inner) {
        events.push({ ...ev, body: ev.body, title: `${t.name} — ${ev.title}` })
      }
    } else {
      // Fallback: detour judgments + per-task error count summary
      for (const j of t.plan?.judgmentLog ?? []) {
        if (judgmentTone(j) === 'detour') {
          events.push({
            id: `${t.id}-j-${j.timestamp}-${j.decision.slice(0, 16)}`,
            timestamp: j.timestamp,
            tone: 'detour',
            category: '우회',
            title: j.decision,
            body: `${t.name} — ${j.reason}`,
            entityRef: ref,
          })
        }
      }
      const errCount = t.logs.filter(l => l.type === 'error').length
      if (errCount > 0 && t.completedAt) {
        events.push({
          id: `${t.id}-err-summary`,
          timestamp: t.completedAt,
          tone: 'error',
          category: '에러',
          title: `${t.name} — ${errCount}건 에러`,
          entityRef: ref,
        })
      }
    }
  }

  return events.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
}

// ─── Project timeline ───────────────────────────────────

export function buildProjectTimeline(project: Project, phases: Phase[], tasks: Task[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const pPhases = phases.filter(p => p.projectId === project.id)

  events.push({
    id: `${project.id}-created`,
    timestamp: project.createdAt,
    tone: 'info',
    category: '생성',
    title: `Project 시작: ${project.name}`,
    entityRef: { kind: 'project', id: project.id, name: project.name },
  })

  for (const ph of pPhases) {
    const phaseTasks = tasks.filter(t => t.phaseId === ph.id)
    const phRef = { kind: 'phase' as const, id: ph.id, name: ph.name }

    events.push({
      id: `${ph.id}-create`,
      timestamp: ph.createdAt,
      tone: 'info',
      category: 'phase 시작',
      title: ph.name,
      body: ph.description || undefined,
      entityRef: phRef,
    })

    // Phase complete = all tasks done
    if (phaseTasks.length > 0 && phaseTasks.every(t => t.status === 'completed')) {
      const lastDone = phaseTasks
        .map(t => t.completedAt)
        .filter(Boolean)
        .sort()
        .pop()
      if (lastDone) {
        events.push({
          id: `${ph.id}-done`,
          timestamp: lastDone,
          tone: 'success',
          category: 'phase 완료',
          title: `${ph.name} — 모든 task 완료`,
          body: `${phaseTasks.length}개 task`,
          entityRef: phRef,
        })
      }
    }

    // Phase-level failure surface = any task failed
    const failedTasks = phaseTasks.filter(t => t.status === 'failed')
    for (const ft of failedTasks) {
      if (ft.completedAt) {
        events.push({
          id: `${ft.id}-fail-bubble`,
          timestamp: ft.completedAt,
          tone: 'error',
          category: 'task 실패',
          title: ft.name,
          body: ph.name,
          entityRef: phRef,
        })
      }
    }
  }

  return events.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
}
