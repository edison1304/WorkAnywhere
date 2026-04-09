import { useState, useEffect } from 'react'
import type { Task, Phase, ConnectionConfig, AppConfig } from '../../../shared/types'
import { SessionTerminal } from '../terminal/SessionTerminal'
import { FolderBrowser } from '../project/FolderBrowser'
import styles from './MainPanel.module.css'

interface Props {
  activeTask: Task | null
  activePhase: Phase | null
  sshConnected?: boolean
  sshConnecting?: boolean
  sshError?: string
  onRunAgent?: (taskId: string) => void
  onStopAgent?: (taskId: string) => void
  onSSHConnect?: (config: ConnectionConfig, appConfig?: AppConfig) => void
  onOpenSSH?: () => void
  onCreateProject?: (name: string, path: string) => void
  onCreatePhase?: (name: string, description: string) => void
  onCreateTask?: (name: string, prompt: string) => void
  hasProjects?: boolean
  hasPhases?: boolean
  activeProjectName?: string
}

export function MainPanel({
  activeTask, activePhase, sshConnected, sshConnecting, sshError,
  onRunAgent, onStopAgent, onSSHConnect, onOpenSSH,
  onCreateProject, onCreatePhase, onCreateTask,
  hasProjects, hasPhases, activeProjectName
}: Props) {
  const [activeTab, setActiveTab] = useState<'log' | 'terminal' | 'artifacts'>('log')

  // No task selected → show welcome / SSH connect / create flow
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
          ) : !hasProjects ? (
            <CreateProjectForm onSubmit={onCreateProject} />
          ) : !hasPhases ? (
            <CreatePhaseForm projectName={activeProjectName} onSubmit={onCreatePhase} />
          ) : (
            <CreateTaskForm onSubmit={onCreateTask} />
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
  onConnect?: (config: ConnectionConfig, appConfig?: AppConfig) => void
  connecting?: boolean
  error?: string
}) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<'key' | 'password' | 'agent'>('password');
  const [keyPath, setKeyPath] = useState('~/.ssh/id_rsa');
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [claudeCommand, setClaudeCommand] = useState('');
  const [claudeArgs, setClaudeArgs] = useState('');
  const [claudeSetup, setClaudeSetup] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    if (configLoaded || !window.api) return
    setConfigLoaded(true)
    window.api.configLoad().then(result => {
      if (result.success && result.config) {
        const c = result.config
        if (c.host) setHost(c.host)
        if (c.port) setPort(String(c.port))
        if (c.username) setUsername(c.username)
        if (c.authMethod) setAuthMethod(c.authMethod)
        if (c.keyPath) setKeyPath(c.keyPath)
        if (c.claudeCommand) { setClaudeCommand(c.claudeCommand); setShowAdvanced(true) }
        if (c.claudeArgs?.length) { setClaudeArgs(c.claudeArgs.join(' ')); setShowAdvanced(true) }
        if (c.claudeSetupScript) { setClaudeSetup(c.claudeSetupScript); setShowAdvanced(true) }
      }
    })
  }, [configLoaded]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Save config first (without password), including claude settings
    if (window.api) {
      window.api.configSave({
        host, port: parseInt(port), username, authMethod,
        keyPath: authMethod === 'key' ? keyPath : undefined,
        ...(claudeCommand ? { claudeCommand } : {}),
        ...(claudeArgs ? { claudeArgs: claudeArgs.split(/\s+/).filter(Boolean) } : {}),
        ...(claudeSetup ? { claudeSetupScript: claudeSetup } : {}),
      })
    }
    const appCfg: AppConfig = {
      host, port: parseInt(port), username, authMethod,
      keyPath: authMethod === 'key' ? keyPath : undefined,
      ...(claudeCommand ? { claudeCommand } : {}),
      ...(claudeArgs ? { claudeArgs: claudeArgs.split(/\s+/).filter(Boolean) } : {}),
      ...(claudeSetup ? { claudeSetupScript: claudeSetup } : {}),
    }
    onConnect?.({
      type: 'ssh',
      ssh: {
        host,
        port: parseInt(port),
        username,
        authMethod,
        keyPath: authMethod === 'key' ? keyPath : undefined,
        password: authMethod === 'password' ? password : undefined,
      }
    }, appCfg)
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
        {authMethod === 'password' && (
          <input
            className={styles.sshInput}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
          />
        )}
      </div>
      {/* Advanced: Claude execution settings */}
      <button
        type="button"
        className={styles.advancedToggleBtn}
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? '▾' : '▸'} Claude Settings (서버 실행 설정)
      </button>
      {showAdvanced && (
        <div className={styles.advancedSection}>
          <input
            className={styles.sshInput}
            value={claudeCommand}
            onChange={e => setClaudeCommand(e.target.value)}
            placeholder="Claude command (e.g. /home/yjlee/.local/bin/claude)"
          />
          <input
            className={styles.sshInput}
            value={claudeArgs}
            onChange={e => setClaudeArgs(e.target.value)}
            placeholder="Extra args (e.g. --remote-control --permission-mode bypassPermissions)"
          />
          <input
            className={styles.sshInput}
            value={claudeSetup}
            onChange={e => setClaudeSetup(e.target.value)}
            placeholder="Setup script (e.g. source ~/.bashrc)"
          />
          <button
            type="button"
            style={{ fontSize: 11, padding: '4px 8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => {
              setClaudeCommand('/home/yjlee/.local/bin/claude')
              setClaudeArgs('--remote-control --permission-mode bypassPermissions')
              setClaudeSetup('export PATH="$HOME/.local/bin:$PATH"')
            }}
          >
            CentOS 7 프리셋 적용 (glibc wrapper + remote-control)
          </button>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            OS 호환성 문제가 있으면 커스텀 설정하거나 프리셋을 적용하세요.
            설정은 config에 저장됩니다.
          </p>
        </div>
      )}
      {error && <div className={styles.sshError}>{error}</div>}
      <button type="submit" className={styles.sshConnectBtn} disabled={connecting || !host || !username}>
        {connecting ? 'Connecting...' : 'Connect SSH'}
      </button>
    </form>
  )
}

// ─── Create Project Form ───
function CreateProjectForm({ onSubmit }: { onSubmit?: (name: string, path: string, engine?: string) => void }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [engine, setEngine] = useState<'claude' | 'opencode'>('claude')
  const [showBrowser, setShowBrowser] = useState(false)

  if (showBrowser) {
    return (
      <FolderBrowser
        onSelect={(selectedPath) => {
          setPath(selectedPath)
          // Auto-fill project name from folder name
          if (!name) {
            const folderName = selectedPath.split('/').pop() || ''
            setName(folderName)
          }
          setShowBrowser(false)
        }}
        onCancel={() => setShowBrowser(false)}
      />
    )
  }

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(name, path, engine) }} className={styles.sshForm}>
      <p className={styles.sshFormTitle}>
        <span style={{ color: 'var(--success)' }}>● Connected</span>
        {' — '}Create a project
      </p>
      <input
        className={styles.sshInput}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Project name (e.g. ACE-2 개발)"
        required
      />
      <div className={styles.sshRow}>
        <input
          className={styles.sshInput}
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="Workspace path on server"
          required
        />
        <button type="button" className={styles.browseBtn} onClick={() => setShowBrowser(true)}>
          Browse
        </button>
      </div>
      {/* Agent engine selection */}
      <div className={styles.engineRow}>
        <button
          type="button"
          className={`${styles.engineBtn} ${engine === 'claude' ? styles.engineActive : ''}`}
          onClick={() => setEngine('claude')}
        >
          Claude Code
        </button>
        <button
          type="button"
          className={`${styles.engineBtn} ${engine === 'opencode' ? styles.engineActive : ''}`}
          onClick={() => setEngine('opencode')}
        >
          OpenCode
        </button>
      </div>
      <button type="submit" className={styles.sshConnectBtn} disabled={!name || !path}>
        Create Project
      </button>
    </form>
  )
}

// ─── Create Phase Form ───
function CreatePhaseForm({ projectName, onSubmit }: { projectName?: string; onSubmit?: (name: string, desc: string) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(name, desc) }} className={styles.sshForm}>
      <p className={styles.sshFormTitle}>
        {projectName && <span style={{ color: 'var(--accent)' }}>{projectName}</span>}
        {' — '}Add a phase
      </p>
      <input
        className={styles.sshInput}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Phase name (e.g. AOD 민감도 실험)"
        required
      />
      <input
        className={styles.sshInput}
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="Description (optional)"
      />
      <button type="submit" className={styles.sshConnectBtn} disabled={!name}>
        Create Phase
      </button>
    </form>
  )
}

// ─── Create Task Form ───
function CreateTaskForm({ onSubmit }: { onSubmit?: (name: string, prompt: string) => void }) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(name, prompt) }} className={styles.sshForm}>
      <p className={styles.sshFormTitle}>Add a task</p>
      <input
        className={styles.sshInput}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Task name (e.g. 데이터셋 전처리)"
        required
      />
      <textarea
        className={styles.sshTextarea}
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Prompt for Claude agent (e.g. ERA5 데이터를 전처리하고...)"
        rows={4}
        required
      />
      <button type="submit" className={styles.sshConnectBtn} disabled={!name || !prompt}>
        Create Task
      </button>
    </form>
  )
}
