import type { Project, Phase, Task } from '../../../shared/types'
import { ProjectSidebar } from './ProjectSidebar'
import { StatusRail } from './StatusRail'
import { MainPanel } from './MainPanel'
import styles from './CommandCenter.module.css'

interface Props {
  projects: Project[]
  activeProject: Project | null
  phases: Phase[]
  activePhase: Phase | null
  tasks: Task[]
  allTasks: Task[]
  activeTask: Task | null
  onSelectProject: (id: string) => void
  onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void
}

export function CommandCenter({
  projects, activeProject, phases, activePhase, tasks, allTasks, activeTask,
  onSelectProject, onSelectPhase, onSelectTask
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
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProject?.id || null}
          phases={phases}
          activePhaseId={activePhase?.id || null}
          tasks={tasks}
          activeTaskId={activeTask?.id || null}
          onSelectProject={onSelectProject}
          onSelectPhase={onSelectPhase}
          onSelectTask={onSelectTask}
        />
        <MainPanel activeTask={activeTask} activePhase={activePhase} />
        <StatusRail
          allTasks={allTasks}
          phases={phases}
          activeTaskId={activeTask?.id || null}
          onSelectTask={onSelectTask}
        />
      </div>
    </div>
  )
}
