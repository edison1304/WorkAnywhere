import type { TaskStatus } from '../../../shared/types'

const STATUS_COLORS: Record<TaskStatus, string> = {
  idle: 'var(--text-muted)',
  queued: 'var(--text-muted)',
  running: 'var(--accent)',
  waiting: 'var(--warning)',
  review: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--error)',
}

interface Props {
  status: TaskStatus
  size?: number
}

export function StatusDot({ status, size = 8 }: Props) {
  const color = STATUS_COLORS[status]
  const isAnimated = status === 'running'

  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
        animation: isAnimated ? 'pulse 2s infinite' : 'none',
      }}
    />
  )
}
