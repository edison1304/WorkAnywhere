import { useState, useEffect, useRef, useMemo } from 'react'
import type { Task, Phase, ConnectionConfig, AppConfig, Artifact } from '../../../shared/types'
import { SessionTerminal } from '../terminal/SessionTerminal'
import { ShellTerminal } from '../terminal/ShellTerminal'
import { FolderBrowser } from '../project/FolderBrowser'
import { ArtifactViewer } from '../viewer/ArtifactViewer'
import { HierarchyView } from '../sessions/HierarchyView'
import { IntentLockHeader } from './IntentLockHeader'
import styles from './MainPanel.module.css'

// ─── Session Drift Detection ───
interface DriftInfo {
  level: 'ok' | 'warning' | 'critical'
  score: number           // 0~100
  reason: string
  elapsedMin: number
  logCount: number
  toolCalls: number
  estimatedTokensK: number  // in thousands
}

function calcDrift(task: Task): DriftInfo {
  const logs = task.logs
  const logCount = logs.length
  const toolCalls = logs.filter(l => l.type === 'tool_call').length

  // Estimate CONTEXT tokens from log output.
  // Log chars → tokens: ~3 chars/token (conservative; Korean uses ~1.5 chars/token)
  // Actual context ≈ 2~3x logged output (includes system prompt, tool schemas,
  // all conversation history, tool inputs — not just the output we see)
  const totalChars = logs.reduce((sum, l) => sum + l.content.length, 0)
  const logTokensK = Math.round(totalChars / 3 / 1000)
  const estimatedTokensK = logTokensK * 2.5  // approximate full context multiplier

  const firstLog = logs[0]
  const elapsedMs = firstLog ? Date.now() - new Date(firstLog.timestamp).getTime() : 0
  const elapsedMin = Math.round(elapsedMs / 60000)

  // Claude context window is ~200K tokens.
  // Quality degrades well before the limit (~60% usage).
  // Score based on estimated full context usage:
  //   Warning at 40% (~80K actual context)
  //   Critical at 70% (~140K actual context)
  const score = Math.round(Math.min(100, (estimatedTokensK / 200) * 100))

  let level: DriftInfo['level'] = 'ok'
  let reason = ''

  if (score >= 70) {
    level = 'critical'
    reason = `~${estimatedTokensK}K tokens used`
  } else if (score >= 40) {
    level = 'warning'
    reason = `~${estimatedTokensK}K tokens used`
  }

  return { level, score, reason, elapsedMin, logCount, toolCalls, estimatedTokensK }
}

interface Props {
  activeTask: Task | null
  activePhase: Phase | null
  sshConnected?: boolean
  sshConnecting?: boolean
  sshError?: string
  onRunAgent?: (taskId: string) => void
  onStopAgent?: (taskId: string) => void
  onResumeAgent?: (taskId: string) => void
  onMarkCompleted?: (taskId: string) => void
  onSummarize?: (taskId: string) => void
  onRestartFresh?: (taskId: string) => void
  onSendMessage?: (taskId: string, message: string) => void
  onSSHConnect?: (config: ConnectionConfig, appConfig?: AppConfig) => void
  onLocalConnect?: () => void
  onRemoteConnect?: (remoteLink: string) => void
  onOpenSSH?: () => void
  onCreateProject?: (name: string, path: string, engine?: string) => void
  onCreatePhase?: (name: string, description: string) => void
  onCreateTask?: (name: string, purpose: string, prompt: string) => void
  hasProjects?: boolean
  hasPhases?: boolean
  activeProjectName?: string
  workspacePath?: string
  showCreateProject?: boolean
  onCancelCreateProject?: () => void
  openFilePath?: string | null
  onOpenFile?: (filePath: string) => void
  // ─── Hierarchy view (when no task is selected) ───
  allProjectTasks?: Task[]
  projectPhases?: Phase[]
  allProjects?: import('../../../shared/types').Project[]
  activeProjectId?: string | null
  onSelectTask?: (taskId: string) => void
  onApproveTask?: (taskId: string) => void
  // ─── Inline approval card in chat ───
  pendingPermission?: { id: string; text: string; format: 'numbered' | 'yn' } | null
  onRespondPermission?: (taskId: string, approved: boolean) => void
  // ─── Generic task patch (used by IntentLockHeader inline editor) ───
  onUpdateTask?: (taskId: string, patch: Partial<Task>) => void
}

export function MainPanel({
  activeTask, activePhase, sshConnected, sshConnecting, sshError, workspacePath,
  onRunAgent, onStopAgent, onResumeAgent, onMarkCompleted, onSummarize, onRestartFresh, onSendMessage, onSSHConnect, onLocalConnect, onRemoteConnect, onOpenSSH,
  onCreateProject, onCreatePhase, onCreateTask,
  hasProjects, hasPhases, activeProjectName,
  showCreateProject, onCancelCreateProject,
  openFilePath, onOpenFile,
  allProjectTasks, projectPhases, allProjects, activeProjectId, onSelectTask, onApproveTask,
  pendingPermission, onRespondPermission,
  onUpdateTask,
}: Props) {
  const [activeTab, setActiveTab] = useState<'log' | 'terminal' | 'artifacts'>('terminal')

  // All hooks MUST be before any conditional return (React hooks rule)
  const drift = useMemo(
    () => activeTask ? calcDrift(activeTask) : { level: 'ok' as const, score: 0, reason: '', elapsedMin: 0, logCount: 0, toolCalls: 0, estimatedTokensK: 0 },
    [activeTask?.logs?.length, activeTask?.createdAt]
  )
  const [dragOver, setDragOver] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)

  // File viewer — when a file is opened from the file tree
  if (openFilePath && !showCreateProject) {
    const fileName = openFilePath.split('/').pop() || openFilePath
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    const artifactType = (() => {
      if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext)) return 'image'
      if (ext === 'pdf') return 'pdf'
      if (['md', 'markdown'].includes(ext)) return 'markdown'
      if (['json'].includes(ext)) return 'json'
      if (['yaml', 'yml'].includes(ext)) return 'yaml'
      if (['txt', 'log', 'csv'].includes(ext)) return 'text'
      return 'code'
    })() as import('../../shared/types').ArtifactType
    return (
      <div className={styles.panel}>
        <div className={styles.fileViewerHeader}>
          <span className={styles.fileViewerPath}>{openFilePath}</span>
        </div>
        <div className={styles.fileViewerBody}>
          <ArtifactViewer
            key={openFilePath}
            artifact={{ id: 'file-view', taskId: '', filePath: openFilePath, type: artifactType, action: 'created', detectedAt: '' }}
            workspacePath=""
          />
        </div>
      </div>
    )
  }

  // Show create project form when requested (from sidebar button or initial flow)
  if (showCreateProject || !activeTask) {
    // If explicitly creating project, show project form regardless of other state
    const showProjectForm = showCreateProject || (sshConnected && !hasProjects)

    // Hierarchy view: connected + has projects + has phases + has tasks + not creating
    // → tree of Project ▸ Phase ▸ Task with progress bars + health colors,
    //   instead of yet-another create form.
    const hasTasks = (allProjectTasks?.length ?? 0) > 0
    if (
      !showCreateProject &&
      sshConnected && hasProjects && hasPhases && hasTasks &&
      onSelectTask
    ) {
      return (
        <HierarchyView
          projects={allProjects ?? []}
          phases={projectPhases ?? []}
          tasks={allProjectTasks!}
          activeProjectId={activeProjectId ?? null}
          onSelectTask={onSelectTask}
          onRunAgent={onRunAgent}
          onApprove={onApproveTask}
        />
      )
    }

    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          {!showCreateProject && (
            <>
              <div className={styles.emptyIcon}>W</div>
              <h2 className={styles.emptyTitle}>Workanywhere</h2>
            </>
          )}

          {!sshConnected && !showCreateProject ? (
            <>
              <SSHInlineConnect
                onConnect={onSSHConnect}
                connecting={sshConnecting}
                error={sshError}
              />
              <div className={styles.altConnectRow}>
                <button
                  className={styles.localConnectBtn}
                  onClick={onLocalConnect}
                  disabled={sshConnecting}
                >
                  Local Mode
                </button>
                <RemoteConnectInline
                  onConnect={onRemoteConnect}
                  disabled={sshConnecting}
                />
              </div>
            </>
          ) : showProjectForm ? (
            <CreateProjectForm
              onSubmit={(name, path, engine) => {
                onCreateProject?.(name, path, engine)
                onCancelCreateProject?.()
              }}
              onCancel={showCreateProject ? onCancelCreateProject : undefined}
            />
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
  const isReview = activeTask.status === 'review'
  const isDone = activeTask.status === 'completed' || activeTask.status === 'failed'

  const handlePanelUpload = async (file: File) => {
    if (!window.api || !workspacePath) return
    setUploadStatus(`Uploading ${file.name}...`)
    try {
      const arrayBuf = await file.arrayBuffer()
      const data = Array.from(new Uint8Array(arrayBuf))
      const result = await window.api.sshUploadFile({
        fileName: file.name,
        data,
        workspacePath,
      })
      if (result.success && result.remotePath) {
        // Copy path to clipboard and show toast
        navigator.clipboard?.writeText(result.remotePath).catch(() => {})
        setUploadStatus(`Uploaded: ${result.remotePath}`)
        setTimeout(() => setUploadStatus(null), 4000)
        return result.remotePath
      } else {
        setUploadStatus('Upload failed')
        setTimeout(() => setUploadStatus(null), 3000)
      }
    } catch {
      setUploadStatus('Upload failed')
      setTimeout(() => setUploadStatus(null), 3000)
    }
    return undefined
  }

  const handlePanelDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (!files?.length) return
    for (const file of files) {
      await handlePanelUpload(file)
    }
  }

  const handlePanelPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file') {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await handlePanelUpload(file)
        return
      }
    }
  }

  return (
    <div
      className={`${styles.panel} ${dragOver ? styles.panelDragOver : ''}`}
      onDrop={handlePanelDrop}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onPaste={handlePanelPaste}
      tabIndex={0}
    >
      {/* Upload toast */}
      {uploadStatus && (
        <div className={styles.uploadToast}>{uploadStatus}</div>
      )}

      {/* Drop overlay */}
      {dragOver && (
        <div className={styles.dropOverlay}>
          <span>Drop files to upload to server</span>
        </div>
      )}

      {/* Task header */}
      <div className={styles.taskHeader}>
        <div className={styles.taskHeaderLeft}>
          {activePhase && <span className={styles.phaseLabel}>{activePhase.name}</span>}
          <div className={styles.taskTitleRow}>
            <h2 className={styles.taskTitle}>{activeTask.name}</h2>
            {drift.level !== 'ok' && (
              <span
                className={styles.driftBadge}
                data-level={drift.level}
                title={`Context usage: ${drift.score}% — ~${Math.round(drift.estimatedTokensK)}K estimated tokens\n(logged output × 2.5 multiplier for full context)\n${drift.toolCalls} tool calls, ${drift.elapsedMin}min elapsed`}
              >
                {drift.level === 'critical' ? 'RESTART' : 'DRIFT'}
                <span className={styles.driftScore}>{drift.score}%</span>
              </span>
            )}
          </div>
          <span className={styles.taskPrompt}>{activeTask.prompt}</span>
          {/* Drift gauge — always visible when task has logs */}
          {activeTask.logs.length > 0 && (
            <div className={styles.driftGauge}>
              <div
                className={styles.driftGaugeFill}
                data-level={drift.level}
                style={{ width: `${Math.min(100, drift.score)}%` }}
              />
              <span className={styles.driftGaugeLabel}>
                ~{Math.round(drift.estimatedTokensK)}K / 200K context
              </span>
            </div>
          )}
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
              data-variant={drift.level !== 'ok' ? 'primary' : undefined}
              onClick={() => onRestartFresh?.(activeTask.id)}
              title="Summarize current progress, stop, and start a fresh session"
            >
              Restart Fresh
            </button>
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
          {isReview && (
            <button
              className={styles.actionBtn}
              data-variant="primary"
              onClick={() => onMarkCompleted?.(activeTask.id)}
            >
              Approve
            </button>
          )}
          {(isReview || isDone) && activeTask.logs.length > 0 && (
            <button
              className={styles.actionBtn}
              onClick={() => onSummarize?.(activeTask.id)}
            >
              Summarize
            </button>
          )}
          {(isReview || isDone) && activeTask.sessionId && (
            <button
              className={styles.actionBtn}
              onClick={() => onResumeAgent?.(activeTask.id)}
            >
              Resume
            </button>
          )}
          {(isReview || isDone) && (
            <button
              className={styles.actionBtn}
              onClick={() => onRunAgent?.(activeTask.id)}
            >
              Re-run
            </button>
          )}
        </div>
      </div>

      {/* Intent Lock — 본목적 고정 영역 (§10) */}
      <IntentLockHeader task={activeTask} onUpdate={onUpdateTask} />

      {/* Summary panel (when available) */}
      {activeTask.summary && (
        <div className={styles.summaryPanel}>
          <div className={styles.summaryProgress}>{activeTask.summary.progress}</div>
          <div className={styles.summaryGrid}>
            {activeTask.summary.completedSteps.length > 0 && (
              <div className={styles.summarySection}>
                <span className={styles.summarySectionTitle}>Done</span>
                {activeTask.summary.completedSteps.map((s, i) => (
                  <span key={i} className={styles.summaryItem} data-type="done">{s}</span>
                ))}
              </div>
            )}
            {activeTask.summary.currentStep && (
              <div className={styles.summarySection}>
                <span className={styles.summarySectionTitle}>Current</span>
                <span className={styles.summaryItem} data-type="current">{activeTask.summary.currentStep}</span>
              </div>
            )}
            {activeTask.summary.nextSteps.length > 0 && (
              <div className={styles.summarySection}>
                <span className={styles.summarySectionTitle}>Next</span>
                {activeTask.summary.nextSteps.map((s, i) => (
                  <span key={i} className={styles.summaryItem} data-type="next">{s}</span>
                ))}
              </div>
            )}
            {activeTask.summary.issues.length > 0 && (
              <div className={styles.summarySection}>
                <span className={styles.summarySectionTitle}>Issues</span>
                {activeTask.summary.issues.map((s, i) => (
                  <span key={i} className={styles.summaryItem} data-type="issue">{s}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${activeTab === 'log' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('log')}
        >
          Chat
          {(isRunning || isWaiting) && <span className={styles.tabLive}>LIVE</span>}
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'terminal' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('terminal')}
        >
          Terminal
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
        <div style={{ display: activeTab === 'log' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ChatView
            task={activeTask}
            pendingPermission={pendingPermission ?? null}
            onRespondPermission={onRespondPermission}
          />
        </div>
        <div style={{ display: activeTab === 'terminal' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ShellTerminal projectId={activeTask.projectId} />
        </div>
        <div style={{ display: activeTab === 'artifacts' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ArtifactsView task={activeTask} workspacePath={workspacePath} />
        </div>
      </div>

      {/* Chat input — always enabled */}
      <ChatInput
        onSend={(msg) => onSendMessage?.(activeTask.id, msg)}
        disabled={false}
        workspacePath={workspacePath}
      />
    </div>
  )
}

// Inline markdown → HTML for chat messages
function renderMarkdownInline(text: string): string {
  return text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="chatCodeBlock"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="chatInlineCode">$1</code>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers (## → bold)
    .replace(/^###?\s+(.+)$/gm, '<strong>$1</strong>')
    // Bullet lists
    .replace(/^[-•]\s+(.+)$/gm, '<span class="chatListItem">$1</span>')
    // Numbered lists
    .replace(/^\d+\.\s+(.+)$/gm, '<span class="chatListItem">$1</span>')
    // Line breaks
    .replace(/\n/g, '<br />')
}

function ChatView({ task, pendingPermission, onRespondPermission }: {
  task: Task
  pendingPermission: { id: string; text: string; format: 'numbered' | 'yn' } | null
  onRespondPermission?: (taskId: string, approved: boolean) => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [task.logs.length, pendingPermission?.id])

  if (task.logs.length === 0) {
    return (
      <div className={styles.emptyContent}>
        <p>Click "Run Agent" to start.</p>
      </div>
    )
  }

  // Group consecutive logs into messages. Identity (you / claude) is carried
  // by alignment + subtle background — no avatars, no sender labels.
  type Msg = { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; time: string; tool?: string }
  const messages: Msg[] = []

  for (const log of task.logs) {
    const time = new Date(log.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

    if (log.content.startsWith('[YOU] ') || log.content.startsWith('[QUEUED] ')) {
      const text = log.content.replace(/^\[(YOU|QUEUED)\]\s*/, '')
      messages.push({ role: 'user', content: text, time })
    } else if (log.type === 'tool_call') {
      const last = messages[messages.length - 1]
      if (last?.role === 'tool') {
        last.content += `\n${log.meta?.tool || 'tool'}: ${log.content.slice(0, 120)}`
      } else {
        messages.push({ role: 'tool', content: `${log.meta?.tool || 'tool'}: ${log.content.slice(0, 120)}`, time, tool: log.meta?.tool })
      }
    } else if (log.type === 'agent_start' || log.type === 'agent_end') {
      messages.push({ role: 'system', content: log.content, time })
    } else if (log.type === 'error') {
      messages.push({ role: 'system', content: log.content, time })
    } else if (log.type === 'text') {
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant') {
        last.content += '\n' + log.content
      } else {
        messages.push({ role: 'assistant', content: log.content, time })
      }
    }
  }

  return (
    <div className={styles.chatMessages}>
      {messages.map((msg, i) => {
        if (msg.role === 'system') {
          return <div key={i} className={styles.chatSystemRow} title={msg.time}>{msg.content}</div>
        }
        if (msg.role === 'tool') {
          return (
            <div key={i} className={styles.chatToolRow} title={msg.time}>
              <span className={styles.chatToolMark}>↳</span>
              <span className={styles.chatToolLabel}>{msg.tool || 'tool'}</span>
              <span className={styles.chatToolDetail}>{msg.content.replace(/^[^:]+:\s*/, '')}</span>
            </div>
          )
        }
        if (msg.role === 'user') {
          return (
            <div key={i} className={styles.chatRow} data-role="user" title={msg.time}>
              <div className={styles.chatUserBubble}>{msg.content}</div>
            </div>
          )
        }
        return (
          <div key={i} className={styles.chatRow} data-role="assistant" title={msg.time}>
            <div
              className={styles.chatAssistantText}
              dangerouslySetInnerHTML={{ __html: renderMarkdownInline(msg.content) }}
            />
          </div>
        )
      })}
      {task.status === 'running' && !pendingPermission && (
        <div className={styles.chatRow} data-role="assistant">
          <div className={styles.chatTyping}><span /><span /><span /></div>
        </div>
      )}
      {pendingPermission && (
        <div className={styles.chatRow} data-role="assistant">
          <div className={styles.approvalCard}>
            <div className={styles.approvalHeader}>
              <span className={styles.approvalIcon}>⚠</span>
              <span className={styles.approvalTitle}>승인이 필요한 작업</span>
            </div>
            <pre className={styles.approvalText}>{pendingPermission.text}</pre>
            <div className={styles.approvalActions}>
              <button
                className={styles.approveBtn}
                onClick={() => onRespondPermission?.(task.id, true)}
              >
                수락
              </button>
              <button
                className={styles.denyBtn}
                onClick={() => onRespondPermission?.(task.id, false)}
              >
                거부
              </button>
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}

// ─── Chat Input ───
function ChatInput({ onSend, disabled, workspacePath }: {
  onSend: (msg: string) => void; disabled: boolean; workspacePath?: string
}) {
  const [message, setMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    if (disabled) return
    const msg = message.trim()
    if (!msg) return
    onSend(msg)
    setMessage('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const uploadFile = async (file: File) => {
    if (!window.api || !workspacePath) return
    setUploading(true)
    try {
      const arrayBuf = await file.arrayBuffer()
      const data = Array.from(new Uint8Array(arrayBuf))
      const result = await window.api.sshUploadFile({
        fileName: file.name,
        data,
        workspacePath,
      })
      if (result.success && result.remotePath) {
        // Insert file path into chat
        setMessage(prev => {
          const prefix = prev ? prev + ' ' : ''
          return prefix + result.remotePath
        })
        inputRef.current?.focus()
      }
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setUploading(false)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file') {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await uploadFile(file)
        return
      }
    }
    // text paste falls through normally
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer?.files
    if (!files?.length) return
    for (const file of files) {
      await uploadFile(file)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    for (const file of files) {
      await uploadFile(file)
    }
    e.target.value = ''
  }

  return (
    <div
      className={styles.chatInput}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        multiple
      />
      <button
        className={styles.chatFileBtn}
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title="Upload file to server"
      >
        {uploading ? '⏳' : '📎'}
      </button>
      <textarea
        ref={inputRef}
        className={styles.chatTextarea}
        value={message}
        onChange={e => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={uploading ? 'Uploading...' : disabled ? 'Drop/paste files to upload — agent not running' : 'Message (Enter to send) — Paste/drop files to upload'}
        rows={2}
        disabled={uploading}
      />
      <button
        className={styles.chatSendBtn}
        onClick={handleSubmit}
        disabled={disabled || uploading || !message.trim()}
      >
        Send
      </button>
    </div>
  )
}

function ArtifactsView({ task, workspacePath }: { task: Task; workspacePath?: string }) {
  const [selected, setSelected] = useState<Artifact | null>(null)

  // Reset selection when task changes
  useEffect(() => {
    setSelected(null)
  }, [task.id])

  if (task.artifacts.length === 0) {
    return (
      <div className={styles.emptyContent}>
        <p>No artifacts detected yet.</p>
      </div>
    )
  }

  const iconMap: Record<string, string> = {
    code: '>_', markdown: 'MD', yaml: 'YM', json: '{}',
    image: 'IMG', pdf: 'PDF', text: 'TXT', other: '...',
  }

  const actionLabel: Record<string, string> = {
    created: '+', modified: '~', deleted: '-',
  }

  return (
    <div className={styles.artifactSplit}>
      {/* File list */}
      <div className={styles.artifactFileList}>
        <div className={styles.artifactFileListHeader}>
          Files ({task.artifacts.length})
        </div>
        {task.artifacts.map(a => {
          const fileName = a.filePath.split('/').pop() || a.filePath
          const isActive = selected?.id === a.id
          return (
            <button
              key={a.id}
              className={`${styles.artifactFileItem} ${isActive ? styles.artifactFileActive : ''}`}
              onClick={() => setSelected(isActive ? null : a)}
            >
              <span className={styles.artifactFileIcon} data-type={a.type}>
                {iconMap[a.type] || '?'}
              </span>
              <div className={styles.artifactFileInfo}>
                <span className={styles.artifactFileName}>{fileName}</span>
                <span className={styles.artifactFilePath}>{a.filePath}</span>
              </div>
              <span className={styles.artifactFileAction} data-action={a.action}>
                {actionLabel[a.action] || '?'}
              </span>
            </button>
          )
        })}
      </div>

      {/* Viewer pane */}
      <div className={styles.artifactViewerPane}>
        {selected ? (
          <ArtifactViewer
            key={selected.id}
            artifact={selected}
            workspacePath={workspacePath || ''}
          />
        ) : (
          <div className={styles.emptyContent}>
            <p>Select a file to preview</p>
          </div>
        )}
      </div>
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
              setClaudeCommand('/home/yjlee/.local/bin/claude-wrapper')
              setClaudeArgs('--remote-control --permission-mode bypassPermissions')
              setClaudeSetup('export PATH="$HOME/.local/bin:$PATH"')
            }}
          >
            CentOS 7 프리셋 적용 (claude-wrapper + remote-control)
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
function CreateProjectForm({ onSubmit, onCancel }: {
  onSubmit?: (name: string, path: string, engine?: string) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [engine, setEngine] = useState<'claude' | 'opencode'>('claude')
  const [showBrowser, setShowBrowser] = useState(false)

  if (showBrowser) {
    return (
      <FolderBrowser
        onSelect={(selectedPath) => {
          setPath(selectedPath)
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
      <div className={styles.createProjectHeader}>
        <p className={styles.sshFormTitle}>New Project</p>
        {onCancel && (
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        )}
      </div>
      <input
        className={styles.sshInput}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Project name"
        autoFocus
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
function CreateTaskForm({ onSubmit }: { onSubmit?: (name: string, purpose: string, prompt: string) => void }) {
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [prompt, setPrompt] = useState('')

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(name, purpose, prompt) }} className={styles.sshForm}>
      <p className={styles.sshFormTitle}>Add a task</p>
      <input
        className={styles.sshInput}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Task name (e.g. 데이터셋 전처리)"
        required
      />
      <input
        className={styles.sshInput}
        value={purpose}
        onChange={e => setPurpose(e.target.value)}
        placeholder="Purpose — 이 태스크의 목적 (e.g. ERA5 데이터를 학습에 쓸 수 있는 형태로 변환)"
        required
      />
      <textarea
        className={styles.sshTextarea}
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Prompt for agent (e.g. ERA5 데이터를 전처리하고...)"
        rows={4}
        required
      />
      <button type="submit" className={styles.sshConnectBtn} disabled={!name || !purpose || !prompt}>
        Create Task
      </button>
    </form>
  )
}

// ─── Remote Connect Inline ───
function RemoteConnectInline({ onConnect, disabled }: {
  onConnect?: (link: string) => void; disabled?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [link, setLink] = useState('')

  if (!expanded) {
    return (
      <button
        className={styles.localConnectBtn}
        onClick={() => setExpanded(true)}
        disabled={disabled}
      >
        Remote Mode
      </button>
    )
  }

  return (
    <form
      className={styles.remoteForm}
      onSubmit={e => { e.preventDefault(); if (link.trim()) onConnect?.(link.trim()) }}
    >
      <input
        className={styles.sshInput}
        value={link}
        onChange={e => setLink(e.target.value)}
        placeholder="Claude Remote Control link"
        autoFocus
      />
      <button type="submit" className={styles.remoteConnectBtn} disabled={!link.trim()}>
        Connect
      </button>
      <button type="button" className={styles.remoteCancelBtn} onClick={() => setExpanded(false)}>
        Cancel
      </button>
    </form>
  )
}
