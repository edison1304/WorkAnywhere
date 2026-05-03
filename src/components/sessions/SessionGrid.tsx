import { useMemo } from 'react'
import type { Task, Phase } from '../../../shared/types'
import { SessionCard } from './SessionCard'
import styles from './SessionGrid.module.css'

interface Props {
  tasks: Task[]
  phases: Phase[]
  onSelectTask: (taskId: string) => void
  onRunAgent?: (taskId: string) => void
  onApprove?: (taskId: string) => void
}

// Cards sorted by how much they need user attention right now.
// Active states bubble up; completed/failed sink unless recent.
const STATUS_RANK: Record<string, number> = {
  running: 0,
  waiting: 1,
  review: 2,
  queued: 3,
  failed: 4,
  idle: 5,
  completed: 6,
}

export function SessionGrid({ tasks, phases, onSelectTask, onRunAgent, onApprove }: Props) {
  const phaseMap = useMemo(() => new Map(phases.map(p => [p.id, p])), [phases])

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 99
      const rb = STATUS_RANK[b.status] ?? 99
      if (ra !== rb) return ra - rb
      // within status: most-recent activity first
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }, [tasks])

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>아직 세션이 없습니다</div>
        <div className={styles.emptyHint}>좌측에서 task를 만들면 여기 카드로 표시됩니다.</div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.title}>Sessions</div>
        <div className={styles.subtitle}>{sorted.length}개 · 카드를 클릭하면 세션이 열립니다</div>
      </div>
      <div className={styles.grid}>
        {sorted.map(task => (
          <SessionCard
            key={task.id}
            task={task}
            phase={phaseMap.get(task.phaseId) ?? null}
            onClick={() => onSelectTask(task.id)}
            onRunAgent={onRunAgent}
            onApprove={onApprove}
          />
        ))}
      </div>
    </div>
  )
}
