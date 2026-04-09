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
  onSidebarViewChange: (view: SidebarView) => void
  onSelectProject: (id: string) => void
  onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void
  onAcknowledgeTask: (id: string) => void
}

export function CommandCenter({
  projects, activeProject, phases, allPhases, activePhase,
  allTasks, allProjectTasks, activeTask,
  sidebarView, onSidebarViewChange,
  onSelectProject, onSelectPhase, onSelectTask, onAcknowledgeTask
}: Props) {
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
          <span className={styles.connectionBadge}>
            {activeProject?.connection.type === 'ssh' ? 'SSH' : 'Local'}
          </span>
        </div>
      </div>

      {/* Main layout */}
      <div className={styles.body}>
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
        />
        <MainPanel activeTask={activeTask} activePhase={activePhase} />
        <StatusRail
          allTasks={allProjectTasks}
          phases={phases}
          activeTaskId={activeTask?.id || null}
          onSelectTask={onSelectTask}
        />
      </div>
    </div>
  )
}
