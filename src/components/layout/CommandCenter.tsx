import type { Project, Job } from '../../../shared/types'
import { ProjectSidebar } from './ProjectSidebar'
import { StatusRail } from './StatusRail'
import { MainPanel } from './MainPanel'
import styles from './CommandCenter.module.css'

interface Props {
  projects: Project[]
  activeProject: Project | null
  jobs: Job[]
  allJobs: Job[]
  activeJob: Job | null
  onSelectProject: (id: string) => void
  onSelectJob: (id: string | null) => void
}

export function CommandCenter({
  projects, activeProject, jobs, allJobs, activeJob,
  onSelectProject, onSelectJob
}: Props) {
  return (
    <div className={styles.root}>
      {/* Titlebar */}
      <div className={styles.titlebar}>
        <div className="titlebar-drag" style={{ flex: 1 }}>
          <span className={styles.titleText}>Workanywhere</span>
          {activeProject && (
            <span className={styles.titleProject}>{activeProject.name}</span>
          )}
        </div>
        <div className="titlebar-nodrag" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={styles.connectionBadge}>
            {activeProject?.connection.type === 'ssh' ? 'SSH' : 'Local'}
          </span>
        </div>
      </div>

      {/* Main layout: sidebar + center + rail */}
      <div className={styles.body}>
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProject?.id || null}
          jobs={jobs}
          activeJobId={activeJob?.id || null}
          onSelectProject={onSelectProject}
          onSelectJob={onSelectJob}
        />
        <MainPanel activeJob={activeJob} />
        <StatusRail
          jobs={allJobs}
          activeJobId={activeJob?.id || null}
          onSelectJob={onSelectJob}
        />
      </div>
    </div>
  )
}
