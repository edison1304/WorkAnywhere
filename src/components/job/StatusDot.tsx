import type { JobStatus } from '../../../shared/types'

const STATUS_COLORS: Record<JobStatus, string> = {
  running: 'var(--accent)',
  waiting: 'var(--warning)',
  queued: 'var(--text-muted)',
  completed: 'var(--success)',
  failed: 'var(--error)',
  review: 'var(--info)',
}

interface Props {
  status: JobStatus
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
