import type { Project, Phase, Task } from '../../../shared/types'
import { StatusDot } from '../job/StatusDot'
import styles from './ProjectSidebar.module.css'

interface Props {
  projects: Project[]
  activeProjectId: string | null
  phases: Phase[]
  activePhaseId: string | null
  tasks: Task[]
  activeTaskId: string | null
  onSelectProject: (id: string) => void
  onSelectPhase: (id: string) => void
  onSelectTask: (id: string | null) => void
}

const PHASE_STATUS_ICON: Record<string, string> = {
  active: '▶',
  paused: '⏸',
  completed: '✓',
}

export function ProjectSidebar({
  projects, activeProjectId, phases, activePhaseId, tasks, activeTaskId,
  onSelectProject, onSelectPhase, onSelectTask
}: Props) {
  return (
    <div className={styles.sidebar}>
      {/* 대분류: Projects */}
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

      {/* 중분류: Phases */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Phases</div>
        {phases.map(ph => (
          <button
            key={ph.id}
            className={`${styles.phaseItem} ${ph.id === activePhaseId ? styles.active : ''}`}
            onClick={() => onSelectPhase(ph.id)}
          >
            <span className={styles.phaseStatusIcon} data-status={ph.status}>
              {PHASE_STATUS_ICON[ph.status]}
            </span>
            <div className={styles.phaseInfo}>
              <span className={styles.phaseName}>{ph.name}</span>
              {ph.description && (
                <span className={styles.phaseDesc}>{ph.description}</span>
              )}
            </div>
          </button>
        ))}
        <button className={styles.addButton}>+ New Phase</button>
      </div>

      {/* 소분류: Tasks */}
      <div className={styles.section} style={{ flex: 1 }}>
        <div className={styles.sectionTitle}>
          Tasks
          {activePhaseId && <span className={styles.taskCount}>{tasks.length}</span>}
        </div>
        <div className={styles.taskList}>
          {tasks.map(t => (
            <button
              key={t.id}
              className={`${styles.taskItem} ${t.id === activeTaskId ? styles.active : ''}`}
              onClick={() => onSelectTask(t.id)}
            >
              <StatusDot status={t.status} />
              <div className={styles.taskInfo}>
                <span className={styles.taskName}>{t.name}</span>
                <span className={styles.taskStatus}>
                  {t.status}
                  {t.logs.length > 0 && ` · ${t.logs.length} logs`}
                </span>
              </div>
            </button>
          ))}
        </div>
        <button className={styles.addButton}>+ New Task</button>
      </div>
    </div>
  )
}
