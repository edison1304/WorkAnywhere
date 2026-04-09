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

export function DetachedStatusRail({ allTasks, phases, activeTaskId, onSelectTask }: Props) {
  const counts = {
    running: allTasks.filter(t => t.status === 'running').length,
    waiting: allTasks.filter(t => t.status === 'waiting').length,
    failed: allTasks.filter(t => t.status === 'failed').length,
    completed: allTasks.filter(t => t.status === 'completed').length,
  }

  const grouped = phases.map(ph => ({
    phase: ph,
    tasks: allTasks
      .filter(t => t.phaseId === ph.id)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status as any) - STATUS_ORDER.indexOf(b.status as any))
  })).filter(g => g.tasks.length > 0)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="titlebar-drag">
          <span style={{ fontSize: 13, fontWeight: 600 }}>📊 Status Rail</span>
        </div>
      </div>
      <div className={styles.rail} style={{ border: 'none', width: '100%', minWidth: 0 }}>
        <div className={styles.summary}>
          {counts.running > 0 && <span className={styles.badge} data-status="running">{counts.running} running</span>}
          {counts.waiting > 0 && <span className={styles.badge} data-status="waiting">{counts.waiting} waiting</span>}
          {counts.failed > 0 && <span className={styles.badge} data-status="failed">{counts.failed} failed</span>}
          {counts.completed > 0 && <span className={styles.badge} data-status="completed">{counts.completed} done</span>}
        </div>
        <div className={styles.cardList}>
          {grouped.map(({ phase, tasks }) => (
            <div key={phase.id} className={styles.phaseGroup}>
              <div className={styles.phaseGroupTitle}>{phase.name}</div>
              {tasks.map(task => (
                <JobCard key={task.id} task={task} isActive={task.id === activeTaskId} onClick={() => onSelectTask(task.id)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
