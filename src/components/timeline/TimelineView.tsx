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

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function TimelineView({ project, phase, task, phases, tasks, onSelectTask, onSelectPhase }: Props) {
  const { events, scopeLabel, scopeName, headline, compactedFocus } = useMemo(() => {
    if (task) {
      return {
        events: buildTaskTimeline(task),
        scopeLabel: 'Task',
        scopeName: task.name,
        headline: task.compacted?.headline,
        compactedFocus: task.compacted?.focusInstructions,
      }
    }
    if (phase) {
      return { events: buildPhaseTimeline(phase, tasks), scopeLabel: 'Phase', scopeName: phase.name, headline: undefined, compactedFocus: undefined }
    }
    if (project) {
      return { events: buildProjectTimeline(project, phases, tasks), scopeLabel: 'Project', scopeName: project.name, headline: undefined, compactedFocus: undefined }
    }
    return { events: [] as TimelineEvent[], scopeLabel: '', scopeName: '', headline: undefined, compactedFocus: undefined }
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

  let lastDay = ''

  const handleEntityClick = (ev: TimelineEvent) => {
    if (ev.entityRef?.kind === 'task') onSelectTask?.(ev.entityRef.id)
    else if (ev.entityRef?.kind === 'phase') onSelectPhase?.(ev.entityRef.id)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>Timeline</div>
        <div className={styles.subtitle}>
          <span className={styles.scopeLabel}>{scopeLabel}</span>
          <span className={styles.scopeName}>{scopeName}</span>
          <span className={styles.scopeMeta}>· {events.length}개 사건</span>
        </div>
        {headline && (
          <div className={styles.headlineBlock}>
            <div className={styles.headlineText}>{headline}</div>
            {compactedFocus && (
              <div className={styles.headlineFocus}>포커스: {compactedFocus}</div>
            )}
          </div>
        )}
      </div>

      <div className={styles.bodyWrap}>
        {/* Sticky column headers */}
        <div className={styles.colHeaders}>
          <div className={styles.timeHead} />
          <div className={`${styles.colHead} ${styles.col_success}`}>완료</div>
          <div className={`${styles.colHead} ${styles.col_detour}`}>우회</div>
          <div className={`${styles.colHead} ${styles.col_error}`}>에러</div>
        </div>

        <div className={styles.body}>
          {events.map(ev => {
            const day = dayKey(ev.timestamp)
            const isNewDay = day !== lastDay
            lastDay = day

            return (
              <div key={ev.id} className={styles.eventGroup}>
                {isNewDay && (
                  <div className={styles.dayDivider}>
                    <span>{day}</span>
                  </div>
                )}

                {ev.tone === 'info' ? (
                  // Info = milestone band, full width
                  <div className={styles.bandRow}>
                    <span className={styles.time}>{formatTime(ev.timestamp)}</span>
                    <div
                      className={`${styles.bandCard} ${ev.entityRef ? styles.clickable : ''}`}
                      onClick={ev.entityRef ? () => handleEntityClick(ev) : undefined}
                      role={ev.entityRef ? 'button' : undefined}
                      tabIndex={ev.entityRef ? 0 : undefined}
                    >
                      <div className={styles.bandHeader}>
                        <span className={styles.category}>{ev.category}</span>
                        {ev.entityRef && (
                          <span className={styles.entityRef}>{ev.entityRef.name}</span>
                        )}
                      </div>
                      <div className={styles.bandTitle}>{ev.title}</div>
                      {ev.body && <div className={styles.cardBody}>{ev.body}</div>}
                    </div>
                  </div>
                ) : (
                  <div className={styles.row}>
                    <span className={styles.time}>{formatTime(ev.timestamp)}</span>
                    <div
                      className={`${styles.card} ${styles[`tone_${ev.tone}`]} ${ev.entityRef ? styles.clickable : ''}`}
                      onClick={ev.entityRef ? () => handleEntityClick(ev) : undefined}
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
                      {ev.rich ? (
                        <div className={styles.richBody}>
                          {ev.rich.detail && (
                            <div className={styles.richLine}>{ev.rich.detail}</div>
                          )}
                          {ev.rich.reason && (
                            <div className={styles.richLine}>
                              <span className={styles.richLabel}>왜</span>
                              <span>{ev.rich.reason}</span>
                            </div>
                          )}
                          {ev.rich.cause && (
                            <div className={styles.richLine}>
                              <span className={styles.richLabel}>원인</span>
                              <span>{ev.rich.cause}</span>
                            </div>
                          )}
                          {ev.rich.fix && (
                            <div className={styles.richLine}>
                              <span className={styles.richLabel}>해결</span>
                              <span className={ev.rich.fix === '미해결' ? styles.richUnresolved : ''}>{ev.rich.fix}</span>
                            </div>
                          )}
                          {ev.rich.refs?.files && ev.rich.refs.files.length > 0 && (
                            <div className={styles.richRefs}>
                              {ev.rich.refs.files.map((f, i) => (
                                <code key={i} className={styles.refChip}>{f}</code>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        ev.body && <div className={styles.cardBody}>{ev.body}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
