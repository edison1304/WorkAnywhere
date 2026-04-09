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
  onDetach?: () => void
}

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

// ─── Monitor View: cross-project tree ───
function MonitorTree({
  projects, phases, allTasks, activeProjectId, activePhaseId, activeTaskId,
  collapsed, toggle, onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask
}: Props & { collapsed: Record<string, boolean>; toggle: (key: string) => void }) {
  return (
    <>
      {projects.map(project => {
        const projectPhases = phases.filter(ph => ph.projectId === project.id)
        const projectKey = `mon-proj-${project.id}`
        const isProjectCollapsed = collapsed[projectKey]
        const projectTasks = allTasks.filter(t => t.projectId === project.id)
        const visibleTasks = projectTasks.filter(isVisibleInMonitor)
        if (visibleTasks.length === 0) return null

        return (
          <div key={project.id} className={styles.treeNode}>
            <button
              className={`${styles.treeItem} ${styles.projectLevel} ${project.id === activeProjectId ? styles.active : ''}`}
              onClick={() => { onSelectProject(project.id); toggle(projectKey) }}
            >
              <span className={styles.chevron}>{isProjectCollapsed ? '▸' : '▾'}</span>
              <span className={styles.nodeIcon}>
                {project.connection.type === 'ssh' ? '🖥' : '💻'}
              </span>
              <span className={styles.nodeName}>{project.name}</span>
              <span className={styles.activeBadge}>{visibleTasks.length}</span>
            </button>

            {!isProjectCollapsed && projectPhases.map(phase => {
              const phaseKey = `mon-phase-${phase.id}`
              const isPhaseCollapsed = collapsed[phaseKey]
              const phaseTasks = allTasks.filter(t => t.phaseId === phase.id).filter(isVisibleInMonitor)
              if (phaseTasks.length === 0) return null

              return (
                <div key={phase.id} className={styles.indent1}>
                  <button
                    className={`${styles.treeItem} ${styles.phaseLevel} ${phase.id === activePhaseId ? styles.active : ''}`}
                    onClick={() => { onSelectPhase(phase.id); toggle(phaseKey) }}
                  >
                    <span className={styles.chevron}>{isPhaseCollapsed ? '▸' : '▾'}</span>
                    <span className={styles.phaseStatus} data-status={phase.status}>
                      {phase.status === 'active' ? '▶' : phase.status === 'paused' ? '⏸' : '✓'}
                    </span>
                    <span className={styles.nodeName}>{phase.name}</span>
                    <span className={styles.taskCountBadge}>{phaseTasks.length}</span>
                  </button>

                  {!isPhaseCollapsed && phaseTasks.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      isActive={task.id === activeTaskId}
                      onSelect={() => onSelectTask(task.id)}
                      onAcknowledge={() => onAcknowledgeTask(task.id)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

// ─── Manage View: single project, flat phase sections ───
function ManageView({
  phases, allTasks, activeProjectId, activePhaseId, activeTaskId,
  collapsed, toggle, onSelectPhase, onSelectTask, onAcknowledgeTask
}: {
  phases: Phase[]
  allTasks: Task[]
  activeProjectId: string | null
  activePhaseId: string | null
  activeTaskId: string | null
  collapsed: Record<string, boolean>
  toggle: (key: string) => void
  onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void
  onAcknowledgeTask: (id: string) => void
}) {
  const projectPhases = phases.filter(ph => ph.projectId === activeProjectId)

  if (!activeProjectId) {
    return <div className={styles.emptyHint}>Select a project</div>
  }

  return (
    <>
      {projectPhases.map(phase => {
        const phaseKey = `mng-phase-${phase.id}`
        const isCollapsed = collapsed[phaseKey]
        const phaseTasks = allTasks.filter(t => t.phaseId === phase.id)

        return (
          <div key={phase.id} className={styles.managePhase}>
            <button
              className={`${styles.managePhaseHeader} ${phase.id === activePhaseId ? styles.active : ''}`}
              onClick={() => { onSelectPhase(phase.id); toggle(phaseKey) }}
            >
              <span className={styles.chevron}>{isCollapsed ? '▸' : '▾'}</span>
              <span className={styles.phaseStatus} data-status={phase.status}>
                {phase.status === 'active' ? '▶' : phase.status === 'paused' ? '⏸' : '✓'}
              </span>
              <span className={styles.nodeName}>{phase.name}</span>
              <span className={styles.taskCountBadge}>{phaseTasks.length}</span>
            </button>

            {!isCollapsed && (
              <div className={styles.manageTaskList}>
                {phaseTasks.map(task => (
                  <button
                    key={task.id}
                    className={`${styles.manageTaskItem} ${task.id === activeTaskId ? styles.active : ''}`}
                    onClick={() => onSelectTask(task.id)}
                  >
                    <StatusDot status={task.status} size={7} />
                    <span className={styles.taskName}>{task.name}</span>
                    <span className={styles.manageTaskStatus}>{task.status}</span>
                  </button>
                ))}
                <button className={styles.addTaskBtn}>+ New Task</button>
              </div>
            )}
          </div>
        )
      })}
      <button className={styles.addPhaseBtn}>+ New Phase</button>
    </>
  )
}

// ─── Shared Task Item (for monitor tree) ───
function TaskItem({ task, isActive, onSelect, onAcknowledge }: {
  task: Task; isActive: boolean; onSelect: () => void; onAcknowledge: () => void
}) {
  return (
    <button
      className={`${styles.treeItem} ${styles.taskLevel} ${isActive ? styles.active : ''}`}
      onClick={onSelect}
    >
      <StatusDot status={task.status} size={7} />
      <span className={styles.taskName}>{task.name}</span>
      {task.status === 'completed' && !task.acknowledgedAt && (
        <button
          className={styles.ackButton}
          onClick={(e) => { e.stopPropagation(); onAcknowledge() }}
          title="Mark as reviewed"
        >
          ✓
        </button>
      )}
      {task.status === 'failed' && !task.acknowledgedAt && (
        <span className={styles.unreadDot} />
      )}
    </button>
  )
}

// ─── Main Sidebar ───
export function TreeSidebar(props: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const { sidebarView, onSidebarViewChange } = props

  return (
    <div className={styles.sidebar}>
      {/* View toggle + detach */}
      <div className={styles.viewToggle}>
        <div className={styles.viewBtnGroup}>
          <button
            className={`${styles.viewTab} ${sidebarView === 'monitor' || sidebarView === 'both' ? styles.viewTabActive : ''}`}
            onClick={() => onSidebarViewChange(sidebarView === 'both' ? 'manage' : sidebarView === 'monitor' ? 'both' : 'monitor')}
          >
            📡 Monitor
          </button>
          <button
            className={`${styles.viewTab} ${sidebarView === 'manage' || sidebarView === 'both' ? styles.viewTabActive : ''}`}
            onClick={() => onSidebarViewChange(sidebarView === 'both' ? 'monitor' : sidebarView === 'manage' ? 'both' : 'manage')}
          >
            📋 Manage
          </button>
          {props.onDetach && (
            <button
              className={styles.detachBtn}
              onClick={props.onDetach}
              title="Pop out to second monitor"
            >
              ↗
            </button>
          )}
        </div>
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
            <MonitorTree {...props} collapsed={collapsed} toggle={toggle} />
          </div>
        </div>
      )}

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
            <ManageView
              phases={props.phases}
              allTasks={props.allTasks}
              activeProjectId={props.activeProjectId}
              activePhaseId={props.activePhaseId}
              activeTaskId={props.activeTaskId}
              collapsed={collapsed}
              toggle={toggle}
              onSelectPhase={props.onSelectPhase}
              onSelectTask={props.onSelectTask}
              onAcknowledgeTask={props.onAcknowledgeTask}
            />
          </div>
        </div>
      )}
    </div>
  )
}
