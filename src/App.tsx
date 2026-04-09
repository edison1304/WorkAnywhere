import { useState, useCallback, useEffect } from 'react'
import { CommandCenter } from './components/layout/CommandCenter'
import { DetachedMonitor } from './components/layout/DetachedMonitor'
import { DetachedStatusRail } from './components/layout/DetachedStatusRail'
import { SSHConnectDialog } from './components/project/SSHConnectDialog'
import type { Project, Phase, Task, ConnectionConfig, LogEntry } from '../shared/types'
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
  const [detachedPanels, setDetachedPanels] = useState<Set<string>>(new Set())

  // SSH state
  const [sshConnected, setSshConnected] = useState(false)
  const [sshConnecting, setSshConnecting] = useState(false)
  const [sshError, setSshError] = useState<string>()
  const [claudeVersion, setClaudeVersion] = useState<string>()

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) || null : null
  const projectPhases = phases.filter(ph => ph.projectId === activeProjectId)
  const activePhase = activePhaseId ? phases.find(ph => ph.id === activePhaseId) || null : null
  const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) || null : null
  const allProjectTasks = tasks.filter(t => t.projectId === activeProjectId)

  // ─── SSH connection ───
  const handleSSHConnect = useCallback(async (config: ConnectionConfig) => {
    if (!window.api) return
    setSshConnecting(true)
    setSshError(undefined)
    try {
      const result = await window.api.sshConnect(config)
      if (result.success) {
        setSshConnected(true)
        setSshDialogOpen(false)
        if (result.claude?.version) setClaudeVersion(result.claude.version)
        if (!result.claude?.available) {
          setSshError('Connected, but claude CLI not found on server')
        }
      } else {
        setSshError(result.error || 'Connection failed')
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

  // ─── Agent control ───
  const handleRunAgent = useCallback(async (taskId: string) => {
    if (!window.api || !sshConnected) {
      setSshDialogOpen(true)
      return
    }
    const task = tasks.find(t => t.id === taskId)
    const project = projects.find(p => p.id === task?.projectId)
    if (!task || !project) return

    // Update task status locally
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'running' as const, logs: [
        ...t.logs,
        { id: `${taskId}-start`, taskId, timestamp: new Date().toISOString(), type: 'agent_start' as const, content: 'Agent started' }
      ]} : t
    ))

    const result = await window.api.agentStart({
      projectId: task.projectId,
      phaseId: task.phaseId,
      taskId,
      workspacePath: project.workspacePath,
      prompt: task.prompt,
    })

    if (!result.success) {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'failed' as const, logs: [
          ...t.logs,
          { id: `${taskId}-err`, taskId, timestamp: new Date().toISOString(), type: 'error' as const, content: result.error || 'Failed to start' }
        ]} : t
      ))
    }
  }, [sshConnected, tasks])

  const handleStopAgent = useCallback(async (taskId: string) => {
    if (!window.api) return
    await window.api.agentStop(taskId)
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'failed' as const } : t
    ))
  }, [])

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
    })

    const unsubLog = window.api.onTaskLog(({ taskId, log }) => {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, logs: [...t.logs, log] } : t
      ))
    })

    return () => { unsubStatus(); unsubLog() }
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

  const handleAcknowledgeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, acknowledgedAt: new Date().toISOString() } : t
    ))
  }, [])

  const handlePinTask = useCallback((taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, pinned: !t.pinned } : t
    ))
  }, [])

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
        detachedPanels={detachedPanels}
        sshConnected={sshConnected}
        claudeVersion={claudeVersion}
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
        onSelectTask={setActiveTaskId}
        onAcknowledgeTask={handleAcknowledgeTask}
        onPinTask={handlePinTask}
        onDetach={handleDetach}
        onReattach={handleReattach}
        sshConnected={sshConnected}
        sshConnecting={sshConnecting}
        sshError={sshError}
        claudeVersion={claudeVersion}
        onRunAgent={handleRunAgent}
        onStopAgent={handleStopAgent}
        onSSHConnect={handleSSHConnect}
        onOpenSSH={() => setSshDialogOpen(true)}
        onDisconnectSSH={handleSSHDisconnect}
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
