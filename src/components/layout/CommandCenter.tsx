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
  onReorderTasks?: (phaseId: string, orderedIds: string[]) => void
  onReorderPhases?: (projectId: string, orderedIds: string[]) => void
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
  onCreateProject: (name: string, path: string, engine?: string) => void
  onRequestCreateProject: () => void
  showCreateProject?: boolean
  onCancelCreateProject?: () => void
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
  onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask, onPinTask, onDeleteTask, onForkTask, onMoveTask, onReorderTasks, onReorderPhases,
  onDetach, onReattach, onRunAgent, onStopAgent, onResumeAgent, onMarkCompleted, onSummarize, onRestartFresh, onSendMessage, onSSHConnect, onLocalConnect, onRemoteConnect, onOpenSSH, onDisconnectSSH,
  onCreateProject, onRequestCreateProject, showCreateProject, onCancelCreateProject, onCreatePhase, onCreateTask, onImportProject,
  onPhaseSummarize, onProjectSummarize
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

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
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />

      {/* Titlebar — VS Code style */}
      <div className={styles.titlebar}>
        {/* Menu button */}
        <div className={styles.menuWrapper}>
          <button className={styles.menuBtn} onClick={() => setMenuOpen(v => !v)}>≡</button>
          {menuOpen && (
            <>
              <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
              <div className={styles.menu}>
                <div className={styles.menuSection}>Summarize</div>
                <button className={styles.menuItem} disabled={!activePhase} onClick={() => { onPhaseSummarize?.(activePhase!.id); setMenuOpen(false) }}>
                  <span>Phase Summary</span>
                  <span className={styles.menuHint}>Analyze current phase pipeline</span>
                </button>
                <button className={styles.menuItem} disabled={!activeProject} onClick={() => { onProjectSummarize?.(activeProject!.id); setMenuOpen(false) }}>
                  <span>Project Summary</span>
                  <span className={styles.menuHint}>Analyze overall project progress</span>
                </button>

                <div className={styles.menuDivider} />
                <div className={styles.menuSection}>Session</div>
                <button className={styles.menuItem} disabled={!activeProject} onClick={() => { handleExport(); setMenuOpen(false) }}>
                  <span>Export Session</span>
                  <span className={styles.menuHint}>Save project state as JSON</span>
                </button>
                <button className={styles.menuItem} onClick={() => { fileInputRef.current?.click(); setMenuOpen(false) }}>
                  <span>Import Session</span>
                  <span className={styles.menuHint}>Restore from exported JSON</span>
                </button>

                <div className={styles.menuDivider} />
                <button className={styles.menuItem} onClick={() => { setShowShortcuts(true); setMenuOpen(false) }}>
                  <span>Keyboard Shortcuts</span>
                  <span className={styles.menuKey}>?</span>
                </button>

                {(monitorDetached || railDetached) && (
                  <>
                    <div className={styles.menuDivider} />
                    <div className={styles.menuSection}>Windows</div>
                    {monitorDetached && (
                      <button className={styles.menuItem} onClick={() => { onReattach('monitor'); setMenuOpen(false) }}>
                        <span>Reattach Monitor</span>
                      </button>
                    )}
                    {railDetached && (
                      <button className={styles.menuItem} onClick={() => { onReattach('statusrail'); setMenuOpen(false) }}>
                        <span>Reattach Status Rail</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Breadcrumb */}
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

        {/* Pipeline summary — center */}
        <div className={styles.titleCenter}>
          {activeProject?.summary && (
            <span className={styles.pipelineChip} title={activeProject.summary.overallProgress}>
              {activeProject.summary.pipeline}
            </span>
          )}
          {activePhase?.summary && (
            <span className={styles.pipelineChip} title={activePhase.summary.currentState}>
              {activePhase.summary.pipeline}
            </span>
          )}
        </div>

        {/* Connection status — only essential info on the right */}
        <div className={styles.titleRight}>
          {sshConnected ? (
            <button
              className={`${styles.connectionBadge} ${connectionStatus === 'lost' || connectionStatus === 'reconnecting' ? styles.reconnecting : styles.connected}`}
              onClick={onDisconnectSSH}
              title={claudeVersion ? `Claude ${claudeVersion} — Click to disconnect` : 'Click to disconnect'}
            >
              {connectionStatus === 'lost' || connectionStatus === 'reconnecting'
                ? '◌ Reconnecting...'
                : connectionStatus === 'restored'
                  ? '● Restored'
                  : `● ${activeProject?.connection?.type === 'local' ? 'Local' : activeProject?.connection?.type === 'remote' ? 'Remote' : activeProject?.connection?.ssh?.host || 'Connected'}`
              }
            </button>
          ) : (
            <button className={styles.connectionBadge} onClick={onOpenSSH}>
              ○ Connect
            </button>
          )}
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

      {/* Pipeline issues bar — only when there are issues */}
      {(activePhase?.summary?.issues?.length ?? 0) > 0 && (
        <div className={styles.pipelineIssuesBar}>
          {activePhase!.summary!.issues.map((issue, i) => (
            <span key={i} className={styles.pipelineIssue}>{issue}</span>
          ))}
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
            onReorderTasks={onReorderTasks}
            onReorderPhases={onReorderPhases}
            onRequestCreateProject={onRequestCreateProject}
            onCreatePhase={onCreatePhase}
            onCreateTask={onCreateTask}
            onDetach={() => onDetach('monitor')}
          />
        ) : (
          <div className={styles.detachedPlaceholder}>
            <span>M</span>
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
          showCreateProject={showCreateProject}
          onCancelCreateProject={onCancelCreateProject}
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
            <span>R</span>
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
