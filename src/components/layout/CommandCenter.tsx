import type { Project, Phase, Task } from '../../../shared/types'
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
  onDetach: (panelId: string) => void
  onReattach: (panelId: string) => void
  onRunAgent: (taskId: string) => void
  onStopAgent: (taskId: string) => void
  onSendMessage: (taskId: string, message: string) => void
  onSSHConnect: (config: import('../../../shared/types').ConnectionConfig, appConfig?: import('../../../shared/types').AppConfig) => void
  onOpenSSH: () => void
  onDisconnectSSH: () => void
  onCreateProject: (name: string, path: string) => void
  onCreatePhase: (name: string, description: string) => void
  onCreateTask: (name: string, prompt: string) => void
  sshConnected: boolean
  sshConnecting?: boolean
  sshError?: string
  claudeVersion?: string
}

export function CommandCenter({
  projects, activeProject, phases, allPhases, activePhase,
  allTasks, allProjectTasks, activeTask,
  sidebarView, detachedPanels,
  sshConnected, sshConnecting, sshError, claudeVersion,
  onSidebarViewChange,
  onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask, onPinTask,
  onDetach, onReattach, onRunAgent, onStopAgent, onSendMessage, onSSHConnect, onOpenSSH, onDisconnectSSH,
  onCreateProject, onCreatePhase, onCreateTask
}: Props) {
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
          {sshConnected ? (
            <button
              className={`${styles.connectionBadge} ${styles.connected}`}
              onClick={onDisconnectSSH}
              title={claudeVersion ? `Claude ${claudeVersion} — Click to disconnect` : 'Click to disconnect'}
            >
              ● SSH Connected
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
        </div>
      </div>

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
          onSendMessage={onSendMessage}
          onSSHConnect={onSSHConnect}
          onOpenSSH={onOpenSSH}
          onCreateProject={onCreateProject}
          onCreatePhase={onCreatePhase}
          onCreateTask={onCreateTask}
          hasProjects={projects.length > 0}
          hasPhases={phases.filter(p => p.projectId === activeProject?.id).length > 0}
          activeProjectName={activeProject?.name}
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
