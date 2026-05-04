import type { Task, Phase, Project } from '../../../shared/types'

// ─── Helpers ────────────────────────────────────────────

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function elapsedShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return `${Math.floor(diff / 1000)}s`
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

const TOOL_VERB: Record<string, string> = {
  Read: 'Reading', Write: 'Writing', Edit: 'Editing',
  Bash: 'Running', Glob: 'Searching', Grep: 'Searching',
  WebFetch: 'Fetching', WebSearch: 'Searching web', Task: 'Delegating',
}

function lastToolAction(task: Task): string | null {
  const last = [...task.logs].reverse().find(l => l.type === 'tool_call')
  if (!last) return null
  const verb = TOOL_VERB[last.meta?.tool ?? ''] || last.meta?.tool || 'Working'
  const m = last.content.match(/[\w_]+\s*[:=]\s*["'`]?([^"'`,)\s]+)/)
  const target = m ? (m[1].split('/').pop() || m[1]) : ''
  return target ? `${verb} ${target}` : verb
}

// ─── Insight rows (one per line in panel) ──────────────

export interface InsightRow {
  /** Tone is purely visual — drives icon/dot color in the panel. */
  tone: 'neutral' | 'active' | 'attention' | 'fail' | 'done'
  /** Short label, ~10 chars. */
  label: string
  /** Value text. May be longer; panel will clip to 2 lines max. */
  value: string
}

// ─── Task insight ──────────────────────────────────────

export function taskInsight(task: Task): InsightRow[] {
  const rows: InsightRow[] = []
  const sum = task.summary
  const plan = task.plan

  // 1. "Now" — what is happening right this moment
  if (task.status === 'running') {
    const action = lastToolAction(task)
    rows.push({ tone: 'active', label: '지금', value: action ?? sum?.currentStep ?? 'Working' })
  } else if (task.status === 'waiting') {
    rows.push({ tone: 'attention', label: '지금', value: '사용자 입력 대기' })
  } else if (task.status === 'review') {
    rows.push({ tone: 'attention', label: '지금', value: '검토 대기' })
  } else if (task.status === 'failed') {
    rows.push({ tone: 'fail', label: '지금', value: '실패' })
  } else if (task.status === 'completed') {
    rows.push({ tone: 'done', label: '결과', value: sum?.progress ?? '완료' })
  } else if (task.status === 'queued') {
    rows.push({ tone: 'neutral', label: '지금', value: '대기열' })
  } else {
    rows.push({ tone: 'neutral', label: '목적', value: task.purpose || task.prompt.slice(0, 80) })
  }

  // 2. Checklist progress (highest signal — comes from CHECKLIST.md)
  if (plan?.checklist?.length) {
    const done = plan.checklist.filter(c => c.done).length
    const total = plan.checklist.length
    const nextItem = plan.checklist.find(c => !c.done)
    const value = nextItem
      ? `${done}/${total} · 다음: ${nextItem.text}`
      : `${done}/${total}`
    rows.push({ tone: done === total ? 'done' : 'active', label: '체크리스트', value })
  } else if (sum?.completedSteps?.length) {
    // Fallback to TaskSummary
    const recent = sum.completedSteps.slice(-3).join(' · ')
    rows.push({ tone: 'done', label: '끝낸 것', value: recent })
  }

  // 3. 다음 (only when no checklist — checklist row already shows next)
  if (!plan?.checklist?.length && sum?.nextSteps?.length && task.status !== 'completed') {
    const upcoming = sum.nextSteps.slice(0, 3).join(' · ')
    rows.push({ tone: 'neutral', label: '다음', value: upcoming })
  }

  // 4. 이슈
  const errLogs = task.logs.slice(-30).filter(l => l.type === 'error')
  if (sum?.issues?.length) {
    rows.push({ tone: 'fail', label: '이슈', value: sum.issues.slice(0, 2).join(' · ') })
  } else if (errLogs.length > 0) {
    rows.push({ tone: 'fail', label: '이슈', value: errLogs[errLogs.length - 1].content.slice(0, 100) })
  }

  // 5. Time
  if (task.status === 'running' && task.logs[0]) {
    rows.push({ tone: 'neutral', label: '경과', value: elapsedShort(task.logs[0].timestamp) })
  } else {
    rows.push({ tone: 'neutral', label: '활동', value: timeAgoShort(task.updatedAt) })
  }

  return rows.slice(0, 5)
}

// ─── Phase insight ─────────────────────────────────────

export function phaseInsight(phase: Phase, tasks: Task[]): InsightRow[] {
  const rows: InsightRow[] = []
  const phaseTasks = tasks.filter(t => t.phaseId === phase.id)

  const running = phaseTasks.filter(t => t.status === 'running')
  const waiting = phaseTasks.filter(t => t.status === 'waiting' || t.status === 'review')
  const failed = phaseTasks.filter(t => t.status === 'failed')
  const done = phaseTasks.filter(t => t.status === 'completed')
  const idle = phaseTasks.filter(t => t.status === 'idle' || t.status === 'queued')

  // 1. Headline status
  if (running.length > 0) {
    const r = running[0]
    rows.push({ tone: 'active', label: '활성', value: `${r.name} 외 ${running.length - 1 > 0 ? running.length - 1 + '개' : '없음'}` })
  } else if (waiting.length > 0) {
    rows.push({ tone: 'attention', label: '대기', value: `${waiting[0].name} 외 ${waiting.length - 1}개 사용자 대기` })
  } else if (failed.length > 0) {
    rows.push({ tone: 'fail', label: '실패', value: `${failed[0].name} 외 ${failed.length - 1}개` })
  } else if (idle.length > 0) {
    rows.push({ tone: 'neutral', label: '대기', value: `${idle[0].name} (다음 시작 예정)` })
  } else if (done.length === phaseTasks.length && phaseTasks.length > 0) {
    rows.push({ tone: 'done', label: '완료', value: '모든 task 종료' })
  }

  // 2. 진척
  if (phaseTasks.length > 0) {
    rows.push({ tone: 'neutral', label: '진척', value: `${done.length}/${phaseTasks.length} 완료` })
  }

  // 3. Phase summary current state (if AI-generated)
  if (phase.summary?.currentState) {
    rows.push({ tone: 'neutral', label: '상태', value: phase.summary.currentState })
  }

  // 4. Phase summary issues
  if (phase.summary?.issues?.length) {
    rows.push({ tone: 'fail', label: '이슈', value: phase.summary.issues.slice(0, 2).join(' · ') })
  }

  // 5. Pipeline
  if (phase.summary?.pipeline) {
    rows.push({ tone: 'neutral', label: '파이프', value: phase.summary.pipeline })
  } else if (phase.description) {
    rows.push({ tone: 'neutral', label: '목적', value: phase.description })
  }

  return rows.slice(0, 5)
}

// ─── Project insight ───────────────────────────────────

export function projectInsight(project: Project, phases: Phase[], tasks: Task[]): InsightRow[] {
  const rows: InsightRow[] = []
  const pPhases = phases.filter(p => p.projectId === project.id)
  const pTasks = tasks.filter(t => t.projectId === project.id)

  const running = pTasks.filter(t => t.status === 'running').length
  const attention = pTasks.filter(t => t.status === 'waiting' || t.status === 'review').length
  const failed = pTasks.filter(t => t.status === 'failed').length
  const done = pTasks.filter(t => t.status === 'completed').length

  // 1. Active phase
  const activePhase = pPhases.find(ph =>
    pTasks.some(t => t.phaseId === ph.id && (t.status === 'running' || t.status === 'waiting')),
  )
  if (activePhase) {
    rows.push({ tone: 'active', label: '활성 단계', value: activePhase.name })
  } else if (project.summary?.currentPhase) {
    rows.push({ tone: 'neutral', label: '현재 단계', value: project.summary.currentPhase })
  }

  // 2. 진척
  rows.push({ tone: 'neutral', label: '진척', value: `${done}/${pTasks.length} task 완료 · ${pPhases.length} phase` })

  // 3. Headline counts
  const counts: string[] = []
  if (running > 0) counts.push(`▶ ${running} 진행`)
  if (attention > 0) counts.push(`⌛ ${attention} 대기`)
  if (failed > 0) counts.push(`✗ ${failed} 실패`)
  if (counts.length > 0) {
    rows.push({ tone: failed > 0 ? 'fail' : attention > 0 ? 'attention' : 'active', label: '현재', value: counts.join(' · ') })
  }

  // 4. Project summary
  if (project.summary?.overallProgress) {
    rows.push({ tone: 'neutral', label: '요약', value: project.summary.overallProgress })
  } else if (project.summary?.pipeline) {
    rows.push({ tone: 'neutral', label: '파이프', value: project.summary.pipeline })
  }

  // 5. Blockers
  if (project.summary?.blockers?.length) {
    rows.push({ tone: 'fail', label: '막힘', value: project.summary.blockers.slice(0, 2).join(' · ') })
  }

  return rows.slice(0, 5)
}
