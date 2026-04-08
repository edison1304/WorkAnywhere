import type { Job } from '../../../shared/types'
import { JobCard } from '../job/JobCard'
import styles from './StatusRail.module.css'

interface Props {
  jobs: Job[]
  activeJobId: string | null
  onSelectJob: (id: string | null) => void
}

const STATUS_ORDER = ['running', 'waiting', 'queued', 'review', 'failed', 'completed'] as const

export function StatusRail({ jobs, activeJobId, onSelectJob }: Props) {
  const sorted = [...jobs].sort((a, b) =>
    STATUS_ORDER.indexOf(a.status as any) - STATUS_ORDER.indexOf(b.status as any)
  )

  const counts = {
    running: jobs.filter(j => j.status === 'running').length,
    waiting: jobs.filter(j => j.status === 'waiting').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  }

  return (
    <div className={styles.rail}>
      <div className={styles.header}>
        <span className={styles.title}>All Jobs</span>
        <span className={styles.count}>{jobs.length}</span>
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

      {/* Job cards */}
      <div className={styles.cardList}>
        {sorted.map(job => (
          <JobCard
            key={job.id}
            job={job}
            isActive={job.id === activeJobId}
            onClick={() => onSelectJob(job.id)}
          />
        ))}
      </div>
    </div>
  )
}
