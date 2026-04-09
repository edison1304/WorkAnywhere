import { useState } from 'react'
import type { Task, Phase } from '../../../shared/types'
import styles from './MainPanel.module.css'

interface Props {
  activeTask: Task | null
  activePhase: Phase | null
}

export function MainPanel({ activeTask, activePhase }: Props) {
  const [activeTab, setActiveTab] = useState<'log' | 'artifacts'>('log')

  if (!activeTask) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>W</div>
          <h2 className={styles.emptyTitle}>Workanywhere</h2>
          <p className={styles.emptyText}>
            Select a task to view its logs and artifacts,<br />
            or create a new task to start an agent.
          </p>
        </div>
      </div>
    )
  }

  const isRunning = activeTask.status === 'running'
  const isWaiting = activeTask.status === 'waiting'
  const isIdle = activeTask.status === 'idle'
  const isDone = activeTask.status === 'completed' || activeTask.status === 'failed'

  return (
    <div className={styles.panel}>
      {/* Task header */}
      <div className={styles.taskHeader}>
        <div className={styles.taskHeaderLeft}>
          {activePhase && <span className={styles.phaseLabel}>{activePhase.name}</span>}
          <h2 className={styles.taskTitle}>{activeTask.name}</h2>
          <span className={styles.taskPrompt}>{activeTask.prompt}</span>
        </div>
        <div className={styles.taskActions}>
          {isIdle && (
            <button className={styles.actionBtn} data-variant="primary">Run Agent</button>
          )}
          {isWaiting && (
            <button className={styles.actionBtn} data-variant="primary">Send</button>
          )}
          {(isRunning || isWaiting) && (
            <button className={styles.actionBtn} data-variant="danger">Stop</button>
          )}
          {isDone && (
            <button className={styles.actionBtn}>Re-run</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${activeTab === 'log' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('log')}
        >
          Log
          {activeTask.logs.length > 0 && (
            <span className={styles.tabBadge}>{activeTask.logs.length}</span>
          )}
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'artifacts' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('artifacts')}
        >
          Artifacts
          {activeTask.artifacts.length > 0 && (
            <span className={styles.tabBadge}>{activeTask.artifacts.length}</span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {activeTab === 'log' ? (
          <LogView task={activeTask} />
        ) : (
          <ArtifactsView task={activeTask} />
        )}
      </div>
    </div>
  )
}

function LogView({ task }: { task: Task }) {
  if (task.logs.length === 0) {
    return (
      <div className={styles.emptyContent}>
        <p>No logs yet. Click "Run Agent" to start.</p>
      </div>
    )
  }

  return (
    <div className={styles.logList}>
      {task.logs.map(log => (
        <div key={log.id} className={styles.logEntry} data-type={log.type}>
          <span className={styles.logTime}>
            {new Date(log.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <span className={styles.logIcon}>
            {log.type === 'agent_start' ? '▶' :
             log.type === 'agent_end' ? '■' :
             log.type === 'tool_call' ? '⚡' :
             log.type === 'error' ? '✕' : '·'}
          </span>
          <div className={styles.logContent}>
            <span>{log.content}</span>
            {log.meta?.tool && (
              <span className={styles.logMeta}>{log.meta.tool}</span>
            )}
            {log.meta?.duration !== undefined && log.meta.duration > 0 && (
              <span className={styles.logDuration}>{(log.meta.duration / 1000).toFixed(1)}s</span>
            )}
          </div>
        </div>
      ))}
      {task.status === 'running' && (
        <div className={styles.logEntry} data-type="running">
          <span className={styles.logTime}></span>
          <span className={styles.logIcon}>
            <span className={styles.spinner} />
          </span>
          <span className={styles.logContent}>Agent working...</span>
        </div>
      )}
    </div>
  )
}

function ArtifactsView({ task }: { task: Task }) {
  if (task.artifacts.length === 0) {
    return (
      <div className={styles.emptyContent}>
        <p>No artifacts detected yet.</p>
      </div>
    )
  }

  return (
    <div className={styles.artifactList}>
      {task.artifacts.map(a => (
        <div key={a.id} className={styles.artifactItem}>
          <span>{a.filePath}</span>
          <span className={styles.artifactType}>{a.type}</span>
        </div>
      ))}
    </div>
  )
}
