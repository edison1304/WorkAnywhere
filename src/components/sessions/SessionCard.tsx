import { useEffect, useState } from 'react'
import type { Task, Phase } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './SessionCard.module.css'

type Tone = 'idle' | 'active' | 'attention' | 'done'

interface ActionLine {
  text: string
  tone: Tone
}

const TOOL_VERB: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  Bash: 'Running',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching web',
  Task: 'Delegating',
}

function extractTarget(content: string): string {
  // tool_call content example: 'Read({"file_path":"/path/to/file.ts"})'
  const m = content.match(/[\w_]+\s*[:=]\s*["'`]?([^"'`,)\s]+)/)
  if (!m) return ''
  const raw = m[1]
  return raw.split('/').pop() || raw
}

function deriveActionLine(task: Task): ActionLine {
  switch (task.status) {
    case 'running': {
      const lastTool = [...task.logs].reverse().find(l => l.type === 'tool_call')
      if (lastTool) {
        const tool = lastTool.meta?.tool || ''
        const verb = TOOL_VERB[tool] || tool || 'Working'
        const target = extractTarget(lastTool.content)
        return { text: target ? `${verb} ${target}` : verb, tone: 'active' }
      }
      const lastText = [...task.logs].reverse().find(l => l.type === 'text')
      if (lastText) return { text: lastText.content.slice(0, 60), tone: 'active' }
      return { text: 'Working…', tone: 'active' }
    }
    case 'waiting':   return { text: 'Waiting for you', tone: 'attention' }
    case 'review':    return { text: 'Ready for review', tone: 'attention' }
    case 'queued':    return { text: 'Queued', tone: 'idle' }
    case 'idle':      return { text: task.purpose || 'Idle', tone: 'idle' }
    case 'completed': return { text: task.summary?.progress || 'Done', tone: 'done' }
    case 'failed':    return { text: 'Failed', tone: 'attention' }
    default:          return { text: '', tone: 'idle' }
  }
}

function timeAgo(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function elapsedSince(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

interface Props {
  task: Task
  phase: Phase | null
  onClick: () => void
  onRunAgent?: (taskId: string) => void
  onApprove?: (taskId: string) => void
}

export function SessionCard({ task, phase, onClick, onRunAgent, onApprove }: Props) {
  // Tick every second so running cards show live elapsed time + re-render derived line.
  // Cheap because cards bail on render if nothing visually changes.
  const [now, setNow] = useState(() => Date.now())
  const isRunning = task.status === 'running'
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const action = deriveActionLine(task)
  const startedAt = task.logs[0]?.timestamp
  const liveElapsed = isRunning && startedAt ? elapsedSince(startedAt, now) : null

  const showRun = task.status === 'idle' || task.status === 'failed'
  const showApprove = task.status === 'review'

  return (
    <button
      type="button"
      className={`${styles.card} ${styles[`tone_${action.tone}`]}`}
      data-status={task.status}
      onClick={onClick}
    >
      <div className={styles.header}>
        <StatusDot status={task.status} />
        <span className={styles.name} title={task.name}>{task.name}</span>
        {phase && <span className={styles.phaseTag}>{phase.name}</span>}
      </div>

      <div className={styles.action} title={action.text}>{action.text}</div>

      <div className={styles.footer}>
        <span className={styles.time}>
          {liveElapsed ? `▸ ${liveElapsed}` : timeAgo(task.updatedAt, now)}
        </span>
        <div className={styles.actions} onClick={e => e.stopPropagation()}>
          {showRun && onRunAgent && (
            <button
              className={styles.miniBtn}
              onClick={() => onRunAgent(task.id)}
              title="Run"
            >
              ▶
            </button>
          )}
          {showApprove && onApprove && (
            <button
              className={styles.miniBtn}
              onClick={() => onApprove(task.id)}
              title="Approve"
            >
              ✓
            </button>
          )}
        </div>
      </div>
    </button>
  )
}
