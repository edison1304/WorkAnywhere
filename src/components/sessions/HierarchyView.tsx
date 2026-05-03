import { useEffect, useMemo, useState } from 'react'
import type { Task, Phase, Project, TaskStatus } from '../../../shared/types'
import { HoverPanel } from '../insight/HoverPanel'
import { InsightPanel } from '../insight/InsightPanel'
import { ReasonChip } from '../insight/ReasonChip'
import { taskInsight, phaseInsight, projectInsight } from '../insight/insights'
import { taskStateReason, phaseReason, issueReason } from '../insight/reasons'
import styles from './HierarchyView.module.css'

interface Props {
  projects: Project[]
  phases: Phase[]
  tasks: Task[]
  activeProjectId: string | null
  onSelectTask: (taskId: string) => void
  onRunAgent?: (taskId: string) => void
  onApprove?: (taskId: string) => void
}

// ─── Health & progress derivation ───────────────────────

type Tone = 'active' | 'attention' | 'fail' | 'done' | 'idle'

const STATUS_FALLBACK_PROGRESS: Record<TaskStatus, number> = {
  idle: 0,
  queued: 0.05,
  running: 0.5,
  waiting: 0.6,
  review: 0.9,
  completed: 1,
  failed: 0.4,
}

function taskProgress(task: Task): number {
  const sum = task.summary
  if (sum) {
    const done = sum.completedSteps?.length ?? 0
    const next = sum.nextSteps?.length ?? 0
    const total = done + next
    if (total > 0) {
      // Plan-based progress, clamped so a finished status forces 100%
      if (task.status === 'completed') return 1
      return Math.min(0.99, done / total)
    }
  }
  return STATUS_FALLBACK_PROGRESS[task.status] ?? 0
}

function taskTone(task: Task): Tone {
  switch (task.status) {
    case 'failed':    return 'fail'
    case 'waiting':
    case 'review':    return 'attention'
    case 'running':
    case 'queued':    return 'active'
    case 'completed': return 'done'
    default:          return 'idle'
  }
}

function taskHasIssue(task: Task): boolean {
  if (task.summary?.issues?.length) return true
  // recent error log within this task counts too
  return task.logs.slice(-30).some(l => l.type === 'error')
}

interface AggregateCounts {
  done: number
  active: number   // running + queued
  attention: number // waiting + review
  fail: number
  idle: number
  total: number
  issues: number
}

function aggregate(tasks: Task[]): AggregateCounts {
  const a: AggregateCounts = { done: 0, active: 0, attention: 0, fail: 0, idle: 0, total: tasks.length, issues: 0 }
  for (const t of tasks) {
    if (taskHasIssue(t)) a.issues++
    switch (t.status) {
      case 'completed': a.done++; break
      case 'running':
      case 'queued':    a.active++; break
      case 'waiting':
      case 'review':    a.attention++; break
      case 'failed':    a.fail++; break
      default:          a.idle++
    }
  }
  return a
}

function groupTone(c: AggregateCounts): Tone {
  if (c.fail > 0) return 'fail'
  if (c.attention > 0) return 'attention'
  if (c.active > 0) return 'active'
  if (c.total > 0 && c.done === c.total) return 'done'
  return 'idle'
}

// ─── Live action line for a running task ────────────────

const TOOL_VERB: Record<string, string> = {
  Read: 'Reading', Write: 'Writing', Edit: 'Editing',
  Bash: 'Running', Glob: 'Searching', Grep: 'Searching',
  WebFetch: 'Fetching', WebSearch: 'Searching web', Task: 'Delegating',
}

function liveAction(task: Task): string {
  if (task.status !== 'running') return ''
  const lastTool = [...task.logs].reverse().find(l => l.type === 'tool_call')
  if (!lastTool) return 'Working…'
  const verb = TOOL_VERB[lastTool.meta?.tool ?? ''] || lastTool.meta?.tool || 'Working'
  const m = lastTool.content.match(/[\w_]+\s*[:=]\s*["'`]?([^"'`,)\s]+)/)
  const target = m ? (m[1].split('/').pop() || m[1]) : ''
  return target ? `${verb} ${target}` : verb
}

// ─── Stacked bar rendering ─────────────────────────────

function StackedBar({ counts }: { counts: AggregateCounts }) {
  if (counts.total === 0) return null
  const seg = (n: number) => ({ flex: n })
  return (
    <div className={styles.stackBar}>
      {counts.done      > 0 && <div className={styles.segDone}      style={seg(counts.done)} />}
      {counts.active    > 0 && <div className={styles.segActive}    style={seg(counts.active)} />}
      {counts.attention > 0 && <div className={styles.segAttention} style={seg(counts.attention)} />}
      {counts.fail      > 0 && <div className={styles.segFail}      style={seg(counts.fail)} />}
      {counts.idle      > 0 && <div className={styles.segIdle}      style={seg(counts.idle)} />}
    </div>
  )
}

function CountChips({ counts }: { counts: AggregateCounts }) {
  return (
    <div className={styles.chips}>
      {counts.active    > 0 && <span className={`${styles.chip} ${styles.chipActive}`}>▶ {counts.active}</span>}
      {counts.attention > 0 && <span className={`${styles.chip} ${styles.chipAttention}`}>⌛ {counts.attention}</span>}
      {counts.fail      > 0 && <span className={`${styles.chip} ${styles.chipFail}`}>✗ {counts.fail}</span>}
      {counts.issues    > 0 && <span className={`${styles.chip} ${styles.chipIssue}`}>⚠ {counts.issues}</span>}
    </div>
  )
}

// ─── Per-task slim progress bar ────────────────────────

function TaskBar({ task }: { task: Task }) {
  const pct = Math.round(taskProgress(task) * 100)
  const tone = taskTone(task)
  return (
    <div className={styles.taskBarTrack}>
      <div className={`${styles.taskBarFill} ${styles[`tone_${tone}`]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ─── TaskRow ────────────────────────────────────────────

interface TaskRowProps {
  task: Task
  phaseName?: string
  onClick: () => void
  onRunAgent?: (id: string) => void
  onApprove?: (id: string) => void
}

function TaskRow({ task, phaseName, onClick, onRunAgent, onApprove }: TaskRowProps) {
  const tone = taskTone(task)
  const action = liveAction(task)
  const issue = taskHasIssue(task)
  const showRun = task.status === 'idle' || task.status === 'failed'
  const showApprove = task.status === 'review'

  // F2 reason chips — silent when ambiguous
  const stateChip = taskStateReason(task)
  const issueChip = issueReason(task)

  // F1 hover panel content
  const insight = taskInsight(task)

  return (
    <HoverPanel
      panel={<InsightPanel title={task.name} subtitle={phaseName} rows={insight} />}
    >
      <div className={`${styles.row} ${styles[`rowTone_${tone}`]}`} onClick={onClick}>
        <span className={`${styles.statusIcon} ${styles[`tone_${tone}`]}`}>
          {task.status === 'completed' ? '✓'
            : task.status === 'failed' ? '✗'
            : task.status === 'running' ? '▶'
            : task.status === 'waiting' ? '⌛'
            : task.status === 'review' ? '👁'
            : task.status === 'queued' ? '⋯'
            : '○'}
        </span>
        <span className={styles.rowName} title={task.name}>{task.name}</span>
        {issue
          ? <ReasonChip reason={issueChip ?? { text: 'issue', tone: 'fail' }} small />
          : <ReasonChip reason={stateChip} small />}
        <TaskBar task={task} />
        {action && <span className={styles.rowAction} title={action}>▸ {action}</span>}
        <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
          {showRun && onRunAgent && (
            <button className={styles.miniBtn} onClick={() => onRunAgent(task.id)} title="Run">▶</button>
          )}
          {showApprove && onApprove && (
            <button className={styles.miniBtn} onClick={() => onApprove(task.id)} title="Approve">✓</button>
          )}
        </div>
      </div>
    </HoverPanel>
  )
}

// ─── PhaseGroupCard ────────────────────────────────────

function PhaseGroupCard({
  phase, tasks, onSelectTask, onRunAgent, onApprove,
}: {
  phase: Phase
  tasks: Task[]
  onSelectTask: (id: string) => void
  onRunAgent?: (id: string) => void
  onApprove?: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const sorted = useMemo(() => [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [tasks])
  const counts = useMemo(() => aggregate(tasks), [tasks])
  const tone = groupTone(counts)
  const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0

  const reason = phaseReason(phase, tasks)
  const insight = phaseInsight(phase, tasks)

  return (
    <div className={`${styles.phaseCard} ${styles[`tone_${tone}`]}`}>
      <HoverPanel panel={<InsightPanel title={phase.name} subtitle="phase" rows={insight} />}>
        <button className={styles.phaseHeader} onClick={() => setCollapsed(c => !c)}>
          <span className={styles.collapseChevron}>{collapsed ? '▸' : '▾'}</span>
          <span className={styles.phaseName}>{phase.name}</span>
          <ReasonChip reason={reason} small />
          <span className={styles.phaseRatio}>{counts.done}/{counts.total}</span>
          <span className={styles.phasePct}>{pct}%</span>
          <CountChips counts={counts} />
        </button>
      </HoverPanel>
      <StackedBar counts={counts} />
      {!collapsed && (
        <div className={styles.taskList}>
          {sorted.map(t => (
            <TaskRow
              key={t.id} task={t} phaseName={phase.name}
              onClick={() => onSelectTask(t.id)}
              onRunAgent={onRunAgent}
              onApprove={onApprove}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ProjectGroupCard ───────────────────────────────────

function ProjectGroupCard({
  project, phases, tasks, onSelectTask, onRunAgent, onApprove,
}: {
  project: Project
  phases: Phase[]
  tasks: Task[]
  onSelectTask: (id: string) => void
  onRunAgent?: (id: string) => void
  onApprove?: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const projectPhases = useMemo(
    () => phases.filter(p => p.projectId === project.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [phases, project.id],
  )
  const projectTasks = useMemo(
    () => tasks.filter(t => t.projectId === project.id),
    [tasks, project.id],
  )
  const counts = useMemo(() => aggregate(projectTasks), [projectTasks])
  const tone = groupTone(counts)
  const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0

  const insight = projectInsight(project, projectPhases, projectTasks)

  return (
    <div className={`${styles.projectCard} ${styles[`tone_${tone}`]}`}>
      <HoverPanel panel={<InsightPanel title={project.name} subtitle="project" rows={insight} />}>
        <button className={styles.projectHeader} onClick={() => setCollapsed(c => !c)}>
          <span className={styles.collapseChevron}>{collapsed ? '▸' : '▾'}</span>
          <span className={styles.projectName}>{project.name}</span>
          <span className={styles.projectRatio}>{counts.done}/{counts.total}</span>
          <span className={styles.projectPct}>{pct}%</span>
          <CountChips counts={counts} />
        </button>
      </HoverPanel>
      <StackedBar counts={counts} />
      {!collapsed && (
        <div className={styles.phaseList}>
          {projectPhases.map(ph => {
            const phTasks = projectTasks.filter(t => t.phaseId === ph.id)
            if (phTasks.length === 0) return null
            return (
              <PhaseGroupCard
                key={ph.id} phase={ph} tasks={phTasks}
                onSelectTask={onSelectTask}
                onRunAgent={onRunAgent}
                onApprove={onApprove}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── HierarchyView ─────────────────────────────────────

export function HierarchyView({
  projects, phases, tasks, activeProjectId, onSelectTask, onRunAgent, onApprove,
}: Props) {
  // Tick every second so running task action lines + bars stay fresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const hasRunning = tasks.some(t => t.status === 'running')
    if (!hasRunning) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [tasks])

  // Active project first, others below
  const ordered = useMemo(() => {
    if (!activeProjectId) return projects
    const active = projects.find(p => p.id === activeProjectId)
    const rest = projects.filter(p => p.id !== activeProjectId)
    return active ? [active, ...rest] : projects
  }, [projects, activeProjectId])

  if (projects.length === 0 || tasks.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>아직 task가 없습니다</div>
        <div className={styles.emptyHint}>좌측에서 task를 만들면 여기 트리로 표시됩니다.</div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.title}>Overview</div>
        <div className={styles.subtitle}>위계와 진행 상황. 카드를 클릭하면 task가 열립니다.</div>
      </div>
      <div className={styles.body}>
        {ordered.map(project => (
          <ProjectGroupCard
            key={project.id}
            project={project}
            phases={phases}
            tasks={tasks}
            onSelectTask={onSelectTask}
            onRunAgent={onRunAgent}
            onApprove={onApprove}
          />
        ))}
      </div>
    </div>
  )
}
