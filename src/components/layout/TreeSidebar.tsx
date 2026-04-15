import { useState, useCallback, useEffect } from 'react'
import type { Project, Phase, Task } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './TreeSidebar.module.css'

export type SidebarView = 'monitor' | 'manage' | 'both'
export type MonitorLayout = 'unified' | 'split'

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
  onDeleteTask?: (id: string) => void
  onForkTask?: (id: string) => void
  onMoveTask?: (taskId: string, targetPhaseId: string) => void
  onCreateProject?: (name: string, path: string) => void
  onCreatePhase?: (name: string, desc: string) => void
  onCreateTask?: (name: string, purpose: string, prompt: string) => void
  onDetach?: () => void
}

// ─── Context Menu ───
interface ContextMenuState {
  x: number; y: number; taskId: string
}

function TaskContextMenu({ menu, onDelete, onFork, onClose }: {
  menu: ContextMenuState
  onDelete: () => void; onFork: () => void; onClose: () => void
}) {
  useEffect(() => {
    const handler = () => onClose()
    window.addEventListener('click', handler)
    window.addEventListener('contextmenu', handler)
    return () => { window.removeEventListener('click', handler); window.removeEventListener('contextmenu', handler) }
  }, [onClose])

  return (
    <div className={styles.contextMenu} style={{ top: menu.y, left: menu.x }}>
      <button className={styles.contextMenuItem} onClick={onFork}>Fork (duplicate)</button>
      <button className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`} onClick={onDelete}>Delete</button>
    </div>
  )
}

const ACTIVE_STATUSES = new Set(['running', 'waiting', 'queued'])

function isVisibleInMonitor(task: Task): boolean {
  if (task.pinned) return true
  if (ACTIVE_STATUSES.has(task.status)) return true
  if (task.status === 'review') return true  // review는 항상 표시
  if (task.status === 'completed' || task.status === 'failed') {
    if (!task.acknowledgedAt) return true
    const twoHours = 2 * 60 * 60 * 1000
    return Date.now() - new Date(task.acknowledgedAt).getTime() < twoHours
  }
  return false
}

function isActiveTask(task: Task): boolean {
  return ACTIVE_STATUSES.has(task.status) || task.status === 'review'
}

function isDoneTask(task: Task): boolean {
  return task.status === 'completed' || task.status === 'failed'
}

// ─── Task Item with pin/ack/context menu/drag ───
function TaskItemMonitor({ task, isActive, onSelect, onAcknowledge, onPin, onContextMenu, onDragStart }: {
  task: Task; isActive: boolean
  onSelect: () => void; onAcknowledge: () => void; onPin: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDragStart?: (e: React.DragEvent) => void
}) {
  return (
    <div
      className={`${styles.treeItem} ${styles.taskLevel} ${isActive ? styles.active : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={e => { e.dataTransfer.setData('taskId', task.id); onDragStart?.(e) }}
      role="button"
      tabIndex={0}
    >
      <StatusDot status={task.status} size={7} />
      <span className={styles.taskName}>{task.name}</span>
      <span
        className={`${styles.pinBtn} ${task.pinned ? styles.pinned : ''}`}
        onClick={e => { e.stopPropagation(); onPin() }}
        title={task.pinned ? 'Unpin' : 'Pin to monitor'}
        role="button"
      >
        📌
      </span>
      {task.status === 'completed' && !task.acknowledgedAt && (
        <span
          className={styles.ackButton}
          onClick={e => { e.stopPropagation(); onAcknowledge() }}
          title="Mark as reviewed"
          role="button"
        >✓</span>
      )}
      {task.status === 'failed' && !task.acknowledgedAt && (
        <span className={styles.unreadDot} />
      )}
    </div>
  )
}

// ─── Monitor: unified view ───
function MonitorUnified({
  projects, phases, allTasks, activeProjectId, activePhaseId, activeTaskId,
  collapsed, toggle, onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask, onPinTask,
  onTaskContext
}: {
  projects: Project[]; phases: Phase[]; allTasks: Task[]
  activeProjectId: string | null; activePhaseId: string | null; activeTaskId: string | null
  collapsed: Record<string, boolean>; toggle: (k: string) => void
  onSelectProject: (id: string) => void; onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void; onAcknowledgeTask: (id: string) => void
  onPinTask: (id: string) => void
  onTaskContext?: (e: React.MouseEvent, taskId: string) => void
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
                      onContextMenu={e => onTaskContext?.(e, task.id)}
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
  allTasks, activeTaskId, onSelectTask, onAcknowledgeTask, onPinTask, onTaskContext
}: {
  allTasks: Task[]; activeTaskId: string | null
  onSelectTask: (id: string | null) => void
  onAcknowledgeTask: (id: string) => void; onPinTask: (id: string) => void
  onTaskContext?: (e: React.MouseEvent, taskId: string) => void
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
              onContextMenu={e => onTaskContext?.(e, task.id)}
            />
          ))}
        </div>
      )}
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
              onContextMenu={e => onTaskContext?.(e, task.id)}
            />
          ))}
        </div>
      )}
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
              onContextMenu={e => onTaskContext?.(e, task.id)}
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

// ─── Inline add forms ───
function InlineAddPhase({ onAdd }: { onAdd?: (name: string, desc: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open) return <button className={styles.addBtn} onClick={() => setOpen(true)}>+ New Phase</button>
  return (
    <form className={styles.inlineForm} onSubmit={e => { e.preventDefault(); if (name.trim()) { onAdd?.(name, ''); setName(''); setOpen(false) } }}>
      <input className={styles.inlineInput} value={name} onChange={e => setName(e.target.value)} placeholder="Phase name" autoFocus />
      <button type="submit" className={styles.inlineSubmit} disabled={!name.trim()}>Add</button>
      <button type="button" className={styles.inlineCancel} onClick={() => setOpen(false)}>x</button>
    </form>
  )
}

function InlineAddTask({ onAdd }: { onAdd?: (name: string, purpose: string, prompt: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [prompt, setPrompt] = useState('')
  if (!open) return <button className={styles.addBtn} onClick={() => setOpen(true)}>+ New Task</button>
  return (
    <form className={styles.inlineForm} onSubmit={e => { e.preventDefault(); if (name.trim() && prompt.trim()) { onAdd?.(name, purpose, prompt); setName(''); setPurpose(''); setPrompt(''); setOpen(false) } }}>
      <input className={styles.inlineInput} value={name} onChange={e => setName(e.target.value)} placeholder="Task name" autoFocus />
      <input className={styles.inlineInput} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Purpose" />
      <input className={styles.inlineInput} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Prompt" />
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="submit" className={styles.inlineSubmit} disabled={!name.trim() || !prompt.trim()}>Add</button>
        <button type="button" className={styles.inlineCancel} onClick={() => setOpen(false)}>x</button>
      </div>
    </form>
  )
}

function InlineAddProject({ onAdd }: { onAdd?: (name: string, path: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  if (!open) return <button className={styles.addBtn} onClick={() => setOpen(true)}>+ New Project</button>
  return (
    <form className={styles.inlineForm} onSubmit={e => { e.preventDefault(); if (name.trim() && path.trim()) { onAdd?.(name, path); setName(''); setPath(''); setOpen(false) } }}>
      <input className={styles.inlineInput} value={name} onChange={e => setName(e.target.value)} placeholder="Project name" autoFocus />
      <input className={styles.inlineInput} value={path} onChange={e => setPath(e.target.value)} placeholder="Workspace path" />
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="submit" className={styles.inlineSubmit} disabled={!name.trim() || !path.trim()}>Add</button>
        <button type="button" className={styles.inlineCancel} onClick={() => setOpen(false)}>x</button>
      </div>
    </form>
  )
}

// ─── Manage view ───
function ManageView({
  phases, allTasks, activeProjectId, activePhaseId, activeTaskId,
  collapsed, toggle, onSelectPhase, onSelectTask, onTaskContext, onPhaseDrop, dragOverPhase
}: {
  phases: Phase[]; allTasks: Task[]
  activeProjectId: string | null; activePhaseId: string | null; activeTaskId: string | null
  collapsed: Record<string, boolean>; toggle: (k: string) => void
  onSelectPhase: (id: string) => void; onSelectTask: (id: string | null) => void
  onTaskContext?: (e: React.MouseEvent, taskId: string) => void
  onPhaseDrop?: (e: React.DragEvent, phaseId: string) => void
  dragOverPhase?: string | null
  onCreatePhase?: (name: string, desc: string) => void
  onCreateTask?: (name: string, purpose: string, prompt: string) => void
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
          <div
            key={phase.id}
            className={`${styles.managePhase} ${dragOverPhase === phase.id ? styles.phaseDropTarget : ''}`}
            onDragOver={e => e.preventDefault()}
            onDragEnter={() => {}}
            onDrop={e => onPhaseDrop?.(e, phase.id)}
          >
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
                  <div
                    key={task.id}
                    className={`${styles.manageTaskItem} ${task.id === activeTaskId ? styles.active : ''}`}
                    onClick={() => onSelectTask(task.id)}
                    onContextMenu={e => onTaskContext?.(e, task.id)}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('taskId', task.id)}
                    role="button"
                  >
                    <StatusDot status={task.status} size={7} />
                    <span className={styles.taskName}>{task.name}</span>
                    <span className={styles.manageTaskStatus}>{task.status}</span>
                  </div>
                ))}
                <InlineAddTask onAdd={(name, purpose, prompt) => { onSelectPhase(phase.id); onCreateTask?.(name, purpose, prompt) }} />
              </div>
            )}
          </div>
        )
      })}
      <InlineAddPhase onAdd={onCreatePhase} />
    </>
  )
}

// ─── Main Sidebar ───
export function TreeSidebar(props: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [monitorLayout, setMonitorLayout] = useState<MonitorLayout>('unified')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [dragOverPhase, setDragOverPhase] = useState<string | null>(null)

  const toggle = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleTaskContext = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, taskId })
  }, [])

  const handlePhaseDrop = useCallback((e: React.DragEvent, phaseId: string) => {
    e.preventDefault()
    setDragOverPhase(null)
    const taskId = e.dataTransfer.getData('taskId')
    if (taskId) props.onMoveTask?.(taskId, phaseId)
  }, [props.onMoveTask])

  // Delete key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && props.activeTaskId) {
        const task = props.allTasks.find(t => t.id === props.activeTaskId)
        if (task && task.status !== 'running') {
          if (confirm(`Delete task "${task.name}"?`)) {
            props.onDeleteTask?.(props.activeTaskId)
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [props.activeTaskId, props.allTasks, props.onDeleteTask])

  const { sidebarView, onSidebarViewChange } = props

  return (
    <div className={styles.sidebar}>
      {/* Context menu */}
      {contextMenu && (
        <TaskContextMenu
          menu={contextMenu}
          onDelete={() => {
            props.onDeleteTask?.(contextMenu.taskId)
            setContextMenu(null)
          }}
          onFork={() => {
            props.onForkTask?.(contextMenu.taskId)
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
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
                onPinTask={props.onPinTask} onTaskContext={handleTaskContext}
              />
            ) : (
              <MonitorSplit
                allTasks={props.allTasks} activeTaskId={props.activeTaskId}
                onSelectTask={props.onSelectTask} onAcknowledgeTask={props.onAcknowledgeTask}
                onPinTask={props.onPinTask} onTaskContext={handleTaskContext}
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
              onTaskContext={handleTaskContext} onPhaseDrop={handlePhaseDrop} dragOverPhase={dragOverPhase}
              onCreatePhase={props.onCreatePhase} onCreateTask={props.onCreateTask}
            />
          </div>
        </div>
      )}

      {/* New Project button */}
      <div className={styles.sidebarFooter}>
        <InlineAddProject onAdd={props.onCreateProject} />
      </div>
    </div>
  )
}
