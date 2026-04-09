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
  onDetach: (panelId: string) => void
  onReattach: (panelId: string) => void
}

export function CommandCenter({
  projects, activeProject, phases, allPhases, activePhase,
  allTasks, allProjectTasks, activeTask,
  sidebarView, detachedPanels, onSidebarViewChange,
  onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask,
  onDetach, onReattach
}: Props) {
  const monitorDetached = detachedPanels.has('monitor')
  const railDetached = detachedPanels.has('statusrail')

  return (
    <div className={styles.root}>
      {/* Titlebar */}
      <div className={styles.titlebar}>
        <div className="titlebar-drag" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <div className="titlebar-nodrag" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <span className={styles.connectionBadge}>
            {activeProject?.connection.type === 'ssh' ? 'SSH' : 'Local'}
          </span>
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
        <MainPanel activeTask={activeTask} activePhase={activePhase} />

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
