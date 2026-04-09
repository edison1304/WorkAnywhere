import type { Task } from '../../../shared/types'
import { StatusDot } from './StatusDot'
import styles from './JobCard.module.css'

interface Props {
  task: Task
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

export function JobCard({ task, isActive, onClick }: Props) {
  return (
    <button
      className={`${styles.card} ${isActive ? styles.active : ''}`}
      data-status={task.status}
      onClick={onClick}
    >
      <div className={styles.header}>
        <StatusDot status={task.status} />
        <span className={styles.name}>{task.name}</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.status}>{task.status}</span>
        <span className={styles.time}>{timeAgo(task.updatedAt)}</span>
      </div>
    </button>
  )
}
