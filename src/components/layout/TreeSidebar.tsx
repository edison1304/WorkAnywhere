import { useState } from 'react'
import type { Project, Phase, Task } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './TreeSidebar.module.css'

export type SidebarView = 'monitor' | 'manage' | 'both'
export type MonitorLayout = 'unified' | 'split'  // unified: 전부 섞어서, split: 진행중/완료 분리

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
  onPinTask: (id: string) => void
  onDetach?: () => void
}

const ACTIVE_STATUSES = new Set(['running', 'waiting', 'queued'])

function isVisibleInMonitor(task: Task): boolean {
  // Pinned tasks always visible
  if (task.pinned) return true
  if (ACTIVE_STATUSES.has(task.status)) return true
  if (task.status === 'completed' || task.status === 'failed') {
    if (!task.acknowledgedAt) return true
    const twoHours = 2 * 60 * 60 * 1000
    return Date.now() - new Date(task.acknowledgedAt).getTime() < twoHours
  }
  return false
}

function isActiveTask(task: Task): boolean {
  return ACTIVE_STATUSES.has(task.status)
}

function isDoneTask(task: Task): boolean {
  return task.status === 'completed' || task.status === 'failed'
}

// ─── Task Item with pin/ack ───
function TaskItemMonitor({ task, isActive, onSelect, onAcknowledge, onPin }: {
  task: Task; isActive: boolean
  onSelect: () => void; onAcknowledge: () => void; onPin: () => void
}) {
  return (
    <button
      className={`${styles.treeItem} ${styles.taskLevel} ${isActive ? styles.active : ''}`}
      onClick={onSelect}
    >
      <StatusDot status={task.status} size={7} />
      <span className={styles.taskName}>{task.name}</span>
      {/* Pin button */}
      <button
        className={`${styles.pinBtn} ${task.pinned ? styles.pinned : ''}`}
        onClick={e => { e.stopPropagation(); onPin() }}
        title={task.pinned ? 'Unpin' : 'Pin to monitor'}
      >
        📌
      </button>
      {/* Ack button for completed */}
      {task.status === 'completed' && !task.acknowledgedAt && (
        <button
          className={styles.ackButton}
          onClick={e => { e.stopPropagation(); onAcknowledge() }}
          title="Mark as reviewed"
        >✓</button>
      )}
      {task.status === 'failed' && !task.acknowledgedAt && (
        <span className={styles.unreadDot} />
      )}
    </button>
  )
}

// ─── Monitor: unified view ───
function MonitorUnified({
  projects, phases, allTasks, activeProjectId, activePhaseId, activeTaskId,
  collapsed, toggle, onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask, onPinTask
}: {
  projects: Project[]; phases: Phase[]; allTasks: Task[]
  activeProjectId: string | null; activePhaseId: string | null; activeTaskId: string | null
  collapsed: Record<string, boolean>; toggle: (k: string) => void
  onSelectProject: (id: string) => void; onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void; onAcknowledgeTask: (id: string) => void
  onPinTask: (id: string) => void
}) {
  return (
    <>
      {projects.map(project => {
        const projectPhases = phases.filter(ph => ph.projectId === project.id)
        const projectKey = `mon-proj-${project.id}`
        const isCollapsed = collapsed[projectKey]
        const visibleTasks = allTasks.filter(t => t.projectId === project.id).filter(isVisibleInMonitor)
        if (visibleTasks.length === 0) return null

        return (
          <div key={project.id} className={styles.treeNode}>
            <button
              className={`${styles.treeItem} ${styles.projectLevel} ${project.id === activeProjectId ? styles.active : ''}`}
              onClick={() => { onSelectProject(project.id); toggle(projectKey) }}
            >
              <span className={styles.chevron}>{isCollapsed ? '▸' : '▾'}</span>
              <span className={styles.nodeIcon}>{project.connection.type === 'ssh' ? '🖥' : '💻'}</span>
              <span className={styles.nodeName}>{project.name}</span>
              <span className={styles.activeBadge}>{visibleTasks.length}</span>
            </button>

            {!isCollapsed && projectPhases.map(phase => {
              const phaseKey = `mon-phase-${phase.id}`
              const phaseCollapsed = collapsed[phaseKey]
              const phaseTasks = allTasks.filter(t => t.phaseId === phase.id).filter(isVisibleInMonitor)
              if (phaseTasks.length === 0) return null

              return (
                <div key={phase.id} className={styles.indent1}>
                  <button
                    className={`${styles.treeItem} ${styles.phaseLevel} ${phase.id === activePhaseId ? styles.active : ''}`}
                    onClick={() => { onSelectPhase(phase.id); toggle(phaseKey) }}
                  >
                    <span className={styles.chevron}>{phaseCollapsed ? '▸' : '▾'}</span>
                    <span className={styles.phaseStatus} data-status={phase.status}>
                      {phase.status === 'active' ? '▶' : phase.status === 'paused' ? '⏸' : '✓'}
                    </span>
                    <span className={styles.nodeName}>{phase.name}</span>
                    <span className={styles.taskCountBadge}>{phaseTasks.length}</span>
                  </button>

                  {!phaseCollapsed && phaseTasks.map(task => (
                    <TaskItemMonitor
                      key={task.id} task={task} isActive={task.id === activeTaskId}
                      onSelect={() => onSelectTask(task.id)}
                      onAcknowledge={() => onAcknowledgeTask(task.id)}
                      onPin={() => onPinTask(task.id)}
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

// ─── Monitor: split view (active / done) ───
function MonitorSplit({
  allTasks, activeTaskId, onSelectTask, onAcknowledgeTask, onPinTask
}: {
  allTasks: Task[]; activeTaskId: string | null
  onSelectTask: (id: string | null) => void
  onAcknowledgeTask: (id: string) => void; onPinTask: (id: string) => void
}) {
  const visible = allTasks.filter(isVisibleInMonitor)
  const active = visible.filter(isActiveTask)
  const done = visible.filter(isDoneTask)
  const pinned = visible.filter(t => t.pinned && !isActiveTask(t) && !isDoneTask(t))

  return (
    <>
      {/* Active section */}
      {active.length > 0 && (
        <div className={styles.splitSection}>
          <div className={styles.splitHeader} data-type="active">
            <span>⚡ In Progress</span>
            <span className={styles.splitCount}>{active.length}</span>
          </div>
          {active.map(task => (
            <TaskItemMonitor
              key={task.id} task={task} isActive={task.id === activeTaskId}
              onSelect={() => onSelectTask(task.id)}
              onAcknowledge={() => onAcknowledgeTask(task.id)}
              onPin={() => onPinTask(task.id)}
            />
          ))}
        </div>
      )}

      {/* Done section */}
      {done.length > 0 && (
        <div className={styles.splitSection}>
          <div className={styles.splitHeader} data-type="done">
            <span>✓ Completed / Failed</span>
            <span className={styles.splitCount}>{done.length}</span>
          </div>
          {done.map(task => (
            <TaskItemMonitor
              key={task.id} task={task} isActive={task.id === activeTaskId}
              onSelect={() => onSelectTask(task.id)}
              onAcknowledge={() => onAcknowledgeTask(task.id)}
              onPin={() => onPinTask(task.id)}
            />
          ))}
        </div>
      )}

      {/* Pinned (idle but pinned) */}
      {pinned.length > 0 && (
        <div className={styles.splitSection}>
          <div className={styles.splitHeader} data-type="pinned">
            <span>📌 Pinned</span>
            <span className={styles.splitCount}>{pinned.length}</span>
          </div>
          {pinned.map(task => (
            <TaskItemMonitor
              key={task.id} task={task} isActive={task.id === activeTaskId}
              onSelect={() => onSelectTask(task.id)}
              onAcknowledge={() => onAcknowledgeTask(task.id)}
              onPin={() => onPinTask(task.id)}
            />
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <div className={styles.emptyHint}>No active tasks</div>
      )}
    </>
  )
}

// ─── Manage view ───
function ManageView({
  phases, allTasks, activeProjectId, activePhaseId, activeTaskId,
  collapsed, toggle, onSelectPhase, onSelectTask
}: {
  phases: Phase[]; allTasks: Task[]
  activeProjectId: string | null; activePhaseId: string | null; activeTaskId: string | null
  collapsed: Record<string, boolean>; toggle: (k: string) => void
  onSelectPhase: (id: string) => void; onSelectTask: (id: string | null) => void
}) {
  const projectPhases = phases.filter(ph => ph.projectId === activeProjectId)
  if (!activeProjectId) return <div className={styles.emptyHint}>Select a project</div>

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

// ─── Main Sidebar ───
export function TreeSidebar(props: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [monitorLayout, setMonitorLayout] = useState<MonitorLayout>('unified')

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
            <button className={styles.detachBtn} onClick={props.onDetach} title="Pop out to second monitor">↗</button>
          )}
        </div>
      </div>

      {/* Monitor view */}
      {(sidebarView === 'monitor' || sidebarView === 'both') && (
        <div className={styles.viewSection}>
          <div className={styles.viewLabel}>
            <span>📡 {sidebarView === 'both' ? 'Monitoring' : 'Monitor'}</span>
            {/* Layout toggle */}
            <button
              className={styles.layoutToggle}
              onClick={() => setMonitorLayout(prev => prev === 'unified' ? 'split' : 'unified')}
              title={monitorLayout === 'unified' ? 'Switch to split view' : 'Switch to tree view'}
            >
              {monitorLayout === 'unified' ? '⊟' : '⊞'}
            </button>
          </div>
          <div className={styles.treeContainer}>
            {monitorLayout === 'unified' ? (
              <MonitorUnified
                projects={props.projects} phases={props.phases} allTasks={props.allTasks}
                activeProjectId={props.activeProjectId} activePhaseId={props.activePhaseId}
                activeTaskId={props.activeTaskId}
                collapsed={collapsed} toggle={toggle}
                onSelectProject={props.onSelectProject} onSelectPhase={props.onSelectPhase}
                onSelectTask={props.onSelectTask} onAcknowledgeTask={props.onAcknowledgeTask}
                onPinTask={props.onPinTask}
              />
            ) : (
              <MonitorSplit
                allTasks={props.allTasks} activeTaskId={props.activeTaskId}
                onSelectTask={props.onSelectTask} onAcknowledgeTask={props.onAcknowledgeTask}
                onPinTask={props.onPinTask}
              />
            )}
          </div>
        </div>
      )}

      {sidebarView === 'both' && <div className={styles.viewDivider} />}

      {/* Manage view */}
      {(sidebarView === 'manage' || sidebarView === 'both') && (
        <div className={styles.viewSection}>
          {sidebarView === 'both' && (
            <div className={styles.viewLabel}><span>📋 All Tasks</span></div>
          )}
          <div className={styles.treeContainer}>
            <ManageView
              phases={props.phases} allTasks={props.allTasks}
              activeProjectId={props.activeProjectId} activePhaseId={props.activePhaseId}
              activeTaskId={props.activeTaskId}
              collapsed={collapsed} toggle={toggle}
              onSelectPhase={props.onSelectPhase} onSelectTask={props.onSelectTask}
            />
          </div>
        </div>
      )}
    </div>
  )
}
