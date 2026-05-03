import { useEffect, useMemo, useState, useCallback } from 'react'
import type {
  Task,
  Phase,
  Project,
  ScheduleResult,
  InteractionLevel,
  WeightHint,
} from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import { HoverPanel } from '../insight/HoverPanel'
import { InsightPanel } from '../insight/InsightPanel'
import { ReasonChip } from '../insight/ReasonChip'
import { taskInsight } from '../insight/insights'
import { scheduleReason } from '../insight/reasons'
import styles from './SchedulePage.module.css'

interface Props {
  project: Project | null
  tasks: Task[]
  phases: Phase[]
  onSelectTask: (taskId: string) => void
  onRunAgent: (taskId: string) => void
  onUpdateTask: (taskId: string, patch: Partial<Task>) => void
}

const INTERACTION_CYCLE: InteractionLevel[] = ['autonomous', 'mixed', 'interactive']
const WEIGHT_CYCLE: WeightHint[] = ['light', 'normal', 'heavy']

const INTERACTION_ICON: Record<InteractionLevel, string> = {
  autonomous: '🤖',
  mixed: '🤝',
  interactive: '👤',
}
const WEIGHT_ICON: Record<WeightHint, string> = {
  light: '🪶',
  normal: '⚖',
  heavy: '🔋',
}

function nextInCycle<T>(arr: T[], current: T): T {
  const i = arr.indexOf(current)
  return arr[(i + 1) % arr.length]
}

export function SchedulePage({
  project,
  tasks,
  phases,
  onSelectTask,
  onRunAgent,
  onUpdateTask,
}: Props) {
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const phaseMap = useMemo(() => new Map(phases.map(p => [p.id, p])), [phases])

  // Recompute when project, tasks (status/override), or phases change.
  // Hash on the same fields the backend uses so we don't fetch on noise.
  const computeKey = useMemo(() => {
    if (!project) return ''
    return tasks
      .filter(t => t.projectId === project.id)
      .map(t => `${t.id}:${t.status}:${t.interactionLevel ?? '_'}:${t.weightHint ?? '_'}`)
      .sort()
      .join('|')
  }, [project, tasks])

  useEffect(() => {
    if (!project || !window.api) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.scheduleCompute(project.id).then(res => {
      if (cancelled) return
      if (res.success && res.result) {
        setResult(res.result)
      } else {
        setError(res.error || 'Failed to compute schedule')
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [project?.id, computeKey])

  const handleCycleInteraction = useCallback((task: Task) => {
    const current = task.interactionLevel ?? 'autonomous'  // matches default behavior visually
    const next = nextInCycle(INTERACTION_CYCLE, current)
    onUpdateTask(task.id, { interactionLevel: next })
  }, [onUpdateTask])

  const handleCycleWeight = useCallback((task: Task) => {
    const current = task.weightHint ?? 'normal'
    const next = nextInCycle(WEIGHT_CYCLE, current)
    onUpdateTask(task.id, { weightHint: next })
  }, [onUpdateTask])

  if (!project) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Schedule</div>
        <div className={styles.emptyHint}>프로젝트를 선택하면 추천 순서가 표시됩니다.</div>
      </div>
    )
  }

  const ordered = result?.ordered ?? []
  const splitIndex = result?.splitIndex ?? ordered.length

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>오늘 무엇을 할까</div>
        <div className={styles.subtitle}>
          {loading
            ? '추천 순서 계산 중…'
            : ordered.length === 0
              ? '진행할 task가 없습니다.'
              : `위쪽은 던져두면 되는 일, 아래쪽은 직접 손이 가야 하는 일입니다.`}
        </div>
        {result?.splitSource === 'fallback' && (
          <div className={styles.fallbackHint}>
            * LLM 분기 실패 — 기본 규칙으로 표시 중
          </div>
        )}
        {error && <div className={styles.error}>{error}</div>}
      </div>

      <ol className={styles.list}>
        {ordered.map((s, i) => {
          const task = taskMap.get(s.taskId)
          if (!task) return null
          const phase = phaseMap.get(task.phaseId)
          const isAfterSplit = i === splitIndex
          const summaryLine = task.summary?.progress || task.purpose || task.prompt.slice(0, 80)
          const reason = scheduleReason(task, s.nice, s.interactionLevel, s.weightHint)
          return (
            <li key={s.taskId}>
              {isAfterSplit && (
                <div className={styles.divider}>
                  <span className={styles.dividerText}>여기부터는 직접</span>
                </div>
              )}
              <HoverPanel
                panel={<InsightPanel title={task.name} subtitle={phase?.name} rows={taskInsight(task)} />}
              >
                <div className={styles.row} onClick={() => onSelectTask(s.taskId)}>
                  <span className={styles.index}>{i + 1}</span>
                  <StatusDot status={task.status} />
                  <div className={styles.body}>
                    <div className={styles.name}>
                      {task.name}
                      {phase && <span className={styles.phaseTag}>{phase.name}</span>}
                      <ReasonChip reason={reason} small />
                    </div>
                    <div className={styles.summary}>{summaryLine}</div>
                  </div>
                <div className={styles.toggles} onClick={e => e.stopPropagation()}>
                  <button
                    className={`${styles.toggle} ${s.inferred.weight ? styles.toggleInferred : ''}`}
                    onClick={() => handleCycleWeight(task)}
                    title={`자원: ${s.weightHint}${s.inferred.weight ? ' (자동 추정)' : ''}`}
                  >
                    {WEIGHT_ICON[s.weightHint]}
                  </button>
                  <button
                    className={`${styles.toggle} ${s.inferred.interaction ? styles.toggleInferred : ''}`}
                    onClick={() => handleCycleInteraction(task)}
                    title={`간섭: ${s.interactionLevel}${s.inferred.interaction ? ' (자동 추정)' : ''}`}
                  >
                    {INTERACTION_ICON[s.interactionLevel]}
                  </button>
                </div>
                  {(task.status === 'idle' || task.status === 'failed') && (
                    <button
                      className={styles.runBtn}
                      onClick={e => { e.stopPropagation(); onRunAgent(task.id) }}
                      title="시작"
                    >
                      ▶
                    </button>
                  )}
                </div>
              </HoverPanel>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
