import { useState, useCallback, useEffect, useRef } from 'react'
import { CommandCenter } from './components/layout/CommandCenter'
import { DetachedMonitor } from './components/layout/DetachedMonitor'
import { DetachedStatusRail } from './components/layout/DetachedStatusRail'
import { SSHConnectDialog } from './components/project/SSHConnectDialog'
import type { Project, Phase, Task, ConnectionConfig, LogEntry, Artifact, TaskSummary } from '../shared/types'
import type { SidebarView } from './components/layout/TreeSidebar'

export default function App() {
  // Check if this is a detached window
  const windowHash = typeof window !== 'undefined' && window.api
    ? window.api.getWindowHash() : ''

  const [projects, setProjects] = useState<Project[]>([])
  const [phases, setPhases] = useState<Phase[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [sidebarView, setSidebarView] = useState<SidebarView>('monitor')
  const [currentPage, setCurrentPage] = useState<'workspace' | 'schedule' | 'timeline'>('workspace')
  const [detachedPanels, setDetachedPanels] = useState<Set<string>>(new Set())
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [openFilePath, setOpenFilePath] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced save to server — called after data changes
  const syncToServer = useCallback(() => {
    if (!window.api) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      window.api.dataSaveToServer().catch(() => {})
    }, 2000)
  }, [])

  // Load data from server after connection established
  const loadFromServer = useCallback(async () => {
    if (!window.api) return
    const result = await window.api.dataLoadFromServer()
    if (result.success && result.data) {
      if (result.data.projects?.length) setProjects(result.data.projects)
      if (result.data.phases?.length) setPhases(result.data.phases)
      if (result.data.tasks?.length) setTasks(result.data.tasks)
      if (result.data.projects?.length) {
        setActiveProjectId(result.data.projects[0].id)
      }
    } else {
      // No server data — try local fallback
      const local = await window.api.dataLoad()
      if (local.success && local.data) {
        if (local.data.projects?.length) setProjects(local.data.projects)
        if (local.data.phases?.length) setPhases(local.data.phases)
        if (local.data.tasks?.length) setTasks(local.data.tasks)
        if (local.data.projects?.length) {
          setActiveProjectId(local.data.projects[0].id)
        }
      }
    }
  }, [])

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null) // 'lost' | 'reconnecting' | 'restored' | 'failed' | null
  const [sshConnected, setSshConnected] = useState(false)
  const [sshDialogOpen, setSshDialogOpen] = useState(false)
  const [sshConnecting, setSshConnecting] = useState(false)
  const [sshError, setSshError] = useState<string>()
  const [claudeVersion, setClaudeVersion] = useState<string>()

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) || null : null
  const projectPhases = phases.filter(ph => ph.projectId === activeProjectId)
  const activePhase = activePhaseId ? phases.find(ph => ph.id === activePhaseId) || null : null
  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) || null : null
  const allProjectTasks = tasks.filter(t => t.projectId === activeProjectId)

  // ─── SSH connection ───
  const handleSSHConnect = useCallback(async (config: ConnectionConfig, appConfig?: any) => {
    if (!window.api) return
    setSshConnecting(true)
    setSshError(undefined)
    try {
      const result = await window.api.sshConnect(config, appConfig || undefined)
      if (result.success) {
        setSshConnected(true)
        setSshDialogOpen(false)
        setLastConnectionConfig(config)
        if (result.claude?.version) setClaudeVersion(result.claude.version)
        if (!result.claude?.available) {
          setSshError('Connected, but claude CLI not found on server')
        }
        // Load workspace data from server
        loadFromServer()
      } else {
        setSshError(result.error || 'Connection failed')
      }
    } catch (err) {
      setSshError(String(err))
    } finally {
      setSshConnecting(false)
    }
  }, [])

  const handleRemoteConnect = useCallback(async (remoteLink: string) => {
    if (!window.api) return
    setSshConnecting(true)
    setSshError(undefined)
    try {
      const result = await window.api.remoteConnect(remoteLink)
      if (result.success) {
        setSshConnected(true)
        setLastConnectionConfig({ type: 'remote', remote: { link: remoteLink } })
        loadFromServer()
        if (result.claude?.version) setClaudeVersion(result.claude.version)
      } else {
        setSshError(result.error || 'Remote connection failed')
      }
    } catch (err) {
      setSshError(String(err))
    } finally {
      setSshConnecting(false)
    }
  }, [])

  const handleLocalConnect = useCallback(async () => {
    if (!window.api) return
    setSshConnecting(true)
    setSshError(undefined)
    try {
      const result = await window.api.localConnect()
      if (result.success) {
        setSshConnected(true)
        setLastConnectionConfig({ type: 'local' })
        loadFromServer()
        if (result.claude?.version) setClaudeVersion(result.claude.version)
      } else {
        setSshError(result.error || 'Local connection failed')
      }
    } catch (err) {
      setSshError(String(err))
    } finally {
      setSshConnecting(false)
    }
  }, [])

  const handleSSHDisconnect = useCallback(async () => {
    if (!window.api) return
    await window.api.sshDisconnect()
    setSshConnected(false)
    setClaudeVersion(undefined)
  }, [])

  // ─── Agent control (via IPC) ───
  const handleRunAgent = useCallback(async (taskId: string) => {
    if (!window.api) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Auto-connect project if not connected
    if (!sshConnected) {
      const project = projects.find(p => p.id === task.projectId)
      if (!project) return
      const connectResult = await window.api.projectConnect(project.id)
      if (!connectResult.success) {
        setSshError(connectResult.error)
        setSshDialogOpen(true)
        return
      }
      setSshConnected(true)
      if (connectResult.claude?.version) setClaudeVersion(connectResult.claude.version)
    }

    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'running' as const } : t
    ))

    const result = await window.api.taskRun(taskId)
    if (!result.success) {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'failed' as const } : t
      ))
    }
  }, [sshConnected, tasks, projects])

  const handleResumeAgent = useCallback(async (taskId: string) => {
    if (!window.api) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Auto-connect
    if (!sshConnected) {
      const project = projects.find(p => p.id === task.projectId)
      if (project) {
        const r = await window.api.projectConnect(project.id)
        if (r.success) setSshConnected(true)
      }
    }

    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'running' as const } : t
    ))
    const result = await window.api.agentResume(taskId)
    if (!result.success) {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'failed' as const } : t
      ))
    }
  }, [sshConnected, tasks, projects])

  const handleStopAgent = useCallback(async (taskId: string) => {
    if (!window.api) return
    await window.api.taskStop(taskId)
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'failed' as const } : t
    ))
  }, [])

  const handleSendMessage = useCallback(async (taskId: string, message: string) => {
    if (!window.api) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    if (task.status === 'idle') {
      // First message on idle task → update prompt and run agent
      await window.api.taskUpdate(taskId, { prompt: message })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, prompt: message } : t))
      handleRunAgent(taskId)
    } else if (task.status === 'running' || task.status === 'waiting') {
      // Active agent → send follow-up
      await window.api.taskSend(taskId, message)
    } else {
      // review/completed/failed → resume with this message as prompt
      await window.api.taskUpdate(taskId, { prompt: message })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, prompt: message } : t))
      handleRunAgent(taskId)
    }
  }, [tasks, handleRunAgent])

  // ─── Create project/phase/task (via IPC → DataStore) ───
  // Store the last used connection config for new projects
  const [lastConnectionConfig, setLastConnectionConfig] = useState<ConnectionConfig>({ type: 'ssh' })

  const handleCreateProject = useCallback(async (name: string, path: string, engine?: string) => {
    if (!window.api) return
    const project = await window.api.projectCreate({
      name,
      workspacePath: path,
      connection: lastConnectionConfig,
    })
    // Apply engine setting if specified
    if (engine && engine !== 'claude') {
      await window.api.projectUpdate(project.id, {
        settings: { ...project.settings, agentEngine: engine as any },
      })
      project.settings.agentEngine = engine as any
    }
    setProjects(prev => [...prev, project])
    setActiveProjectId(project.id)
    setActivePhaseId(null)
    setActiveTaskId(null)
    setShowCreateProject(false)
    syncToServer()
  }, [syncToServer])

  const handleCreatePhase = useCallback(async (name: string, description: string) => {
    if (!activeProjectId || !window.api) return
    const phase = await window.api.phaseCreate(activeProjectId, name, description || undefined)
    setPhases(prev => [...prev, phase])
    setActivePhaseId(phase.id)
    setActiveTaskId(null)
    syncToServer()
  }, [activeProjectId, syncToServer])

  const handleCreateTask = useCallback(async (name: string, purpose: string, prompt: string) => {
    if (!activePhaseId || !window.api) return
    const task = await window.api.taskCreate(activePhaseId, name, purpose, prompt)
    setTasks(prev => [...prev, task])
    setActiveTaskId(task.id)
    syncToServer()
  }, [activePhaseId, syncToServer])

  const handleMarkCompleted = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'completed' as const } : t
    ))
    window.api?.taskUpdate(taskId, { status: 'completed' })
    syncToServer()

    // Auto-generate phase summary when last task in phase is completed
    if (task) {
      const phaseTasks = tasks.filter(t => t.phaseId === task.phaseId)
      const allDone = phaseTasks.every(t =>
        t.id === taskId || t.status === 'completed'
      )
      if (allDone && phaseTasks.length > 0) {
        window.api?.phaseSummarize(task.phaseId).then(result => {
          if (result.success && result.summary) {
            setPhases(prev => prev.map(ph =>
              ph.id === task.phaseId ? { ...ph, summary: result.summary } : ph
            ))
            syncToServer()
          }
        })
      }
    }
  }, [tasks, syncToServer])

  const handleSummarize = useCallback(async (taskId: string) => {
    if (!window.api) return
    // Show loading state in summary
    setTasks(prev => prev.map(t =>
      t.id === taskId ? {
        ...t,
        summary: { currentStep: '', completedSteps: [], nextSteps: [], issues: [], progress: 'Generating summary...', updatedAt: new Date().toISOString() }
      } : t
    ))
    const result = await window.api.taskSummarize(taskId)
    if (result.success && result.summary) {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, summary: result.summary } : t
      ))
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          summary: { currentStep: '', completedSteps: [], nextSteps: [], issues: [result.error || 'Summary failed'], progress: 'Summary generation failed', updatedAt: new Date().toISOString() }
        } : t
      ))
    }
  }, [])

  const handlePhaseSummarize = useCallback(async (phaseId: string) => {
    if (!window.api) return
    // Loading state
    setPhases(prev => prev.map(ph =>
      ph.id === phaseId ? { ...ph, summary: { pipeline: '...', currentState: 'Generating summary...', completedWork: [], pendingWork: [], issues: [], dependencies: [], updatedAt: new Date().toISOString() } } : ph
    ))
    const result = await window.api.phaseSummarize(phaseId)
    if (result.success && result.summary) {
      setPhases(prev => prev.map(ph =>
        ph.id === phaseId ? { ...ph, summary: result.summary } : ph
      ))
    }
  }, [])

  const handleProjectSummarize = useCallback(async (projectId: string) => {
    if (!window.api) return
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, summary: { pipeline: '...', currentPhase: 'Generating summary...', overallProgress: '', blockers: [], updatedAt: new Date().toISOString() } } : p
    ))
    const result = await window.api.projectSummarize(projectId)
    if (result.success && result.summary) {
      setProjects(prev => prev.map(p =>
        p.id === projectId ? { ...p, summary: result.summary } : p
      ))
    }
  }, [])

  const handleRestartFresh = useCallback(async (taskId: string) => {
    if (!window.api) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // 1. Stop current agent first
    await window.api.taskStop(taskId)
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'completed' as const } : t
    ))

    // 2. Try to summarize (with 20s timeout, skip if fails)
    let summaryText = ''
    try {
      const sumPromise = window.api.taskSummarize(taskId)
      const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 20000))
      const sumResult = await Promise.race([sumPromise, timeoutPromise])
      if (sumResult && 'success' in sumResult && sumResult.success && sumResult.summary) {
        const s = sumResult.summary
        summaryText = [
          'Previous session summary:',
          `- Progress: ${s.progress}`,
          s.completedSteps.length ? `- Completed: ${s.completedSteps.join('; ')}` : '',
          s.issues.length ? `- Issues encountered: ${s.issues.join('; ')}` : '',
          s.nextSteps.length ? `- Planned next: ${s.nextSteps.join('; ')}` : '',
          '',
        ].filter(Boolean).join('\n')
      }
    } catch { /* skip summary */ }

    // 3. Use existing summary if available and auto-summarize failed
    if (!summaryText && task.summary) {
      const s = task.summary
      summaryText = [
        'Previous session summary (cached):',
        `- Progress: ${s.progress}`,
        s.completedSteps.length ? `- Completed: ${s.completedSteps.join('; ')}` : '',
        s.issues.length ? `- Issues: ${s.issues.join('; ')}` : '',
        '',
      ].filter(Boolean).join('\n')
    }

    // 4. Create new task and run
    const newName = `${task.name} (continued)`
    const contextPrefix = summaryText
      ? `${summaryText}\nContinue from where the previous session left off.\n\n`
      : 'The previous session was restarted due to context drift. Continue the task:\n\n'
    const newPrompt = `${contextPrefix}Original task:\n${task.prompt}`
    const newTask = await window.api.taskCreate(task.phaseId, newName, task.purpose || '', newPrompt)
    setTasks(prev => [...prev, newTask])
    setActiveTaskId(newTask.id)
    syncToServer()
    setTimeout(() => handleRunAgent(newTask.id), 300)
  }, [tasks, handleRunAgent, syncToServer])

  const handleImportProject = useCallback(async (projectId: string) => {
    // Reload all data from DataStore after import
    if (!window.api) return
    const result = await window.api.dataLoad()
    if (result.success && result.data) {
      setProjects(result.data.projects || [])
      setPhases(result.data.phases || [])
      setTasks(result.data.tasks || [])
      setActiveProjectId(projectId)
      const firstPhase = (result.data.phases || []).find(
        (ph: Phase) => ph.projectId === projectId
      )
      setActivePhaseId(firstPhase?.id || null)
      setActiveTaskId(null)
    }
  }, [])

  // ─── Dynamic window title ───
  useEffect(() => {
    if (!window.api || windowHash) return // only main window
    const parts = ['Workanywhere']
    if (activeProject) parts.push(activeProject.name)
    if (activeTask) {
      const statusIcon = activeTask.status === 'running' ? '▶' :
        activeTask.status === 'review' ? '👀' :
        activeTask.status === 'completed' ? '✓' :
        activeTask.status === 'failed' ? '✕' : ''
      parts.push(`${statusIcon} ${activeTask.name}`.trim())
    }
    window.api.setWindowTitle(parts.join(' — '))
  }, [activeProject?.name, activeTask?.name, activeTask?.status, windowHash])

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    if (windowHash) return // only main window

    // Build list of visible tasks for Ctrl+1~9 switching
    const getVisibleTasks = (): Task[] => {
      return tasks.filter(t => t.projectId === activeProjectId)
    }

    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey

      // Ctrl+1~9: switch to Nth task
      if (ctrl && !shift && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = parseInt(e.key) - 1
        const visible = getVisibleTasks()
        if (visible[idx]) {
          setActiveTaskId(visible[idx].id)
          setActivePhaseId(visible[idx].phaseId)
        }
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: cycle tasks
      if (ctrl && e.key === 'Tab') {
        e.preventDefault()
        const visible = getVisibleTasks()
        if (visible.length === 0) return
        const currentIdx = visible.findIndex(t => t.id === activeTaskId)
        const nextIdx = shift
          ? (currentIdx <= 0 ? visible.length - 1 : currentIdx - 1)
          : (currentIdx >= visible.length - 1 ? 0 : currentIdx + 1)
        setActiveTaskId(visible[nextIdx].id)
        setActivePhaseId(visible[nextIdx].phaseId)
        return
      }

      // Ctrl+Shift+S: summarize current task
      if (ctrl && shift && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (activeTaskId) handleSummarize(activeTaskId)
        return
      }

      // Ctrl+Shift+R: run or resume current task
      if (ctrl && shift && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        if (!activeTask) return
        if (activeTask.status === 'idle' || activeTask.status === 'completed' || activeTask.status === 'failed') {
          handleRunAgent(activeTask.id)
        } else if (activeTask.status === 'review' && activeTask.sessionId) {
          handleResumeAgent(activeTask.id)
        }
        return
      }

      // Ctrl+.: stop current task
      if (ctrl && e.key === '.') {
        e.preventDefault()
        if (activeTask && (activeTask.status === 'running' || activeTask.status === 'waiting')) {
          handleStopAgent(activeTask.id)
        }
        return
      }

      // Ctrl+M: toggle sidebar view
      if (ctrl && !shift && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        setSidebarView(prev => prev === 'monitor' ? 'manage' : 'monitor')
        return
      }

      // Ctrl+Shift+A: approve (mark completed) current task
      if (ctrl && shift && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (activeTask?.status === 'review') handleMarkCompleted(activeTask.id)
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [windowHash, activeTaskId, activeProjectId, activeTask, tasks,
      handleSummarize, handleRunAgent, handleResumeAgent, handleStopAgent, handleMarkCompleted])

  // ─── Listen for agent events from main process ───
  useEffect(() => {
    if (!window.api) return

    const unsubStatus = window.api.onTaskStatus(({ taskId, status }) => {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? {
          ...t,
          status,
          ...(status === 'completed' || status === 'failed' ? { completedAt: new Date().toISOString() } : {})
        } : t
      ))
      // Sync to server on task completion/failure
      if (status === 'completed' || status === 'failed' || status === 'review') {
        syncToServer()
      }
    })

    const unsubLog = window.api.onTaskLog(({ taskId, log }) => {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, logs: [...t.logs, log] } : t
      ))
    })

    const unsubPlan = window.api.onTaskPlan(({ taskId, plan }) => {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, plan } : t
      ))
    })

    const unsubArtifact = window.api.onArtifactNew(({ taskId, artifact }) => {
      setTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t
        const existing = t.artifacts.findIndex(a => a.filePath === artifact.filePath)
        if (existing >= 0) {
          const updated = [...t.artifacts]
          updated[existing] = { ...artifact, action: 'modified' }
          return { ...t, artifacts: updated }
        }
        return { ...t, artifacts: [...t.artifacts, artifact] }
      }))
    })

    const unsubConnStatus = window.api.onConnectionStatus((data) => {
      setConnectionStatus(data.status)
      if (data.status === 'lost') {
        setSshError('Connection lost — reconnecting...')
      } else if (data.status === 'restored') {
        setSshError(undefined)
        setConnectionStatus(null) // clear after a moment
        setTimeout(() => setConnectionStatus(null), 3000)
      } else if (data.status === 'failed') {
        setSshConnected(false)
        setSshError('Connection lost — reconnection failed')
      }
    })

    return () => { unsubStatus(); unsubLog(); unsubPlan(); unsubArtifact(); unsubConnStatus() }
  }, [])

  // Sync detached panels list
  useEffect(() => {
    if (!window.api) return
    window.api.windowListDetached().then(panels => setDetachedPanels(new Set(panels)))
    const unsub = window.api.onWindowReattached((panelId) => {
      setDetachedPanels(prev => { const n = new Set(prev); n.delete(panelId); return n })
    })
    return unsub
  }, [])

  const handleAcknowledgeTask = useCallback(async (taskId: string) => {
    const acknowledgedAt = new Date().toISOString()
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, acknowledgedAt } : t
    ))
    window.api?.taskUpdate(taskId, { acknowledgedAt })
  }, [])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!window.api) return
    const task = tasks.find(t => t.id === taskId)
    if (task?.status === 'running') return // can't delete running task
    await window.api.taskDelete(taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    if (activeTaskId === taskId) setActiveTaskId(null)
    syncToServer()
  }, [tasks, activeTaskId, syncToServer])

  const handleDeletePhase = useCallback(async (phaseId: string) => {
    if (!window.api) return
    // Block delete if any task in this phase is running
    const phaseTasks = tasks.filter(t => t.phaseId === phaseId)
    if (phaseTasks.some(t => t.status === 'running')) return
    await window.api.phaseDelete(phaseId)
    setTasks(prev => prev.filter(t => t.phaseId !== phaseId))
    setPhases(prev => prev.filter(ph => ph.id !== phaseId))
    if (activePhaseId === phaseId) {
      setActivePhaseId(null)
      setActiveTaskId(null)
    }
    syncToServer()
  }, [tasks, activePhaseId, syncToServer])

  const handleDeleteProject = useCallback(async (projectId: string) => {
    if (!window.api) return
    // Block delete if any task in this project is running
    const projectTasks = tasks.filter(t => t.projectId === projectId)
    if (projectTasks.some(t => t.status === 'running')) return
    await window.api.projectDelete(projectId)
    setTasks(prev => prev.filter(t => t.projectId !== projectId))
    setPhases(prev => prev.filter(ph => ph.projectId !== projectId))
    setProjects(prev => prev.filter(p => p.id !== projectId))
    if (activeProjectId === projectId) {
      setActiveProjectId(null)
      setActivePhaseId(null)
      setActiveTaskId(null)
    }
    syncToServer()
  }, [tasks, activeProjectId, syncToServer])

  const handleForkTask = useCallback(async (taskId: string) => {
    if (!window.api) return
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const newTask = await window.api.taskCreate(task.phaseId, `${task.name} (fork)`, task.purpose || '', task.prompt)
    setTasks(prev => [...prev, newTask])
    setActiveTaskId(newTask.id)
    syncToServer()
  }, [tasks, syncToServer])

  const handleMoveTask = useCallback(async (taskId: string, targetPhaseId: string) => {
    if (!window.api) return
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.phaseId === targetPhaseId) return
    await window.api.taskUpdate(taskId, { phaseId: targetPhaseId } as any)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, phaseId: targetPhaseId } : t))
    syncToServer()
  }, [tasks, syncToServer])

  const handleReorderTasks = useCallback(async (phaseId: string, orderedIds: string[]) => {
    if (!window.api) return
    // Optimistic update
    setTasks(prev => prev.map(t => {
      const idx = orderedIds.indexOf(t.id)
      if (idx !== -1 && t.phaseId === phaseId) {
        return { ...t, order: idx + 1 }
      }
      return t
    }))
    await window.api.taskReorder(phaseId, orderedIds)
    syncToServer()
  }, [syncToServer])

  const handleReorderPhases = useCallback(async (projectId: string, orderedIds: string[]) => {
    if (!window.api) return
    // Optimistic update
    setPhases(prev => prev.map(ph => {
      const idx = orderedIds.indexOf(ph.id)
      if (idx !== -1 && ph.projectId === projectId) {
        return { ...ph, order: idx + 1 }
      }
      return ph
    }))
    await window.api.phaseReorder(projectId, orderedIds)
    syncToServer()
  }, [syncToServer])

  // Generic task update — used by Schedule page toggles (interactionLevel, weightHint)
  const handleUpdateTask = useCallback(async (taskId: string, patch: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
    if (window.api) {
      await window.api.taskUpdate(taskId, patch)
      syncToServer()
    }
  }, [syncToServer])

  const handlePinTask = useCallback(async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    const pinned = !task?.pinned
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, pinned } : t
    ))
    window.api?.taskUpdate(taskId, { pinned })
  }, [tasks])

  // Task select from detached window → focus main
  const handleSelectTaskFromDetached = useCallback((taskId: string | null) => {
    setActiveTaskId(taskId)
    if (taskId && window.api) {
      window.api.focusMain()
    }
  }, [])

  const handleDetach = useCallback(async (panelId: string) => {
    if (!window.api) return
    const titles: Record<string, string> = {
      monitor: 'Workanywhere — Monitor',
      statusrail: 'Workanywhere — Status Rail',
    }
    await window.api.windowDetach(panelId, {
      title: titles[panelId] || 'Workanywhere',
      width: panelId === 'monitor' ? 350 : 360,
      height: 800,
      preferSecondary: true,
    })
    setDetachedPanels(prev => new Set(prev).add(panelId))
  }, [])

  const handleReattach = useCallback(async (panelId: string) => {
    if (!window.api) return
    await window.api.windowReattach(panelId)
    setDetachedPanels(prev => { const n = new Set(prev); n.delete(panelId); return n })
  }, [])

  // ─── Detached window renders ───
  if (windowHash === 'monitor') {
    return (
      <DetachedMonitor
        projects={projects}
        phases={phases}
        allTasks={tasks}
        activeProjectId={activeProjectId}
        activePhaseId={activePhaseId}
        activeTaskId={activeTaskId}
        onSelectProject={setActiveProjectId}
        onSelectPhase={setActivePhaseId}
        onSelectTask={handleSelectTaskFromDetached}
        onAcknowledgeTask={handleAcknowledgeTask}
        onPinTask={handlePinTask}
      />
    )
  }

  if (windowHash === 'statusrail') {
    return (
      <DetachedStatusRail
        allTasks={allProjectTasks}
        phases={projectPhases}
        activeTaskId={activeTaskId}
        onSelectTask={handleSelectTaskFromDetached}
      />
    )
  }

  // ─── Main window ───
  return (
    <>
      <CommandCenter
        projects={projects}
        activeProject={activeProject}
        phases={projectPhases}
        allPhases={phases}
        activePhase={activePhase}
        allTasks={tasks}
        allProjectTasks={allProjectTasks}
        activeTask={activeTask}
        sidebarView={sidebarView}
        currentPage={currentPage}
        onChangePage={setCurrentPage}
        onUpdateTask={handleUpdateTask}
        detachedPanels={detachedPanels}
        sshConnected={sshConnected}
        sshConnecting={sshConnecting}
        sshError={sshError}
        claudeVersion={claudeVersion}
        connectionStatus={connectionStatus}
        onSidebarViewChange={setSidebarView}
        onSelectProject={(id) => {
          setActiveProjectId(id)
          const firstPhase = phases.find(ph => ph.projectId === id)
          setActivePhaseId(firstPhase?.id || null)
          setActiveTaskId(null)
        }}
        onSelectPhase={(id) => {
          setActivePhaseId(id)
          setActiveTaskId(null)
        }}
        onSelectTask={(id) => { setActiveTaskId(id); if (id) setOpenFilePath(null) }}
        onAcknowledgeTask={handleAcknowledgeTask}
        onPinTask={handlePinTask}
        onDeleteTask={handleDeleteTask}
        onDeletePhase={handleDeletePhase}
        onDeleteProject={handleDeleteProject}
        onForkTask={handleForkTask}
        onMoveTask={handleMoveTask}
        onReorderTasks={handleReorderTasks}
        onReorderPhases={handleReorderPhases}
        onDetach={handleDetach}
        onReattach={handleReattach}
        onRunAgent={handleRunAgent}
        onStopAgent={handleStopAgent}
        onResumeAgent={handleResumeAgent}
        onMarkCompleted={handleMarkCompleted}
        onSummarize={handleSummarize}
        onRestartFresh={handleRestartFresh}
        onSendMessage={handleSendMessage}
        onSSHConnect={handleSSHConnect}
        onLocalConnect={handleLocalConnect}
        onRemoteConnect={handleRemoteConnect}
        onOpenSSH={() => setSshDialogOpen(true)}
        onDisconnectSSH={handleSSHDisconnect}
        onCreateProject={handleCreateProject}
        onRequestCreateProject={() => setShowCreateProject(true)}
        showCreateProject={showCreateProject}
        onCancelCreateProject={() => setShowCreateProject(false)}
        onCreatePhase={handleCreatePhase}
        onCreateTask={handleCreateTask}
        onImportProject={handleImportProject}
        onOpenFile={(path) => { setOpenFilePath(path); setActiveTaskId(null) }}
        openFilePath={openFilePath}
        onPhaseSummarize={handlePhaseSummarize}
        onProjectSummarize={handleProjectSummarize}
      />
      <SSHConnectDialog
        isOpen={sshDialogOpen}
        onConnect={handleSSHConnect}
        onClose={() => setSshDialogOpen(false)}
        connecting={sshConnecting}
        error={sshError}
      />
    </>
  )
}
