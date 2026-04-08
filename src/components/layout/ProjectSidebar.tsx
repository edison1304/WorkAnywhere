import type { Project, Job } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './ProjectSidebar.module.css'

interface Props {
  projects: Project[]
  activeProjectId: string | null
  jobs: Job[]
  activeJobId: string | null
  onSelectProject: (id: string) => void
  onSelectJob: (id: string | null) => void
}

export function ProjectSidebar({
  projects, activeProjectId, jobs, activeJobId,
  onSelectProject, onSelectJob
}: Props) {
  return (
    <div className={styles.sidebar}>
      {/* Project selector */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Projects</div>
        {projects.map(p => (
          <button
            key={p.id}
            className={`${styles.projectItem} ${p.id === activeProjectId ? styles.active : ''}`}
            onClick={() => onSelectProject(p.id)}
          >
            <span className={styles.projectIcon}>
              {p.connection.type === 'ssh' ? '🖥' : '💻'}
            </span>
            <span className={styles.projectName}>{p.name}</span>
          </button>
        ))}
        <button className={styles.addButton}>+ New Project</button>
      </div>

      {/* Jobs for active project */}
      <div className={styles.section} style={{ flex: 1 }}>
        <div className={styles.sectionTitle}>Jobs</div>
        <div className={styles.jobList}>
          {jobs.map(j => (
            <button
              key={j.id}
              className={`${styles.jobItem} ${j.id === activeJobId ? styles.active : ''}`}
              onClick={() => onSelectJob(j.id)}
            >
              <StatusDot status={j.status} />
              <div className={styles.jobInfo}>
                <span className={styles.jobName}>{j.name}</span>
                <span className={styles.jobStatus}>{j.status}</span>
              </div>
            </button>
          ))}
        </div>
        <button className={styles.addButton}>+ New Job</button>
      </div>
    </div>
  )
}
