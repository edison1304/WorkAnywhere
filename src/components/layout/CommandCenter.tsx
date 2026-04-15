import { useCallback, useRef, useState } from 'react'
import type { Project, Phase, Task, SessionDescriptor } from '../../../shared/types'
import { TreeSidebar, type SidebarView } from './TreeSidebar'
import { StatusRail } from './StatusRail'
import { MainPanel } from './MainPanel'
import styles from './CommandCenter.module.css'

interface Props {
  projects: Project[]
  activeProject: Project | null
  phases: Phase[]
  allPhases: Phase[]
  activePhase: Phase | null
  allTasks: Task[]
  allProjectTasks: Task[]
  activeTask: Task | null
  sidebarView: SidebarView
  detachedPanels: Set<string>
  onSidebarViewChange: (view: SidebarView) => void
  onSelectProject: (id: string) => void
  onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void
  onAcknowledgeTask: (id: string) => void
  onPinTask: (id: string) => void
  onDeleteTask?: (id: string) => void
  onForkTask?: (id: string) => void
  onMoveTask?: (taskId: string, targetPhaseId: string) => void
  onDetach: (panelId: string) => void
  onReattach: (panelId: string) => void
  onRunAgent: (taskId: string) => void
  onStopAgent: (taskId: string) => void
  onResumeAgent?: (taskId: string) => void
  onMarkCompleted?: (taskId: string) => void
  onSummarize?: (taskId: string) => void
  onRestartFresh?: (taskId: string) => void
  onSendMessage: (taskId: string, message: string) => void
  onSSHConnect: (config: import('../../../shared/types').ConnectionConfig, appConfig?: import('../../../shared/types').AppConfig) => void
  onLocalConnect?: () => void
  onRemoteConnect?: (remoteLink: string) => void
  onOpenSSH: () => void
  onDisconnectSSH: () => void
  onCreateProject: (name: string, path: string) => void
  onCreatePhase: (name: string, description: string) => void
  onCreateTask: (name: string, purpose: string, prompt: string) => void
  onImportProject?: (projectId: string) => void
  onPhaseSummarize?: (phaseId: string) => void
  onProjectSummarize?: (projectId: string) => void
  sshConnected: boolean
  sshConnecting?: boolean
  sshError?: string
  claudeVersion?: string
  connectionStatus?: string | null
}

export function CommandCenter({
  projects, activeProject, phases, allPhases, activePhase,
  allTasks, allProjectTasks, activeTask,
  sidebarView, detachedPanels,
  sshConnected, sshConnecting, sshError, claudeVersion, connectionStatus,
  onSidebarViewChange,
  onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask, onPinTask, onDeleteTask, onForkTask, onMoveTask,
  onDetach, onReattach, onRunAgent, onStopAgent, onResumeAgent, onMarkCompleted, onSummarize, onRestartFresh, onSendMessage, onSSHConnect, onLocalConnect, onRemoteConnect, onOpenSSH, onDisconnectSSH,
  onCreateProject, onCreatePhase, onCreateTask, onImportProject,
  onPhaseSummarize, onProjectSummarize
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)

  const handleExport = useCallback(async () => {
    if (!activeProject || !window.api) return
    const result = await window.api.descriptorExport(activeProject.id)
    if (result.success && result.descriptor) {
      const json = JSON.stringify(result.descriptor, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeProject.name.replace(/\s+/g, '_')}_session.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [activeProject])

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !window.api) return
    try {
      const text = await file.text()
      const descriptor: SessionDescriptor = JSON.parse(text)
      if (descriptor.version !== 1) {
        alert('Unsupported descriptor version')
        return
      }
      const result = await window.api.descriptorImport(descriptor)
      if (result.success && result.projectId) {
        onImportProject?.(result.projectId)
      }
    } catch (err) {
      alert('Invalid session descriptor file')
    }
    e.target.value = ''
  }, [onImportProject])
  const monitorDetached = detachedPanels.has('monitor')
  const railDetached = detachedPanels.has('statusrail')

  return (
    <div className={styles.root}>
      {/* Header bar */}
      <div className={styles.titlebar}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={styles.titleText}>Workanywhere</span>
          {activeProject && (
            <span className={styles.breadcrumb}>
              <span className={styles.breadcrumbItem}>{activeProject.name}</span>
              {activePhase && (
                <>
                  <span className={styles.breadcrumbSep}>/</span>
                  <span className={styles.breadcrumbItem}>{activePhase.name}</span>
                </>
              )}
              {activeTask && (
                <>
                  <span className={styles.breadcrumbSep}>/</span>
                  <span className={styles.breadcrumbItem}>{activeTask.name}</span>
                </>
              )}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Detached indicators */}
          {monitorDetached && (
            <button className={styles.detachIndicator} onClick={() => onReattach('monitor')} title="Reattach Monitor">
              📡 ↩
            </button>
          )}
          {railDetached && (
            <button className={styles.detachIndicator} onClick={() => onReattach('statusrail')} title="Reattach Status Rail">
              📊 ↩
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
          {activePhase && (
            <button className={styles.headerBtn} onClick={() => onPhaseSummarize?.(activePhase.id)} title="Summarize phase pipeline">
              Phase Summary
            </button>
          )}
          {activeProject && (
            <button className={styles.headerBtn} onClick={() => onProjectSummarize?.(activeProject.id)} title="Summarize project pipeline">
              Project Summary
            </button>
          )}
          {activeProject && (
            <button className={styles.headerBtn} onClick={handleExport} title="Export session descriptor">
              Export
            </button>
          )}
          <button className={styles.headerBtn} onClick={() => fileInputRef.current?.click()} title="Import session descriptor">
            Import
          </button>
          {sshConnected ? (
            <button
              className={`${styles.connectionBadge} ${connectionStatus === 'lost' || connectionStatus === 'reconnecting' ? styles.reconnecting : styles.connected}`}
              onClick={onDisconnectSSH}
              title={claudeVersion ? `Claude ${claudeVersion} — Click to disconnect all` : 'Click to disconnect all'}
            >
              {connectionStatus === 'lost' || connectionStatus === 'reconnecting'
                ? '◌ Reconnecting...'
                : connectionStatus === 'restored'
                  ? '● Restored'
                  : `● ${activeProject?.connection?.type === 'local' ? 'Local' : activeProject?.connection?.type === 'remote' ? 'Remote' : activeProject?.connection?.ssh?.host || 'Connected'}`
              }
            </button>
          ) : (
            <button
              className={styles.connectionBadge}
              onClick={onOpenSSH}
              title="Connect via SSH"
            >
              ○ Connect SSH
            </button>
          )}
          <button
            className={styles.headerBtn}
            onClick={() => setShowShortcuts(s => !s)}
            title="Keyboard shortcuts"
          >
            ?
          </button>
        </div>
      </div>

      {/* Shortcuts overlay */}
      {showShortcuts && (
        <div className={styles.shortcutsOverlay} onClick={() => setShowShortcuts(false)}>
          <div className={styles.shortcutsPanel} onClick={e => e.stopPropagation()}>
            <div className={styles.shortcutsTitle}>Keyboard Shortcuts</div>
            <div className={styles.shortcutsList}>
              <div><kbd>Ctrl+1~9</kbd> Switch to Nth task</div>
              <div><kbd>Ctrl+Tab</kbd> Next task</div>
              <div><kbd>Ctrl+Shift+Tab</kbd> Previous task</div>
              <div><kbd>Ctrl+Shift+R</kbd> Run / Resume task</div>
              <div><kbd>Ctrl+.</kbd> Stop task</div>
              <div><kbd>Ctrl+Shift+S</kbd> Summarize task</div>
              <div><kbd>Ctrl+Shift+A</kbd> Approve (review → completed)</div>
              <div><kbd>Ctrl+M</kbd> Toggle sidebar (monitor/manage)</div>
              <div><kbd>Ctrl+Enter</kbd> Send message (in chat)</div>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline bar — project/phase summary */}
      {(activeProject?.summary || activePhase?.summary) && (
        <div className={styles.pipelineBar}>
          {activeProject?.summary && (
            <div className={styles.pipelineRow}>
              <span className={styles.pipelineLabel}>Project</span>
              <span className={styles.pipelineFlow}>{activeProject.summary.pipeline}</span>
              <span className={styles.pipelineStatus}>{activeProject.summary.overallProgress}</span>
            </div>
          )}
          {activePhase?.summary && (
            <div className={styles.pipelineRow}>
              <span className={styles.pipelineLabel}>Phase</span>
              <span className={styles.pipelineFlow}>{activePhase.summary.pipeline}</span>
              <span className={styles.pipelineStatus}>{activePhase.summary.currentState}</span>
            </div>
          )}
          {(activePhase?.summary?.issues?.length ?? 0) > 0 && (
            <div className={styles.pipelineIssues}>
              {activePhase!.summary!.issues.map((issue, i) => (
                <span key={i} className={styles.pipelineIssue}>{issue}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main layout */}
      <div className={styles.body}>
        {/* Sidebar: show or show placeholder if detached */}
        {!monitorDetached ? (
          <TreeSidebar
            projects={projects}
            phases={allPhases}
            allTasks={allTasks}
            activeProjectId={activeProject?.id || null}
            activePhaseId={activePhase?.id || null}
            activeTaskId={activeTask?.id || null}
            sidebarView={sidebarView}
            onSidebarViewChange={onSidebarViewChange}
            onSelectProject={onSelectProject}
            onSelectPhase={onSelectPhase}
            onSelectTask={onSelectTask}
            onAcknowledgeTask={onAcknowledgeTask}
            onPinTask={onPinTask}
            onDeleteTask={onDeleteTask}
            onForkTask={onForkTask}
            onMoveTask={onMoveTask}
            onCreateProject={onCreateProject}
            onCreatePhase={onCreatePhase}
            onCreateTask={onCreateTask}
            onDetach={() => onDetach('monitor')}
          />
        ) : (
          <div className={styles.detachedPlaceholder}>
            <span>📡</span>
            <span>Monitor on<br />second display</span>
            <button className={styles.reattachBtn} onClick={() => onReattach('monitor')}>
              ↩ Reattach
            </button>
          </div>
        )}

        {/* Main panel always visible */}
        <MainPanel
          activeTask={activeTask}
          activePhase={activePhase}
          sshConnected={sshConnected}
          sshConnecting={sshConnecting}
          sshError={sshError}
          onRunAgent={onRunAgent}
          onStopAgent={onStopAgent}
          onResumeAgent={onResumeAgent}
          onMarkCompleted={onMarkCompleted}
          onSummarize={onSummarize}
          onRestartFresh={onRestartFresh}
          onSendMessage={onSendMessage}
          onSSHConnect={onSSHConnect}
          onLocalConnect={onLocalConnect}
          onRemoteConnect={onRemoteConnect}
          onOpenSSH={onOpenSSH}
          onCreateProject={onCreateProject}
          onCreatePhase={onCreatePhase}
          onCreateTask={onCreateTask}
          hasProjects={projects.length > 0}
          hasPhases={phases.filter(p => p.projectId === activeProject?.id).length > 0}
          activeProjectName={activeProject?.name}
          workspacePath={activeProject?.workspacePath}
        />

        {/* Status rail: show or placeholder */}
        {!railDetached ? (
          <StatusRail
            allTasks={allProjectTasks}
            phases={phases}
            activeTaskId={activeTask?.id || null}
            onSelectTask={onSelectTask}
            onDetach={() => onDetach('statusrail')}
          />
        ) : (
          <div className={styles.detachedPlaceholder}>
            <span>📊</span>
            <span>Status Rail on<br />second display</span>
            <button className={styles.reattachBtn} onClick={() => onReattach('statusrail')}>
              ↩ Reattach
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
