import { useState, useCallback, useEffect, Component, type ReactNode } from 'react'
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
  onReorderTasks?: (phaseId: string, orderedIds: string[]) => void
  onReorderPhases?: (projectId: string, orderedIds: string[]) => void
  onRequestCreateProject?: () => void
  onCreatePhase?: (name: string, desc: string) => void
  onCreateTask?: (name: string, purpose: string, prompt: string) => void
  onOpenFile?: (filePath: string) => void
  workspacePath?: string
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
      onDragStart={e => { e.dataTransfer.setData('task-id', task.id); onDragStart?.(e) }}
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
        ●
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
        const projectPhases = phases.filter(ph => ph.projectId === project.id).sort((a, b) => a.order - b.order)
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
              <span className={styles.nodeIcon}>{project.connection.type === 'ssh' ? 'S' : project.connection.type === 'remote' ? 'R' : 'L'}</span>
              <span className={styles.nodeName}>{project.name}</span>
              <span className={styles.activeBadge}>{visibleTasks.length}</span>
            </button>

            {!isCollapsed && projectPhases.map(phase => {
              const phaseKey = `mon-phase-${phase.id}`
              const phaseCollapsed = collapsed[phaseKey]
              const phaseTasks = allTasks.filter(t => t.phaseId === phase.id).filter(isVisibleInMonitor).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
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
            <span>In Progress</span>
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
            <span>Completed / Failed</span>
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
            <span>Pinned</span>
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

// ─── Seti UI file icon colors (from VS Code default theme) ───
const SETI: Record<string, { icon: string; color: string }> = {
  // Blue #519aba — Python, TS, C, Go, CSS, Markdown, Dart, Dockerfile
  py: { icon: 'Py', color: '#519aba' }, ts: { icon: 'TS', color: '#519aba' }, tsx: { icon: 'TS', color: '#519aba' },
  c: { icon: 'C', color: '#519aba' }, go: { icon: 'Go', color: '#519aba' }, css: { icon: '#', color: '#519aba' },
  less: { icon: '#', color: '#519aba' }, md: { icon: 'M', color: '#519aba' }, mdx: { icon: 'M', color: '#519aba' },
  dart: { icon: 'D', color: '#519aba' }, cs: { icon: 'C#', color: '#519aba' }, elm: { icon: 'E', color: '#519aba' },
  lua: { icon: 'Lu', color: '#519aba' }, pl: { icon: 'Pl', color: '#519aba' }, r: { icon: 'R', color: '#519aba' },
  dockerfile: { icon: 'D', color: '#519aba' }, cpp: { icon: 'C+', color: '#519aba' },
  // Yellow #cbcb41 — JavaScript, JSON
  js: { icon: 'JS', color: '#cbcb41' }, jsx: { icon: 'JS', color: '#cbcb41' }, mjs: { icon: 'JS', color: '#cbcb41' },
  json: { icon: '{ }', color: '#cbcb41' }, jsonc: { icon: '{ }', color: '#cbcb41' },
  // Green #8dc149 — Shell, Vue, CSV
  sh: { icon: '$', color: '#8dc149' }, bash: { icon: '$', color: '#8dc149' }, zsh: { icon: '$', color: '#8dc149' },
  vue: { icon: 'V', color: '#8dc149' }, csv: { icon: ',', color: '#8dc149' }, lock: { icon: 'L', color: '#8dc149' },
  // Red #cc3e44 — Ruby, Java, Svelte, PDF
  java: { icon: 'Ja', color: '#cc3e44' }, rb: { icon: 'Rb', color: '#cc3e44' }, svelte: { icon: 'S', color: '#cc3e44' },
  pdf: { icon: 'Pdf', color: '#cc3e44' }, scala: { icon: 'Sc', color: '#cc3e44' },
  // Purple #a074c4 — PHP, Haskell, images, headers, YAML
  php: { icon: 'Php', color: '#a074c4' }, h: { icon: 'H', color: '#a074c4' }, hpp: { icon: 'H+', color: '#a074c4' },
  hs: { icon: 'Hs', color: '#a074c4' }, ex: { icon: 'Ex', color: '#a074c4' }, yml: { icon: 'Y', color: '#a074c4' },
  yaml: { icon: 'Y', color: '#a074c4' }, tf: { icon: 'Tf', color: '#a074c4' },
  png: { icon: 'Img', color: '#a074c4' }, jpg: { icon: 'Img', color: '#a074c4' }, jpeg: { icon: 'Img', color: '#a074c4' },
  gif: { icon: 'Img', color: '#a074c4' }, webp: { icon: 'Img', color: '#a074c4' }, svg: { icon: 'Svg', color: '#a074c4' },
  ico: { icon: 'Ico', color: '#a074c4' },
  // Orange #e37933 — HTML, Swift, Kotlin, XML, Makefile
  html: { icon: '<>', color: '#e37933' }, htm: { icon: '<>', color: '#e37933' }, xml: { icon: '<>', color: '#e37933' },
  swift: { icon: 'Sw', color: '#e37933' }, kt: { icon: 'Kt', color: '#e37933' }, zig: { icon: 'Z', color: '#e37933' },
  // Pink #f55385 — Sass, SQL, GraphQL, Docker Compose
  scss: { icon: 'S', color: '#f55385' }, sass: { icon: 'S', color: '#f55385' }, sql: { icon: 'Sq', color: '#f55385' },
  graphql: { icon: 'Gq', color: '#f55385' }, gql: { icon: 'Gq', color: '#f55385' },
  // Grey #6d8086 — Rust, TOML, config, env, zip
  rs: { icon: 'Rs', color: '#6d8086' }, toml: { icon: 'T', color: '#6d8086' }, cfg: { icon: 'Cf', color: '#6d8086' },
  conf: { icon: 'Cf', color: '#6d8086' }, ini: { icon: 'Cf', color: '#6d8086' }, env: { icon: 'E', color: '#6d8086' },
  log: { icon: 'Lo', color: '#6d8086' }, zip: { icon: 'Zp', color: '#6d8086' }, gz: { icon: 'Zp', color: '#6d8086' },
  tar: { icon: 'Zp', color: '#6d8086' },
  // Ignore #41535b
  gitignore: { icon: 'G', color: '#41535b' }, gitattributes: { icon: 'G', color: '#41535b' },
  // Default
  txt: { icon: 'Tx', color: '#d4d7d6' }, rst: { icon: 'Rs', color: '#d4d7d6' },
}

function getFileInfo(name: string): { icon: string; color: string } {
  const lower = name.toLowerCase()
  // Special filenames
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return SETI.dockerfile
  if (lower === 'makefile') return { icon: 'Mk', color: '#e37933' }
  if (lower === '.gitignore') return SETI.gitignore
  if (lower === '.env' || lower.startsWith('.env.')) return SETI.env
  // Extension-based
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return SETI[ext] || { icon: '·', color: '#d4d7d6' }
}

// ─── File Context Menu ───
interface FileContextMenuState {
  x: number; y: number; path: string; name: string; isDir: boolean
}

function FileContextMenu({ menu, onClose, onAction }: {
  menu: FileContextMenuState
  onClose: () => void
  onAction: (action: string, path: string, name: string, isDir: boolean) => void
}) {
  useEffect(() => {
    const handler = () => onClose()
    window.addEventListener('click', handler)
    window.addEventListener('contextmenu', handler)
    return () => { window.removeEventListener('click', handler); window.removeEventListener('contextmenu', handler) }
  }, [onClose])

  return (
    <div className={styles.contextMenu} style={{ top: menu.y, left: menu.x }}>
      {!menu.isDir && (
        <button className={styles.contextMenuItem} onClick={() => onAction('open', menu.path, menu.name, menu.isDir)}>
          Open
        </button>
      )}
      <button className={styles.contextMenuItem} onClick={() => onAction('copyPath', menu.path, menu.name, menu.isDir)}>
        Copy Path
      </button>
      <button className={styles.contextMenuItem} onClick={() => onAction('copyName', menu.path, menu.name, menu.isDir)}>
        Copy Name
      </button>
      {!menu.isDir && (
        <button className={styles.contextMenuItem} onClick={() => onAction('download', menu.path, menu.name, menu.isDir)}>
          Download
        </button>
      )}
      <div className={styles.contextMenuDivider} />
      <button className={styles.contextMenuItem} onClick={() => onAction('rename', menu.path, menu.name, menu.isDir)}>
        Rename
      </button>
      <button className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`} onClick={() => onAction('delete', menu.path, menu.name, menu.isDir)}>
        Delete
      </button>
    </div>
  )
}

// ─── File Tree (workspace browser) ───
function FileTree({ rootPath, onOpenFile }: { rootPath: string; onOpenFile?: (path: string) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [rootPath]: true })
  const [entries, setEntries] = useState<Record<string, Array<{ name: string; isDir: boolean; path: string }>>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [fileMenu, setFileMenu] = useState<FileContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const loadDir = useCallback(async (dirPath: string) => {
    if (entries[dirPath] || loading[dirPath]) return
    if (!window.api) return
    setLoading(prev => ({ ...prev, [dirPath]: true }))
    const result = await window.api.sshListDir(dirPath)
    setLoading(prev => ({ ...prev, [dirPath]: false }))
    if (result.success && result.entries) {
      setEntries(prev => ({
        ...prev,
        [dirPath]: result.entries!.filter(e => !e.name.startsWith('.')),
      }))
    }
  }, [entries, loading])

  const reloadDir = useCallback(async (dirPath: string) => {
    if (!window.api) return
    setLoading(prev => ({ ...prev, [dirPath]: true }))
    const result = await window.api.sshListDir(dirPath)
    setLoading(prev => ({ ...prev, [dirPath]: false }))
    if (result.success && result.entries) {
      setEntries(prev => ({
        ...prev,
        [dirPath]: result.entries!.filter(e => !e.name.startsWith('.')),
      }))
    }
  }, [])

  useEffect(() => { loadDir(rootPath) }, [rootPath])

  const toggleDir = useCallback((dirPath: string) => {
    setExpanded(prev => {
      const next = { ...prev, [dirPath]: !prev[dirPath] }
      if (next[dirPath]) loadDir(dirPath)
      return next
    })
  }, [loadDir])

  const getParentDir = (filePath: string) => filePath.substring(0, filePath.lastIndexOf('/'))

  const handleContextAction = useCallback(async (action: string, path: string, name: string, isDir: boolean) => {
    setFileMenu(null)
    if (!window.api) return

    if (action === 'open') {
      onOpenFile?.(path)
    } else if (action === 'copyPath') {
      navigator.clipboard.writeText(path)
    } else if (action === 'copyName') {
      navigator.clipboard.writeText(name)
    } else if (action === 'download') {
      const result = await window.api.sshReadFile(path)
      if (result.success && result.content !== undefined) {
        const blob = result.encoding === 'base64'
          ? new Blob([Uint8Array.from(atob(result.content), c => c.charCodeAt(0))])
          : new Blob([result.content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = name; a.click()
        URL.revokeObjectURL(url)
      }
    } else if (action === 'rename') {
      setRenaming({ path, name })
      setRenameValue(name)
    } else if (action === 'delete') {
      const msg = isDir ? `Delete folder "${name}" and all contents?` : `Delete "${name}"?`
      if (confirm(msg)) {
        const cmd = isDir ? `rm -rf ${JSON.stringify(path)}` : `rm -f ${JSON.stringify(path)}`
        await window.api.sshExec(cmd)
        reloadDir(getParentDir(path))
      }
    }
  }, [onOpenFile, reloadDir])

  const handleRenameSubmit = useCallback(async () => {
    if (!renaming || !renameValue.trim() || !window.api) { setRenaming(null); return }
    const parentDir = getParentDir(renaming.path)
    const newPath = `${parentDir}/${renameValue.trim()}`
    if (newPath !== renaming.path) {
      await window.api.sshExec(`mv ${JSON.stringify(renaming.path)} ${JSON.stringify(newPath)}`)
      reloadDir(parentDir)
    }
    setRenaming(null)
  }, [renaming, renameValue, reloadDir])

  const renderEntries = (dirPath: string, depth: number) => {
    const items = entries[dirPath]
    if (!items) return loading[dirPath] ? <div className={styles.fileTreeLoading}>...</div> : null
    return items.map(entry => {
      const fi = entry.isDir ? null : getFileInfo(entry.name)
      return (
      <div key={entry.path}>
        <div
          className={`${styles.fileTreeItem} ${entry.isDir ? styles.fileTreeDir : styles.fileTreeFile}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => {
            if (entry.isDir) toggleDir(entry.path)
            else onOpenFile?.(entry.path)
          }}
          onContextMenu={e => {
            e.preventDefault(); e.stopPropagation()
            setFileMenu({ x: e.clientX, y: e.clientY, path: entry.path, name: entry.name, isDir: entry.isDir })
          }}
        >
          {entry.isDir ? (
            <span className={styles.fileTreeIcon} style={{ color: '#c09553' }}>
              {expanded[entry.path] ? '▾' : '▸'}
            </span>
          ) : (
            <span className={styles.fileTreeIcon} style={{ color: fi?.color || '#d4d7d6' }}>
              {fi?.icon || '·'}
            </span>
          )}
          {renaming && renaming.path === entry.path ? (
            <input
              className={styles.fileTreeRenameInput}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(null) }}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className={styles.fileTreeName}>{entry.name}</span>
          )}
        </div>
        {entry.isDir && expanded[entry.path] && renderEntries(entry.path, depth + 1)}
      </div>
      )})
  }

  return (
    <div className={styles.fileTreeRoot}>
      {renderEntries(rootPath, 0)}
      {fileMenu && (
        <FileContextMenu
          menu={fileMenu}
          onClose={() => setFileMenu(null)}
          onAction={handleContextAction}
        />
      )}
    </div>
  )
}

// ─── Drag reorder helpers ───
function useReorderDrag<T extends { id: string }>(
  items: T[],
  onReorder: (orderedIds: string[]) => void,
  dragType: string,
) {
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverHalf, setDragOverHalf] = useState<'top' | 'bottom'>('bottom')
  const [dragId, setDragId] = useState<string | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(dragType, id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }, [dragType])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    if (!e.dataTransfer.types.includes(dragType)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const half = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
    setDragOverId(id)
    setDragOverHalf(half)
  }, [dragType])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData(dragType)
    if (!sourceId || !dragOverId || sourceId === dragOverId) {
      setDragOverId(null); setDragId(null); return
    }
    const ids = items.map(i => i.id)
    const fromIdx = ids.indexOf(sourceId)
    const toIdx = ids.indexOf(dragOverId)
    if (fromIdx === -1 || toIdx === -1) { setDragOverId(null); setDragId(null); return }
    ids.splice(fromIdx, 1)
    const insertIdx = dragOverHalf === 'top' ? ids.indexOf(dragOverId) : ids.indexOf(dragOverId) + 1
    ids.splice(insertIdx, 0, sourceId)
    onReorder(ids)
    setDragOverId(null)
    setDragId(null)
  }, [items, dragOverId, dragOverHalf, dragType, onReorder])

  const handleDragEnd = useCallback(() => {
    setDragOverId(null)
    setDragId(null)
  }, [])

  return { dragId, dragOverId, dragOverHalf, handleDragStart, handleDragOver, handleDrop, handleDragEnd }
}

// ─── Manage view ───
function ManageView({
  phases, allTasks, activeProjectId, activePhaseId, activeTaskId,
  collapsed, toggle, onSelectPhase, onSelectTask, onTaskContext, onPhaseDrop, dragOverPhase,
  onCreatePhase, onCreateTask, onReorderTasks, onReorderPhases
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
  onReorderTasks?: (phaseId: string, orderedIds: string[]) => void
  onReorderPhases?: (projectId: string, orderedIds: string[]) => void
}) {
  const projectPhases = phases.filter(ph => ph.projectId === activeProjectId).sort((a, b) => a.order - b.order)
  if (!activeProjectId) return <div className={styles.emptyHint}>Select a project</div>

  const phaseDrag = useReorderDrag(
    projectPhases,
    (orderedIds) => onReorderPhases?.(activeProjectId!, orderedIds),
    'phase-id'
  )

  return (
    <>
      {/* Top drop zone — allows dragging a phase to the very first position */}
      {phaseDrag.dragId && (
        <div
          className={styles.phaseTopDropZone}
          onDragOver={e => {
            if (e.dataTransfer.types.includes('phase-id')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={e => {
            e.preventDefault()
            const sourceId = e.dataTransfer.getData('phase-id')
            if (sourceId && projectPhases.length > 0 && sourceId !== projectPhases[0].id) {
              const ids = projectPhases.map(p => p.id)
              const fromIdx = ids.indexOf(sourceId)
              if (fromIdx > 0) {
                ids.splice(fromIdx, 1)
                ids.unshift(sourceId)
                onReorderPhases?.(activeProjectId!, ids)
              }
            }
          }}
        >
          Drop here to move to top
        </div>
      )}
      {projectPhases.map(phase => {
        const phaseKey = `mng-phase-${phase.id}`
        const isCollapsed = collapsed[phaseKey]
        const phaseTasks = allTasks.filter(t => t.phaseId === phase.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        const isPhaseDropIndicator = phaseDrag.dragOverId === phase.id && phaseDrag.dragId !== phase.id

        return (
          <div
            key={phase.id}
            className={`${styles.managePhase} ${dragOverPhase === phase.id ? styles.phaseDropTarget : ''}`}
            onDrop={e => {
              // Check if it's a task cross-phase drop
              if (e.dataTransfer.types.includes('task-id') && !e.dataTransfer.types.includes('phase-id')) {
                onPhaseDrop?.(e, phase.id)
              }
            }}
            onDragOver={e => {
              if (e.dataTransfer.types.includes('task-id')) e.preventDefault()
            }}
          >
            {isPhaseDropIndicator && phaseDrag.dragOverHalf === 'top' && (
              <div className={styles.dropIndicator} />
            )}
            <div
              className={`${styles.managePhaseHeader} ${phase.id === activePhaseId ? styles.active : ''} ${phaseDrag.dragId === phase.id ? styles.dragging : ''}`}
              onClick={() => { onSelectPhase(phase.id); toggle(phaseKey) }}
              draggable
              onDragStart={e => phaseDrag.handleDragStart(e, phase.id)}
              onDragOver={e => phaseDrag.handleDragOver(e, phase.id)}
              onDrop={phaseDrag.handleDrop}
              onDragEnd={phaseDrag.handleDragEnd}
            >
              <span className={styles.dragHandle}>⠿</span>
              <span className={styles.chevron}>{isCollapsed ? '▸' : '▾'}</span>
              <span className={styles.phaseStatus} data-status={phase.status}>
                {phase.status === 'active' ? '▶' : phase.status === 'paused' ? '⏸' : '✓'}
              </span>
              <span className={styles.nodeName}>{phase.name}</span>
              <span className={styles.taskCountBadge}>{phaseTasks.length}</span>
            </div>
            {isPhaseDropIndicator && phaseDrag.dragOverHalf === 'bottom' && (
              <div className={styles.dropIndicator} />
            )}
            {!isCollapsed && (
              <ManageTaskList
                tasks={phaseTasks}
                phaseId={phase.id}
                activeTaskId={activeTaskId}
                onSelectPhase={onSelectPhase}
                onSelectTask={onSelectTask}
                onTaskContext={onTaskContext}
                onCreateTask={onCreateTask}
                onReorderTasks={onReorderTasks}
                onPhaseDrop={onPhaseDrop}
              />
            )}
          </div>
        )
      })}
      <InlineAddPhase onAdd={onCreatePhase} />
    </>
  )
}

// ─── Task list within a phase (with drag reorder) ───
function ManageTaskList({
  tasks, phaseId, activeTaskId, onSelectPhase, onSelectTask, onTaskContext, onCreateTask, onReorderTasks, onPhaseDrop
}: {
  tasks: Task[]; phaseId: string; activeTaskId: string | null
  onSelectPhase: (id: string) => void; onSelectTask: (id: string | null) => void
  onTaskContext?: (e: React.MouseEvent, taskId: string) => void
  onCreateTask?: (name: string, purpose: string, prompt: string) => void
  onReorderTasks?: (phaseId: string, orderedIds: string[]) => void
  onPhaseDrop?: (e: React.DragEvent, phaseId: string) => void
}) {
  const taskDrag = useReorderDrag(
    tasks,
    (orderedIds) => onReorderTasks?.(phaseId, orderedIds),
    'task-id'
  )

  return (
    <div className={styles.manageTaskList}>
      {tasks.map(task => {
        const isDropIndicator = taskDrag.dragOverId === task.id && taskDrag.dragId !== task.id
        return (
          <div key={task.id}>
            {isDropIndicator && taskDrag.dragOverHalf === 'top' && (
              <div className={styles.dropIndicator} />
            )}
            <div
              className={`${styles.manageTaskItem} ${task.id === activeTaskId ? styles.active : ''} ${taskDrag.dragId === task.id ? styles.dragging : ''}`}
              onClick={() => onSelectTask(task.id)}
              onContextMenu={e => onTaskContext?.(e, task.id)}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('task-id', task.id)
                e.dataTransfer.effectAllowed = 'move'
                taskDrag.handleDragStart(e, task.id)
              }}
              onDragOver={e => taskDrag.handleDragOver(e, task.id)}
              onDrop={e => {
                // Only handle same-phase reorder, not cross-phase
                if (e.dataTransfer.types.includes('task-id') && !e.dataTransfer.types.includes('phase-id')) {
                  taskDrag.handleDrop(e)
                }
              }}
              onDragEnd={taskDrag.handleDragEnd}
              role="button"
            >
              <span className={styles.dragHandle}>⠿</span>
              <StatusDot status={task.status} size={7} />
              <span className={styles.taskName}>{task.name}</span>
              <span className={styles.manageTaskStatus}>{task.status}</span>
            </div>
            {isDropIndicator && taskDrag.dragOverHalf === 'bottom' && (
              <div className={styles.dropIndicator} />
            )}
          </div>
        )
      })}
      <InlineAddTask onAdd={(name, purpose, prompt) => { onSelectPhase(phaseId); onCreateTask?.(name, purpose, prompt) }} />
    </div>
  )
}

// ─── Error Boundary for catching render crashes ───
class ViewErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  componentDidCatch(error: Error) { console.error(`[${this.props.name} crash]`, error) }
  render() {
    if (this.state.error) return <div style={{ padding: 12, color: '#ef4444', fontSize: 12 }}>{this.props.name} error: {this.state.error}</div>
    return this.props.children
  }
}

function ManageViewSafe(props: Parameters<typeof ManageView>[0]) {
  return <ViewErrorBoundary name="ManageView"><ManageView {...props} /></ViewErrorBoundary>
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
    const taskId = e.dataTransfer.getData('task-id')
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
            Monitor
          </button>
          <button
            className={`${styles.viewTab} ${sidebarView === 'manage' || sidebarView === 'both' ? styles.viewTabActive : ''}`}
            onClick={() => onSidebarViewChange(sidebarView === 'both' ? 'monitor' : sidebarView === 'manage' ? 'both' : 'manage')}
          >
            Manage
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
            <span>{sidebarView === 'both' ? 'MONITORING' : 'MONITOR'}</span>
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
            <div className={styles.viewLabel}><span>ALL TASKS</span></div>
          )}
          <div className={styles.treeContainer}>
            <ManageViewSafe
              phases={props.phases} allTasks={props.allTasks}
              activeProjectId={props.activeProjectId} activePhaseId={props.activePhaseId}
              activeTaskId={props.activeTaskId}
              collapsed={collapsed} toggle={toggle}
              onSelectPhase={props.onSelectPhase} onSelectTask={props.onSelectTask}
              onTaskContext={handleTaskContext} onPhaseDrop={handlePhaseDrop} dragOverPhase={dragOverPhase}
              onCreatePhase={props.onCreatePhase} onCreateTask={props.onCreateTask}
              onReorderTasks={props.onReorderTasks} onReorderPhases={props.onReorderPhases}
            />
            {/* File explorer — collapsible */}
            {props.workspacePath && (
              <>
                <div
                  className={styles.fileTreeHeader}
                  onClick={() => toggle('files-section')}
                >
                  <span className={styles.chevron}>{collapsed['files-section'] ? '▸' : '▾'}</span>
                  <span>FILES</span>
                </div>
                {!collapsed['files-section'] && (
                  <FileTree rootPath={props.workspacePath} onOpenFile={props.onOpenFile} />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* New Project button */}
      <div className={styles.sidebarFooter}>
        <button className={styles.addBtn} onClick={props.onRequestCreateProject}>+ New Project</button>
      </div>
    </div>
  )
}
