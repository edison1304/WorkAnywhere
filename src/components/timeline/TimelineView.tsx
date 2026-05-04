import { useMemo } from 'react'
import type { Task, Phase, Project } from '../../../shared/types'
import {
  buildTaskTimeline, buildPhaseTimeline, buildProjectTimeline,
  type TimelineEvent,
} from './timelineEvents'
import styles from './TimelineView.module.css'

interface Props {
  project: Project | null
  phase: Phase | null
  task: Task | null
  phases: Phase[]
  tasks: Task[]
  onSelectTask?: (taskId: string) => void
  onSelectPhase?: (phaseId: string) => void
}

function formatTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function TimelineView({ project, phase, task, phases, tasks, onSelectTask, onSelectPhase }: Props) {
  // Most-specific selection wins: task > phase > project
  const { events, scopeLabel, scopeName } = useMemo(() => {
    if (task) {
      return { events: buildTaskTimeline(task), scopeLabel: 'Task', scopeName: task.name }
    }
    if (phase) {
      return { events: buildPhaseTimeline(phase, tasks), scopeLabel: 'Phase', scopeName: phase.name }
    }
    if (project) {
      return { events: buildProjectTimeline(project, phases, tasks), scopeLabel: 'Project', scopeName: project.name }
    }
    return { events: [] as TimelineEvent[], scopeLabel: '', scopeName: '' }
  }, [task, phase, project, phases, tasks])

  if (!project) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Timeline</div>
        <div className={styles.emptyHint}>프로젝트를 선택하면 시간 흐름이 표시됩니다.</div>
      </div>
    )
  }
  if (events.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>{scopeName} — 활동 없음</div>
        <div className={styles.emptyHint}>아직 기록할 사건이 없습니다.</div>
      </div>
    )
  }

  // Group events by day for the date dividers
  let lastDay = ''

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>Timeline</div>
        <div className={styles.subtitle}>
          <span className={styles.scopeLabel}>{scopeLabel}</span>
          <span className={styles.scopeName}>{scopeName}</span>
          <span className={styles.scopeMeta}>· {events.length}개 사건</span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.axis} aria-hidden />
        {events.map(ev => {
          const day = dayKey(ev.timestamp)
          const isNewDay = day !== lastDay
          lastDay = day
          const t = formatTime(ev.timestamp)
          const handleClick = () => {
            if (ev.entityRef?.kind === 'task') onSelectTask?.(ev.entityRef.id)
            else if (ev.entityRef?.kind === 'phase') onSelectPhase?.(ev.entityRef.id)
          }
          return (
            <div key={ev.id} className={styles.row}>
              {isNewDay && (
                <div className={styles.dayDivider}>
                  <span>{day}</span>
                </div>
              )}
              <div className={styles.rowInner}>
                <div className={styles.timeCol}>
                  <div className={styles.dot} data-tone={ev.tone} />
                  <div className={styles.time}>{t.time}</div>
                </div>
                <div
                  className={`${styles.card} ${styles[`tone_${ev.tone}`]} ${ev.entityRef ? styles.cardClickable : ''}`}
                  onClick={ev.entityRef ? handleClick : undefined}
                  role={ev.entityRef ? 'button' : undefined}
                  tabIndex={ev.entityRef ? 0 : undefined}
                >
                  <div className={styles.cardHeader}>
                    <span className={styles.category}>{ev.category}</span>
                    {ev.entityRef && (
                      <span className={styles.entityRef}>{ev.entityRef.name}</span>
                    )}
                  </div>
                  <div className={styles.cardTitle}>{ev.title}</div>
                  {ev.body && <div className={styles.cardBody}>{ev.body}</div>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
