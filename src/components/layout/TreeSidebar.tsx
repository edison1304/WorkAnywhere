import { useState } from 'react'
import type { Project, Phase, Task } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './TreeSidebar.module.css'

export type SidebarView = 'monitor' | 'manage' | 'both'

interface Props {
  projects: Project[]
  phases: Phase[]
  allTasks: Task[]
  activeProjectId: string | null
  activePhaseId: string | null
  activeTaskId: string | null
  sidebarView: SidebarView
  onSidebarViewChange: (view: SidebarView) => void
  onSelectProject: (id: string) => void
  onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void
  onAcknowledgeTask: (id: string) => void
}

const ACTIVE_STATUSES = new Set(['running', 'waiting', 'queued'])

function isVisibleInMonitor(task: Task): boolean {
  // Running/waiting/queued always visible
  if (ACTIVE_STATUSES.has(task.status)) return true

  // Failed always visible until acknowledged + 2h
  // Completed visible until acknowledged + 2h
  if (task.status === 'completed' || task.status === 'failed') {
    if (!task.acknowledgedAt) return true
    const twoHours = 2 * 60 * 60 * 1000
    return Date.now() - new Date(task.acknowledgedAt).getTime() < twoHours
  }

  // idle tasks not shown in monitor
  return false
}

export function TreeSidebar({
  projects, phases, allTasks,
  activeProjectId, activePhaseId, activeTaskId,
  sidebarView, onSidebarViewChange,
  onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderTree = (filterFn?: (task: Task) => boolean) => {
    return projects.map(project => {
      const projectPhases = phases.filter(ph => ph.projectId === project.id)
      const projectKey = `proj-${project.id}`
      const isProjectCollapsed = collapsed[projectKey]

      // Count visible tasks for this project
      const projectTasks = allTasks.filter(t => t.projectId === project.id)
      const visibleProjectTasks = filterFn ? projectTasks.filter(filterFn) : projectTasks
      if (filterFn && visibleProjectTasks.length === 0) return null

      return (
        <div key={project.id} className={styles.treeNode}>
          {/* Project level */}
          <button
            className={`${styles.treeItem} ${styles.projectLevel} ${project.id === activeProjectId ? styles.active : ''}`}
            onClick={() => {
              onSelectProject(project.id)
              toggle(projectKey)
            }}
          >
            <span className={styles.chevron}>{isProjectCollapsed ? '▸' : '▾'}</span>
            <span className={styles.nodeIcon}>
              {project.connection.type === 'ssh' ? '🖥' : '💻'}
            </span>
            <span className={styles.nodeName}>{project.name}</span>
            {filterFn && visibleProjectTasks.length > 0 && (
              <span className={styles.activeBadge}>{visibleProjectTasks.length}</span>
            )}
          </button>

          {/* Phase level */}
          {!isProjectCollapsed && projectPhases.map(phase => {
            const phaseKey = `phase-${phase.id}`
            const isPhaseCollapsed = collapsed[phaseKey]
            const phaseTasks = allTasks.filter(t => t.phaseId === phase.id)
            const visiblePhaseTasks = filterFn ? phaseTasks.filter(filterFn) : phaseTasks
            if (filterFn && visiblePhaseTasks.length === 0) return null

            return (
              <div key={phase.id} className={styles.treeNode} style={{ paddingLeft: 16 }}>
                <button
                  className={`${styles.treeItem} ${styles.phaseLevel} ${phase.id === activePhaseId ? styles.active : ''}`}
                  onClick={() => {
                    onSelectPhase(phase.id)
                    toggle(phaseKey)
                  }}
                >
                  <span className={styles.chevron}>{isPhaseCollapsed ? '▸' : '▾'}</span>
                  <span className={styles.phaseStatus} data-status={phase.status}>
                    {phase.status === 'active' ? '▶' : phase.status === 'paused' ? '⏸' : '✓'}
                  </span>
                  <span className={styles.nodeName}>{phase.name}</span>
                  {visiblePhaseTasks.length > 0 && (
                    <span className={styles.taskCountBadge}>{visiblePhaseTasks.length}</span>
                  )}
                </button>

                {/* Task level */}
                {!isPhaseCollapsed && visiblePhaseTasks.map(task => (
                  <button
                    key={task.id}
                    className={`${styles.treeItem} ${styles.taskLevel} ${task.id === activeTaskId ? styles.active : ''}`}
                    style={{ paddingLeft: 16 }}
                    onClick={() => onSelectTask(task.id)}
                  >
                    <StatusDot status={task.status} size={7} />
                    <span className={styles.taskName}>{task.name}</span>
                    {task.status === 'completed' && !task.acknowledgedAt && (
                      <button
                        className={styles.ackButton}
                        onClick={(e) => { e.stopPropagation(); onAcknowledgeTask(task.id) }}
                        title="Mark as reviewed"
                      >
                        ✓
                      </button>
                    )}
                    {task.status === 'failed' && !task.acknowledgedAt && (
                      <span className={styles.unreadDot} />
                    )}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )
    })
  }

  return (
    <div className={styles.sidebar}>
      {/* View toggle */}
      <div className={styles.viewToggle}>
        <button
          className={`${styles.viewBtn} ${(sidebarView === 'monitor' || sidebarView === 'both') ? styles.viewBtnActive : ''}`}
          onClick={() => onSidebarViewChange(
            sidebarView === 'monitor' ? 'manage' : sidebarView === 'manage' ? 'both' : 'monitor'
          )}
          title="Cycle view: Monitor → Manage → Both"
        >
          {sidebarView === 'monitor' ? '📡 Monitor' :
           sidebarView === 'manage' ? '📋 Manage' :
           '📡📋 Both'}
        </button>
      </div>

      {/* Monitor view */}
      {(sidebarView === 'monitor' || sidebarView === 'both') && (
        <div className={styles.viewSection}>
          {sidebarView === 'both' && (
            <div className={styles.viewLabel}>
              <span>📡 Monitoring</span>
              <span className={styles.viewLabelHint}>active + unreviewed</span>
            </div>
          )}
          <div className={styles.treeContainer}>
            {renderTree(isVisibleInMonitor)}
          </div>
        </div>
      )}

      {/* Divider for both mode */}
      {sidebarView === 'both' && <div className={styles.viewDivider} />}

      {/* Manage view */}
      {(sidebarView === 'manage' || sidebarView === 'both') && (
        <div className={styles.viewSection}>
          {sidebarView === 'both' && (
            <div className={styles.viewLabel}>
              <span>📋 All Tasks</span>
            </div>
          )}
          <div className={styles.treeContainer}>
            {renderTree()}
          </div>
        </div>
      )}

      <button className={styles.addButton}>+ New Project</button>
    </div>
  )
}
