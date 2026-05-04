import { useMemo } from 'react'
import type { Project, Phase, Task } from '../../../shared/types'
import { EventTreePanel } from '../layout/EventTreePanel'
import { StatusDot } from '../job/StatusDot'
import styles from './ProjectEventTree.module.css'

/**
 * ProjectEventTree — project-wide swimlane view of task event arcs.
 *
 * y-axis = task (grouped by phase), x-axis = time order.
 * Each lane reuses EventTreePanel (variant="detailed") so the per-task
 * horizontal card flow stays identical to the in-task Tree tab.
 *
 * v1: lanes scroll independently (no shared time axis). Cards order
 * left→right by timestamp, leftmost = oldest, rightmost = current/live.
 */

interface Props {
  project: Project | null
  phases: Phase[]
  tasks: Task[]
  onSelectTask: (taskId: string) => void
}

export function ProjectEventTree({ project, phases, tasks, onSelectTask }: Props) {
  const sections = useMemo<Array<{ phase: Phase | null; tasks: Task[] }>>(() => {
    if (!project) return []
    const projectTasks = tasks.filter(t => t.projectId === project.id)
    const projectPhases = phases
      .filter(p => p.projectId === project.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const grouped: Array<{ phase: Phase | null; tasks: Task[] }> = projectPhases
      .map(phase => ({
        phase: phase as Phase | null,
        tasks: projectTasks
          .filter(t => t.phaseId === phase.id)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      }))
      .filter(g => g.tasks.length > 0)

    const orphanTasks = projectTasks.filter(
      t => !projectPhases.some(p => p.id === t.phaseId),
    )
    if (orphanTasks.length > 0) {
      grouped.push({ phase: null, tasks: orphanTasks })
    }
    return grouped
  }, [project, phases, tasks])

  if (!project) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Project Tree</div>
        <div className={styles.emptyHint}>프로젝트를 선택하면 사건 트리가 표시됩니다.</div>
      </div>
    )
  }

  if (sections.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>{project.name} — task 없음</div>
        <div className={styles.emptyHint}>task를 만들면 여기 swimlane으로 표시됩니다.</div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>Project Tree</div>
        <div className={styles.subtitle}>
          <span className={styles.scopeName}>{project.name}</span>
          <span className={styles.scopeMeta}>
            · 가로축 = 시간 흐름 (왼쪽이 과거, 오른쪽이 현재)
          </span>
        </div>
      </div>

      <div className={styles.body}>
        {sections.map((section, idx) => (
          <section
            key={section.phase?.id ?? `orphan-${idx}`}
            className={styles.phaseSection}
          >
            <div className={styles.phaseHeader}>
              <span className={styles.phaseName}>
                {section.phase?.name ?? '(Phase 없음)'}
              </span>
              <span className={styles.phaseCount}>
                {section.tasks.length}개 task
              </span>
            </div>

            <div className={styles.lanes}>
              {section.tasks.map(task => (
                <Swimlane
                  key={task.id}
                  task={task}
                  onSelectTask={onSelectTask}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Swimlane({
  task,
  onSelectTask,
}: {
  task: Task
  onSelectTask: (id: string) => void
}) {
  return (
    <div className={styles.lane} data-status={task.status}>
      <button
        className={styles.laneHeader}
        onClick={() => onSelectTask(task.id)}
        title={`Open ${task.name}`}
      >
        <StatusDot status={task.status} />
        <span className={styles.laneName}>{task.name}</span>
        <span className={styles.laneStatus}>{task.status}</span>
      </button>
      <div className={styles.laneFlow}>
        <EventTreePanel
          task={task}
          variant="detailed"
          hideHeader
          hideLegend
          compactEmpty
        />
      </div>
    </div>
  )
}
