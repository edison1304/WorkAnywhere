import { useState } from 'react'
import type { Project, Phase, Task } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './DetachedMonitor.module.css'

const ACTIVE_STATUSES = new Set(['running', 'waiting', 'queued'])

function isVisibleInMonitor(task: Task): boolean {
  if (ACTIVE_STATUSES.has(task.status)) return true
  if (task.status === 'completed' || task.status === 'failed') {
    if (!task.acknowledgedAt) return true
    const twoHours = 2 * 60 * 60 * 1000
    return Date.now() - new Date(task.acknowledgedAt).getTime() < twoHours
  }
  return false
}

interface Props {
  projects: Project[]
  phases: Phase[]
  allTasks: Task[]
  activeProjectId: string | null
  activePhaseId: string | null
  activeTaskId: string | null
  onSelectProject: (id: string) => void
  onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void
  onAcknowledgeTask: (id: string) => void
}

export function DetachedMonitor({
  projects, phases, allTasks,
  activeProjectId, activePhaseId, activeTaskId,
  onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  const counts = {
    running: allTasks.filter(t => t.status === 'running').length,
    waiting: allTasks.filter(t => t.status === 'waiting').length,
    failed: allTasks.filter(t => t.status === 'failed' && !t.acknowledgedAt).length,
    completed: allTasks.filter(t => t.status === 'completed' && !t.acknowledgedAt).length,
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className="titlebar-drag" style={{ flex: 1 }}>
          <span className={styles.title}>📡 Monitor</span>
        </div>
        <div className={styles.badges}>
          {counts.running > 0 && <span className={styles.badge} data-status="running">{counts.running}</span>}
          {counts.waiting > 0 && <span className={styles.badge} data-status="waiting">{counts.waiting}</span>}
          {counts.failed > 0 && <span className={styles.badge} data-status="failed">{counts.failed}</span>}
          {counts.completed > 0 && <span className={styles.badge} data-status="completed">{counts.completed}</span>}
        </div>
      </div>

      <div className={styles.tree}>
        {projects.map(project => {
          const projectPhases = phases.filter(ph => ph.projectId === project.id)
          const projectKey = `proj-${project.id}`
          const isCollapsed = collapsed[projectKey]
          const visibleTasks = allTasks.filter(t => t.projectId === project.id).filter(isVisibleInMonitor)
          if (visibleTasks.length === 0) return null

          return (
            <div key={project.id}>
              <button
                className={`${styles.item} ${styles.projectItem} ${project.id === activeProjectId ? styles.active : ''}`}
                onClick={() => { onSelectProject(project.id); toggle(projectKey) }}
              >
                <span className={styles.chevron}>{isCollapsed ? '▸' : '▾'}</span>
                <span>{project.connection.type === 'ssh' ? '🖥' : '💻'}</span>
                <span className={styles.name}>{project.name}</span>
                <span className={styles.count}>{visibleTasks.length}</span>
              </button>

              {!isCollapsed && projectPhases.map(phase => {
                const phaseKey = `phase-${phase.id}`
                const phaseCollapsed = collapsed[phaseKey]
                const phaseTasks = allTasks.filter(t => t.phaseId === phase.id).filter(isVisibleInMonitor)
                if (phaseTasks.length === 0) return null

                return (
                  <div key={phase.id} className={styles.indent}>
                    <button
                      className={`${styles.item} ${phase.id === activePhaseId ? styles.active : ''}`}
                      onClick={() => { onSelectPhase(phase.id); toggle(phaseKey) }}
                    >
                      <span className={styles.chevron}>{phaseCollapsed ? '▸' : '▾'}</span>
                      <span className={styles.phaseIcon} data-status={phase.status}>
                        {phase.status === 'active' ? '▶' : phase.status === 'paused' ? '⏸' : '✓'}
                      </span>
                      <span className={styles.name}>{phase.name}</span>
                    </button>

                    {!phaseCollapsed && phaseTasks.map(task => (
                      <button
                        key={task.id}
                        className={`${styles.item} ${styles.taskItem} ${task.id === activeTaskId ? styles.active : ''}`}
                        onClick={() => onSelectTask(task.id)}
                      >
                        <StatusDot status={task.status} size={7} />
                        <span className={styles.name}>{task.name}</span>
                        {task.status === 'completed' && !task.acknowledgedAt && (
                          <button
                            className={styles.ackBtn}
                            onClick={e => { e.stopPropagation(); onAcknowledgeTask(task.id) }}
                          >✓</button>
                        )}
                        {task.status === 'failed' && !task.acknowledgedAt && (
                          <span className={styles.alertDot} />
                        )}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
