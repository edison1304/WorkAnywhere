import type { Task, Phase } from '../../../shared/types'
import { JobCard } from '../job/JobCard'
import styles from './StatusRail.module.css'

interface Props {
  allTasks: Task[]
  phases: Phase[]
  activeTaskId: string | null
  onSelectTask: (id: string | null) => void
}

const STATUS_ORDER = ['running', 'waiting', 'queued', 'idle', 'failed', 'completed'] as const

export function StatusRail({ allTasks, phases, activeTaskId, onSelectTask }: Props) {
  const counts = {
    running: allTasks.filter(t => t.status === 'running').length,
    waiting: allTasks.filter(t => t.status === 'waiting').length,
    failed: allTasks.filter(t => t.status === 'failed').length,
    completed: allTasks.filter(t => t.status === 'completed').length,
  }

  // Group tasks by phase
  const phaseMap = new Map(phases.map(ph => [ph.id, ph]))
  const grouped = phases.map(ph => ({
    phase: ph,
    tasks: allTasks
      .filter(t => t.phaseId === ph.id)
      .sort((a, b) =>
        STATUS_ORDER.indexOf(a.status as any) - STATUS_ORDER.indexOf(b.status as any)
      )
  })).filter(g => g.tasks.length > 0)

  return (
    <div className={styles.rail}>
      <div className={styles.header}>
        <span className={styles.title}>All Tasks</span>
        <span className={styles.count}>{allTasks.length}</span>
      </div>

      {/* Status summary */}
      <div className={styles.summary}>
        {counts.running > 0 && (
          <span className={styles.badge} data-status="running">{counts.running} running</span>
        )}
        {counts.waiting > 0 && (
          <span className={styles.badge} data-status="waiting">{counts.waiting} waiting</span>
        )}
        {counts.failed > 0 && (
          <span className={styles.badge} data-status="failed">{counts.failed} failed</span>
        )}
        {counts.completed > 0 && (
          <span className={styles.badge} data-status="completed">{counts.completed} done</span>
        )}
      </div>

      {/* Tasks grouped by phase */}
      <div className={styles.cardList}>
        {grouped.map(({ phase, tasks }) => (
          <div key={phase.id} className={styles.phaseGroup}>
            <div className={styles.phaseGroupTitle}>{phase.name}</div>
            {tasks.map(task => (
              <JobCard
                key={task.id}
                task={task}
                isActive={task.id === activeTaskId}
                onClick={() => onSelectTask(task.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
