import type { Job } from '../../../shared/types'
import { StatusDot } from './StatusDot'
import styles from './JobCard.module.css'

interface Props {
  job: Job
  isActive: boolean
  onClick: () => void
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function JobCard({ job, isActive, onClick }: Props) {
  return (
    <button
      className={`${styles.card} ${isActive ? styles.active : ''}`}
      data-status={job.status}
      onClick={onClick}
    >
      <div className={styles.header}>
        <StatusDot status={job.status} />
        <span className={styles.name}>{job.name}</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.status}>{job.status}</span>
        <span className={styles.time}>{timeAgo(job.updatedAt)}</span>
      </div>
    </button>
  )
}
