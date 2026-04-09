import { useState } from 'react'
import type { Task, Phase, ConnectionConfig } from '../../../shared/types'
import { SessionTerminal } from '../terminal/SessionTerminal'
import styles from './MainPanel.module.css'

interface Props {
  activeTask: Task | null
  activePhase: Phase | null
  sshConnected?: boolean
  sshConnecting?: boolean
  sshError?: string
  onRunAgent?: (taskId: string) => void
  onStopAgent?: (taskId: string) => void
  onSSHConnect?: (config: ConnectionConfig) => void
  onOpenSSH?: () => void
}

export function MainPanel({ activeTask, activePhase, sshConnected, sshConnecting, sshError, onRunAgent, onStopAgent, onSSHConnect, onOpenSSH }: Props) {
  const [activeTab, setActiveTab] = useState<'log' | 'terminal' | 'artifacts'>('log')

  // No task selected → show welcome + SSH connect if needed
  if (!activeTask) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>W</div>
          <h2 className={styles.emptyTitle}>Workanywhere</h2>

          {!sshConnected ? (
            <SSHInlineConnect
              onConnect={onSSHConnect}
              connecting={sshConnecting}
              error={sshError}
            />
          ) : (
            <p className={styles.emptyText}>
              <span style={{ color: 'var(--success)' }}>● SSH Connected</span><br />
              Select a task to view its logs and artifacts,<br />
              or create a new task to start an agent.
            </p>
          )}
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
            <button
              className={styles.actionBtn}
              data-variant="primary"
              onClick={() => sshConnected ? onRunAgent?.(activeTask.id) : onOpenSSH?.()}
            >
              {sshConnected ? 'Run Agent' : 'Connect SSH'}
            </button>
          )}
          {isWaiting && (
            <button className={styles.actionBtn} data-variant="primary">Send</button>
          )}
          {(isRunning || isWaiting) && (
            <button
              className={styles.actionBtn}
              data-variant="danger"
              onClick={() => onStopAgent?.(activeTask.id)}
            >
              Stop
            </button>
          )}
          {isDone && (
            <button
              className={styles.actionBtn}
              onClick={() => onRunAgent?.(activeTask.id)}
            >
              Re-run
            </button>
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
          className={`${styles.tab} ${activeTab === 'terminal' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('terminal')}
        >
          Terminal
          {isRunning && <span className={styles.tabLive}>LIVE</span>}
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
        {activeTab === 'log' && <LogView task={activeTask} />}
        {activeTab === 'terminal' && (
          <SessionTerminal taskId={activeTask.id} isActive={activeTab === 'terminal'} />
        )}
        {activeTab === 'artifacts' && <ArtifactsView task={activeTask} />}
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

// ─── Inline SSH Connect Form (shown in main panel when not connected) ───
function SSHInlineConnect({ onConnect, connecting, error }: {
  onConnect?: (config: ConnectionConfig) => void
  connecting?: boolean
  error?: string
}) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<'key' | 'password' | 'agent'>('key');
  const [keyPath, setKeyPath] = useState('~/.ssh/id_rsa');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onConnect?.({
      type: 'ssh',
      ssh: {
        host,
        port: parseInt(port),
        username,
        authMethod,
        keyPath: authMethod === 'key' ? keyPath : undefined,
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.sshForm}>
      <p className={styles.sshFormTitle}>Connect to server via SSH</p>
      <div className={styles.sshRow}>
        <input
          className={styles.sshInput}
          value={host}
          onChange={e => setHost(e.target.value)}
          placeholder="Host (e.g. 10.0.0.1)"
          required
        />
        <input
          className={styles.sshInputSmall}
          value={port}
          onChange={e => setPort(e.target.value)}
          placeholder="Port"
          type="number"
        />
      </div>
      <input
        className={styles.sshInput}
        value={username}
        onChange={e => setUsername(e.target.value)}
        placeholder="Username"
        required
      />
      <div className={styles.sshRow}>
        <select
          className={styles.sshSelect}
          value={authMethod}
          onChange={e => setAuthMethod(e.target.value as any)}
        >
          <option value="key">SSH Key</option>
          <option value="password">Password</option>
          <option value="agent">SSH Agent</option>
        </select>
        {authMethod === 'key' && (
          <input
            className={styles.sshInput}
            value={keyPath}
            onChange={e => setKeyPath(e.target.value)}
            placeholder="Key path"
          />
        )}
      </div>
      {error && <div className={styles.sshError}>{error}</div>}
      <button type="submit" className={styles.sshConnectBtn} disabled={connecting || !host || !username}>
        {connecting ? 'Connecting...' : 'Connect SSH'}
      </button>
    </form>
  )
}
