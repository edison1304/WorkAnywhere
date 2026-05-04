import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { AgentService } from './services/AgentService'
import { ConnectionManager } from './services/ConnectionManager'
import { DataStore } from './services/DataStore'
import { compute as computeSchedule } from './services/SchedulingService'
import { WorkflowFileService } from './services/WorkflowFileService'
import { PlanSyncService } from './services/PlanSyncService'

let mainWindow: BrowserWindow | null = null
const detachedWindows = new Map<string, BrowserWindow>()

function getRendererURL(hash: string = ''): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash ? `#${hash}` : ''}`
  }
  return '' // will use loadFile instead
}

function getRendererFile(): string {
  return join(__dirname, '../renderer/index.html')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Workanywhere',
    frame: false,
    titleBarStyle: 'hidden' as const,
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#0f0f0f', symbolColor: '#666', height: 34 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    },
    backgroundColor: '#0f0f0f'
  })

  const url = getRendererURL()
  if (url) {
    mainWindow.loadURL(url)
  } else {
    mainWindow.loadFile(getRendererFile())
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    // DON'T close detached windows when main closes
  })
}

app.whenReady().then(() => {
  // Initialize DataStore before creating window
  dataStore = new DataStore(getDataPath())
  dataStore.load()

  createWindow()

  app.on('activate', () => {
    if (!mainWindow) {
      createWindow()
    }
  })
})

// Only quit when ALL windows are closed (including detached)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── Detached Window Management ───
ipcMain.handle('window:detach', async (_event, panelId: string, options: {
  title?: string
  width?: number
  height?: number
  preferSecondary?: boolean
}) => {
  // Don't create duplicate
  if (detachedWindows.has(panelId)) {
    const existing = detachedWindows.get(panelId)!
    existing.focus()
    return { success: true, reused: true }
  }

  // Find secondary display if requested
  let x: number | undefined
  let y: number | undefined
  if (options.preferSecondary) {
    const displays = screen.getAllDisplays()
    const primaryDisplay = screen.getPrimaryDisplay()
    const secondary = displays.find(d => d.id !== primaryDisplay.id)
    if (secondary) {
      x = secondary.bounds.x + 50
      y = secondary.bounds.y + 50
    }
  }

  const detached = new BrowserWindow({
    width: options.width || 400,
    height: options.height || 800,
    x,
    y,
    title: options.title || 'Workanywhere',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    },
    backgroundColor: '#0f0f0f',
    // Keep on top optionally
    alwaysOnTop: false,
  })

  const url = getRendererURL(panelId)
  if (url) {
    detached.loadURL(url)
  } else {
    detached.loadFile(getRendererFile(), { hash: panelId })
  }

  detachedWindows.set(panelId, detached)

  detached.on('closed', () => {
    detachedWindows.delete(panelId)
    // Notify main window that panel was re-attached
    mainWindow?.webContents.send('window:reattached', panelId)
  })

  return { success: true, reused: false }
})

ipcMain.handle('window:reattach', async (_event, panelId: string) => {
  const win = detachedWindows.get(panelId)
  if (win) {
    win.close()
    detachedWindows.delete(panelId)
  }
  return { success: true }
})

ipcMain.handle('window:list-detached', async () => {
  return Array.from(detachedWindows.keys())
})

// ─── Broadcast state to all windows ───
function broadcastToAll(channel: string, data: unknown): void {
  mainWindow?.webContents.send(channel, data)
  for (const win of detachedWindows.values()) {
    win.webContents.send(channel, data)
  }
}

// Forward state sync between windows
ipcMain.on('state:sync', (_event, data) => {
  broadcastToAll('state:sync', data)
})

// Set window title dynamically
ipcMain.on('window:set-title', (_event, title: string) => {
  if (mainWindow) {
    mainWindow.setTitle(title)
  }
})

// Focus main window (called from detached windows)
ipcMain.handle('window:focus-main', async () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  return { success: !!mainWindow }
})

// ─── Desktop Notifications ───
ipcMain.handle('notify:send', async (_event, options: {
  title: string
  body: string
  urgency?: 'low' | 'normal' | 'critical'
}) => {
  if (!Notification.isSupported()) return { success: false, reason: 'not supported' }

  const notification = new Notification({
    title: options.title,
    body: options.body,
    urgency: options.urgency || 'normal',
    icon: undefined, // TODO: app icon
  })

  notification.on('click', () => {
    // Focus main window on notification click
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  notification.show()
  return { success: true }
})

// ─── Connection + Agent Services ───
const connMgr = new ConnectionManager()
let agentService: AgentService | null = null
const workflow = new WorkflowFileService(connMgr, (pid) =>
  dataStore.projectList().find(p => p.id === pid) || null,
)
const planSync = new PlanSyncService(
  workflow,
  (taskId) => dataStore.taskGet(taskId),
  (phaseId) => {
    for (const p of dataStore.projectList()) {
      const ph = dataStore.phaseList(p.id).find(x => x.id === phaseId)
      if (ph) return ph
    }
    return null
  },
  (pid) => dataStore.projectList().find(p => p.id === pid) || null,
  (taskId, plan) => {
    // Persist derived plan onto the task and broadcast so the UI updates
    // checklist progress + insight panel without polling.
    dataStore.taskUpdate(taskId, { plan })
    broadcastToAll('task:plan', { taskId, plan })
  },
)

// Forward ConnectionManager reconnection events to renderer
connMgr.on('connection:lost', (data) => broadcastToAll('connection:status', { ...data, status: 'lost' }))
connMgr.on('connection:reconnecting', (data) => broadcastToAll('connection:status', { ...data, status: 'reconnecting' }))
connMgr.on('connection:restored', (data) => broadcastToAll('connection:status', { ...data, status: 'restored' }))
connMgr.on('connection:failed', (data) => broadcastToAll('connection:status', { ...data, status: 'failed' }))

/** Helper: get connection for a project by ID (lazy connect) */
async function getConnForProject(projectId: string) {
  const project = dataStore.projectList().find(p => p.id === projectId)
  if (!project) throw new Error('Project not found')
  return connMgr.getConnection(project)
}

/** Helper: get any available connection (for browse/utility ops) */
function getAnyConn() {
  // Try __browse__ first, then any connected project
  const browse = connMgr.getByProjectId('__browse__')
  if (browse) return browse
  const statuses = connMgr.getStatus()
  if (statuses.length > 0) return connMgr.getByProjectId(statuses[0].projectId)
  return null
}

/**
 * Write task summary to phase context file on server.
 * Other agents in the same phase will read this at startup.
 */
async function writePhaseContext(taskId: string): Promise<void> {
  if (!dataStore) return
  const task = dataStore.taskGet(taskId)
  if (!task) return
  const project = dataStore.projectList().find(p => p.id === task.projectId)
  if (!project) return
  const conn = connMgr.getExisting(project)
  if (!conn) return

  const contextPath = `${project.workspacePath}/.workanywhere/phase-${task.phaseId}-context.md`

  // Build context entry from task
  const artifactList = task.artifacts.length > 0
    ? `  Artifacts: ${task.artifacts.map(a => `${a.action} ${a.filePath}`).join(', ')}`
    : ''
  const summaryText = task.summary
    ? `  Summary: ${task.summary.progress}\n  Completed: ${task.summary.completedSteps.join('; ')}`
    : ''
  const lastLogs = task.logs
    .filter(l => l.type !== 'agent_start' && l.type !== 'agent_end')
    .slice(-5)
    .map(l => `  [${l.type}] ${l.content.slice(0, 150)}`)
    .join('\n')

  const entry = [
    `## Task: ${task.name}`,
    `Purpose: ${task.purpose || 'N/A'}`,
    `Status: ${task.status}`,
    `Prompt: ${task.prompt.slice(0, 300)}`,
    summaryText,
    artifactList,
    lastLogs ? `Recent activity:\n${lastLogs}` : '',
    `---`,
    '',
  ].filter(Boolean).join('\n')

  try {
    // Ensure directory exists, then append
    await conn.exec(`mkdir -p ${JSON.stringify(project.workspacePath + '/.workanywhere')}`)
    // Write entry — replace if task already has a section, otherwise append
    const escapedEntry = entry.replace(/'/g, "'\\''")
    const markerStart = `## Task: ${task.name}`
    // Remove old entry for this task if exists, then append new
    await conn.exec(
      `sed -i '/^## Task: ${task.name.replace(/[/\\&]/g, '\\$&')}$/,/^---$/d' ${JSON.stringify(contextPath)} 2>/dev/null; printf '%s\\n' '${escapedEntry}' >> ${JSON.stringify(contextPath)}`
    )
  } catch { /* best-effort */ }
}

function initAgentService(): AgentService {
  if (agentService) return agentService
  agentService = new AgentService(connMgr, (pid) => dataStore.projectList().find(p => p.id === pid) || null)
  setupAgentListeners(agentService)
  return agentService
}

function setupAgentListeners(agent: AgentService): void {
  agent.on('task:status', (data) => {
    if (dataStore) {
      const patch: Partial<import('../../../shared/types').Task> = { status: data.status }
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'review') {
        patch.completedAt = new Date().toISOString()
      }
      dataStore.taskUpdate(data.taskId, patch)
    }
    broadcastToAll('task:status', data)
    // Force final plan sync on terminal states so the file reflects the
    // very last log batch.
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'review') {
      planSync.flushNow(data.taskId).catch(() => {})
    }
    // Write phase context when task finishes
    if (data.status === 'review' || data.status === 'completed') {
      writePhaseContext(data.taskId).catch(() => {})
    }
    if (data.status === 'review' || data.status === 'completed' || data.status === 'failed') {
      const emoji = data.status === 'review' ? '👀' : data.status === 'completed' ? '✅' : '❌'
      if (Notification.isSupported()) {
        const n = new Notification({
          title: `${emoji} Task ${data.status === 'review' ? 'needs review' : data.status}`,
          body: `Task ${data.taskId} — ${data.status}`,
          urgency: data.status === 'failed' ? 'critical' : 'normal',
        })
        n.on('click', () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
          }
        })
        n.show()
      }
    }
  })

  agent.on('task:log', (data) => {
    if (dataStore) {
      dataStore.taskAddLog(data.taskId, data.log)
    }
    broadcastToAll('task:log', data)
    // Debounced parse → CHECKLIST.md / NOTES.md sync + plan field update.
    // Only on text-bearing logs (skip pure events like agent_start with no
    // checklist content) — the parser itself is cheap but the file write
    // isn't.
    if (data.log.type === 'text' || data.log.type === 'agent_end') {
      planSync.notify(data.taskId)
    }
  })
  agent.on('task:sessionId', (data) => {
    if (dataStore) {
      dataStore.taskUpdate(data.taskId, { sessionId: data.sessionId })
    }
  })
  agent.on('task:artifact', (data: { taskId: string; artifact: import('../../../shared/types').Artifact }) => {
    if (dataStore) {
      dataStore.taskAddArtifact(data.taskId, data.artifact)
    }
    broadcastToAll('artifact:new', data)
  })
  agent.on('pty:data', (data) => broadcastToAll('pty:data', data))
  agent.on('pty:close', (data) => broadcastToAll('pty:close', data))
}

// ─── Project connection (per-project, lazy) ───
ipcMain.handle('project:connect', async (_event, projectId: string, appConfig?: import('../../../shared/types').AppConfig) => {
  try {
    if (appConfig) connMgr.setAppConfig(appConfig)
    const project = dataStore.projectList().find(p => p.id === projectId)
    if (!project) return { success: false, error: 'Project not found' }

    const conn = await connMgr.getConnection(project)
    initAgentService()

    const claude = await conn.checkClaude()
    return { success: true, claude }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('project:disconnect', async (_event, projectId: string) => {
  await connMgr.disconnect(projectId)
  return { success: true }
})

// Legacy: global SSH connect (for initial project setup / browsing)
ipcMain.handle('ssh:connect', async (_event, config: import('../../../shared/types').ConnectionConfig, appConfig?: import('../../../shared/types').AppConfig) => {
  try {
    if (appConfig) connMgr.setAppConfig(appConfig)
    // Create a temporary "browse" project to hold this connection
    const tempProject: import('../../../shared/types').Project = {
      id: '__browse__',
      name: 'Browse',
      workspacePath: '~',
      connection: config,
      settings: { agentEngine: 'claude', autoArtifactScan: true },
      createdAt: '', updatedAt: '',
    }
    const conn = await connMgr.getConnection(tempProject)
    initAgentService()
    const claude = await conn.checkClaude()
    return { success: true, claude }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('local:connect', async (_event, appConfig?: import('../../../shared/types').AppConfig) => {
  try {
    if (appConfig) connMgr.setAppConfig(appConfig)
    const tempProject: import('../../../shared/types').Project = {
      id: '__browse__',
      name: 'Browse',
      workspacePath: '~',
      connection: { type: 'local' },
      settings: { agentEngine: 'claude', autoArtifactScan: true },
      createdAt: '', updatedAt: '',
    }
    const conn = await connMgr.getConnection(tempProject)
    initAgentService()
    const claude = await conn.checkClaude()
    return { success: true, claude }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('remote:connect', async (_event, remoteLink: string, appConfig?: import('../../../shared/types').AppConfig) => {
  try {
    if (appConfig) connMgr.setAppConfig(appConfig)
    const tempProject: import('../../../shared/types').Project = {
      id: '__browse__',
      name: 'Remote',
      workspacePath: '~',
      connection: { type: 'remote', remote: { link: remoteLink } },
      settings: { agentEngine: 'claude', autoArtifactScan: true },
      createdAt: '', updatedAt: '',
    }
    const conn = await connMgr.getConnection(tempProject)
    initAgentService()
    const claude = await conn.checkClaude()
    return { success: true, claude }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('ssh:disconnect', async () => {
  agentService?.removeAllListeners()
  connMgr.disconnectAll()
  agentService = null
  return { success: true }
})

ipcMain.handle('ssh:status', async () => {
  const statuses = connMgr.getStatus()
  return { connected: statuses.length > 0, statuses }
})

// Update engine config at runtime (applies to all connections)
ipcMain.handle('ssh:update-engine-config', async (_event, appConfig: import('../../../shared/types').AppConfig) => {
  connMgr.setAppConfig(appConfig)
  return { success: true }
})

ipcMain.handle('ssh:exec', async (_event, command: string, projectId?: string) => {
  try {
    let conn
    if (projectId) {
      conn = await getConnForProject(projectId)
    } else {
      // Fallback: use __browse__ or first available connection
      conn = connMgr.getByProjectId('__browse__')
      if (!conn) {
        const statuses = connMgr.getStatus()
        if (statuses.length > 0) conn = connMgr.getByProjectId(statuses[0].projectId)
      }
    }
    if (!conn) return { success: false, error: 'Not connected' }
    const output = await conn.exec(command)
    return { success: true, output }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

/** Run a Claude prompt on a project's server and return raw output */
async function runClaudeOnProject(projectId: string, prompt: string): Promise<string> {
  const project = dataStore.projectList().find(p => p.id === projectId)
  if (!project) throw new Error('Project not found')
  console.log(`[runClaude] projectId=${projectId}`)
  const conn = await connMgr.getConnection(project)
  const engine = project.settings?.agentEngine || 'claude'
  const prefix = conn.getShellPrefix(engine)
  const cwd = project.workspacePath

  // Base64 encode the prompt to completely avoid shell escaping issues
  // (Korean text, quotes, parens, JSON braces all become safe alphanumeric chars)
  const b64 = Buffer.from(prompt, 'utf-8').toString('base64')
  const tmpFile = `/tmp/.wa-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`

  // Step 1: Write decoded prompt to temp file via base64 (safe over SSH)
  await conn.exec(`echo '${b64}' | base64 -d > ${tmpFile}`)

  // Step 2: Run claude with the temp file content
  // Use single-quoted bash -lc so $(cat ...) is evaluated by the inner shell only
  const claudeBase = conn.getEngineCmd(engine, ['--output-format', 'text'])
  const innerScript = `${prefix}cd ${JSON.stringify(cwd)} && ${claudeBase} -p "$(cat ${tmpFile})"; rm -f ${tmpFile}`
  const escapedScript = innerScript.replace(/'/g, "'\\''")
  const execCmd = `bash -lc '${escapedScript}'`

  console.log(`[runClaude] exec cmd: ${execCmd.slice(0, 200)}...`)
  const result = await conn.exec(execCmd)
  console.log(`[runClaude] result length=${result.length}, preview: "${result.slice(0, 200)}"`)
  return result
}

/** Write content to a file on a project's server */
async function writeFileOnProject(projectId: string, filePath: string, content: string): Promise<void> {
  const project = dataStore.projectList().find(p => p.id === projectId)
  if (!project) return
  const conn = connMgr.getExisting(project)
  if (!conn) return
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  await conn.exec(`mkdir -p ${JSON.stringify(dir)} && cat > ${JSON.stringify(filePath)} << 'WEOF'\n${content}\nWEOF`)
}

// ─── Task Summary (via Claude CLI) ───
ipcMain.handle('task:summarize', async (_event, taskId: string) => {
  console.log(`[Summarize] taskId=${taskId}`)
  const task = dataStore.taskGet(taskId)
  if (!task) { console.log('[Summarize] Task not found'); return { success: false, error: 'Task not found' } }
  console.log(`[Summarize] task found, logs=${task.logs.length}, projectId=${task.projectId}`)

  try {
    const logText = task.logs
      .slice(-200)
      .map(l => `[${l.type}] ${l.content}`)
      .join('\n')
      .slice(0, 8000)

    const artifactText = task.artifacts.length > 0
      ? '\nArtifacts: ' + task.artifacts.map(a => `${a.action} ${a.filePath}`).join(', ')
      : ''

    const prompt = `You are a task progress analyzer. Given the following agent execution logs for a task, produce a JSON summary.

Task name: ${task.name}
Task prompt: ${task.prompt}
Current status: ${task.status}

Logs:
${logText}
${artifactText}

Respond with ONLY a JSON object (no markdown, no backticks):
{
  "currentStep": "what is happening or just finished (1 sentence)",
  "completedSteps": ["step 1 done", "step 2 done"],
  "nextSteps": ["likely next step"],
  "issues": ["any errors or problems found"],
  "progress": "one-line overall progress summary"
}`

    console.log(`[Summarize] calling runClaudeOnProject, prompt length=${prompt.length}`)
    const rawOutput = await runClaudeOnProject(task.projectId, prompt)
    console.log(`[Summarize] rawOutput length=${rawOutput.length}, preview: "${rawOutput.slice(0, 200)}"`)

    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { success: false, error: 'Failed to parse summary — no JSON in output' }

    let parsed: any
    try { parsed = JSON.parse(jsonMatch[0]) }
    catch { return { success: false, error: 'Failed to parse summary — invalid JSON' } }

    const summary: import('../../../shared/types').TaskSummary = {
      currentStep: String(parsed.currentStep || ''),
      completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps.map(String) : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      progress: String(parsed.progress || ''),
      updatedAt: new Date().toISOString(),
    }

    // Persist summary + update phase context
    dataStore.taskUpdate(taskId, { summary })
    broadcastToAll('task:status', { taskId, status: task.status })
    writePhaseContext(taskId).catch(() => {})

    return { success: true, summary }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── Phase Summary (compose from task summaries → cheap) ───
ipcMain.handle('phase:summarize', async (_event, phaseId: string) => {
  let phase: import('../../../shared/types').Phase | null = null
  for (const p of dataStore.projectList()) {
    const found = dataStore.phaseList(p.id).find(x => x.id === phaseId)
    if (found) { phase = found; break }
  }
  if (!phase) return { success: false, error: 'Phase not found' }

  const tasks = dataStore.taskList(phaseId)
  if (tasks.length === 0) return { success: false, error: 'No tasks in phase' }

  const project = dataStore.projectList().find(p => p.id === phase.projectId)
  if (!project) return { success: false, error: 'Project not found' }

  try {
    const taskDescriptions = tasks.map(t => {
      const desc = t.summary
        ? `Progress: ${t.summary.progress}, Completed: ${t.summary.completedSteps.join('; ')}, Issues: ${t.summary.issues.join('; ')}`
        : `Status: ${t.status}`
      return `- ${t.name} [${t.status}]: Purpose: ${t.purpose || 'N/A'}. ${desc}`
    }).join('\n')

    const prompt = `You are a phase progress analyzer. Given the following tasks in a development phase, produce a JSON summary showing the local pipeline flow and current state.

Phase: ${phase.name}
Description: ${phase.description || 'N/A'}

Tasks:
${taskDescriptions}

Respond with ONLY a JSON object (no markdown, no backticks):
{
  "pipeline": "step1 → step2 → step3 (show the logical flow of tasks, use → arrows)",
  "currentState": "what is happening now in this phase (1 sentence)",
  "completedWork": ["what has been done"],
  "pendingWork": ["what still needs to be done"],
  "issues": ["current problems or blockers"],
  "dependencies": ["task A must finish before task B can start"]
}`

    const rawOutput = await runClaudeOnProject(project.id, prompt)
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { success: false, error: 'Failed to parse phase summary — no JSON' }

    let parsed: any
    try { parsed = JSON.parse(jsonMatch[0]) }
    catch { return { success: false, error: 'Failed to parse phase summary — invalid JSON' } }

    const summary: import('../../../shared/types').PhaseSummary = {
      pipeline: String(parsed.pipeline || ''),
      currentState: String(parsed.currentState || ''),
      completedWork: Array.isArray(parsed.completedWork) ? parsed.completedWork.map(String) : [],
      pendingWork: Array.isArray(parsed.pendingWork) ? parsed.pendingWork.map(String) : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies.map(String) : [],
      updatedAt: new Date().toISOString(),
    }

    dataStore.phaseUpdate(phaseId, { summary })
    const summaryMd = `# Phase: ${phase.name}\nPipeline: ${summary.pipeline}\nCurrent: ${summary.currentState}\nCompleted: ${summary.completedWork.join('; ')}\nPending: ${summary.pendingWork.join('; ')}\nIssues: ${summary.issues.join('; ')}\nDependencies: ${summary.dependencies.join('; ')}`
    writeFileOnProject(project.id, `${project.workspacePath}/.workanywhere/phase-${phaseId}-summary.md`, summaryMd).catch(() => {})

    return { success: true, summary }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── Project Summary (compose from phase summaries → cheapest) ───
ipcMain.handle('project:summarize', async (_event, projectId: string) => {
  const project = dataStore.projectList().find(p => p.id === projectId)
  if (!project) return { success: false, error: 'Project not found' }

  const phases = dataStore.phaseList(projectId)
  if (phases.length === 0) return { success: false, error: 'No phases in project' }

  try {
    const phaseDescriptions = phases.map(ph => {
      const tasks = dataStore.taskList(ph.id)
      const stats = { total: tasks.length, done: tasks.filter(t => t.status === 'completed').length, review: tasks.filter(t => t.status === 'review').length, failed: tasks.filter(t => t.status === 'failed').length }
      const sum = ph.summary ? `Pipeline: ${ph.summary.pipeline}, Current: ${ph.summary.currentState}` : `Status: ${ph.status}`
      return `- ${ph.name} [${ph.status}] (${stats.done}/${stats.total} done, ${stats.review} review, ${stats.failed} failed): ${sum}`
    }).join('\n')

    const prompt = `You are a project progress analyzer. Given the following phases, produce a JSON summary of the overall project pipeline.

Project: ${project.name}

Phases:
${phaseDescriptions}

Respond with ONLY a JSON object (no markdown, no backticks):
{
  "pipeline": "phase1 → phase2 → phase3 (overall flow, use → arrows)",
  "currentPhase": "which phase is active and what is happening",
  "overallProgress": "one-line summary",
  "blockers": ["any project-level blockers"]
}`

    const rawOutput = await runClaudeOnProject(projectId, prompt)
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { success: false, error: 'Failed to parse project summary — no JSON' }

    let parsed: any
    try { parsed = JSON.parse(jsonMatch[0]) }
    catch { return { success: false, error: 'Failed to parse project summary — invalid JSON' } }

    const summary: import('../../../shared/types').ProjectSummary = {
      pipeline: String(parsed.pipeline || ''),
      currentPhase: String(parsed.currentPhase || ''),
      overallProgress: String(parsed.overallProgress || ''),
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String) : [],
      updatedAt: new Date().toISOString(),
    }

    dataStore.projectUpdate(projectId, { summary })
    const summaryMd = `# Project: ${project.name}\nPipeline: ${summary.pipeline}\nCurrent: ${summary.currentPhase}\nOverall: ${summary.overallProgress}\nBlockers: ${summary.blockers.join('; ')}`
    writeFileOnProject(projectId, `${project.workspacePath}/.workanywhere/project-summary.md`, summaryMd).catch(() => {})

    return { success: true, summary }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── Agent control ───
ipcMain.handle('agent:start', async (_event, opts: {
  projectId: string; phaseId: string; taskId: string
  workspacePath: string; prompt: string; engine?: string
}) => {
  if (!agentService) return { success: false, error: 'Not connected' }
  try {
    await agentService.startAgent(
      opts.projectId, opts.phaseId, opts.taskId,
      opts.workspacePath, opts.prompt, opts.engine || 'claude'
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('agent:resume', async (_event, taskId: string) => {
  const task = dataStore.taskGet(taskId)
  if (!task) return { success: false, error: 'Task not found' }
  if (!task.sessionId) return { success: false, error: 'No session ID to resume' }
  const project = dataStore.projectList().find(p => p.id === task.projectId)
  if (!project) return { success: false, error: 'Project not found' }

  initAgentService()
  try { await connMgr.getConnection(project) } catch (e) {
    return { success: false, error: `Connection failed: ${e}` }
  }

  dataStore.taskUpdate(taskId, { status: 'running' })
  broadcastToAll('task:status', { taskId, status: 'running' })
  try {
    await agentService!.resumeSession(
      taskId, task.projectId, task.phaseId,
      project.workspacePath, task.sessionId,
      project.settings.agentEngine || 'claude'
    )
    return { success: true }
  } catch (err) {
    dataStore.taskUpdate(taskId, { status: 'failed' })
    broadcastToAll('task:status', { taskId, status: 'failed' })
    const errLog = { id: `${taskId}-err-${Date.now()}`, taskId, timestamp: new Date().toISOString(), type: 'error' as const, content: String(err) }
    dataStore.taskAddLog(taskId, errLog)
    broadcastToAll('task:log', { taskId, log: errLog })
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('agent:stop', async (_event, taskId: string) => {
  agentService?.stopAgent(taskId)
  return { success: true }
})

ipcMain.handle('agent:send', async (_event, taskId: string, message: string) => {
  agentService?.sendMessage(taskId, message)
  return { success: true }
})

// PTY I/O for xterm.js
ipcMain.on('pty:write', (_event, taskId: string, data: string) => {
  agentService?.writePTY(taskId, data)
})

ipcMain.on('pty:resize', (_event, taskId: string, cols: number, rows: number) => {
  agentService?.resizePTY(taskId, cols, rows)
})

// ─── Shell terminal (server bash) ───
const shellSessions = new Map<string, { write: (d: string) => void; resize: (c: number, r: number) => void; close: () => void }>()

ipcMain.handle('shell:open', async (_event, projectId: string) => {
  try {
    const conn = await getConnForProject(projectId)
    const shellId = `shell-${projectId}-${Date.now()}`
    const project = dataStore.projectList().find(p => p.id === projectId)
    const cwd = project?.workspacePath || '~'

    const session = await conn.spawnPTY(`cd ${JSON.stringify(cwd)} && bash`, shellId)

    session.onData((data) => broadcastToAll('shell:data', { shellId, data }))
    session.onClose(() => {
      shellSessions.delete(shellId)
      broadcastToAll('shell:close', { shellId })
    })

    shellSessions.set(shellId, {
      write: (d) => session.write(d),
      resize: (c, r) => session.resize(c, r),
      close: () => session.close(),
    })

    return { success: true, shellId }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.on('shell:write', (_event, shellId: string, data: string) => {
  shellSessions.get(shellId)?.write(data)
})

ipcMain.on('shell:resize', (_event, shellId: string, cols: number, rows: number) => {
  shellSessions.get(shellId)?.resize(cols, rows)
})

ipcMain.handle('shell:close', async (_event, shellId: string) => {
  shellSessions.get(shellId)?.close()
  shellSessions.delete(shellId)
  return { success: true }
})

// ─── Workspace management (legacy — data now in DataStore) ───
ipcMain.handle('workspace:load', async () => {
  return { success: true, workspace: null }
})

ipcMain.handle('workspace:save', async () => {
  return { success: true }
})

// ─── Local persistence ───
function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function getDataPath(): string {
  return join(app.getPath('userData'), 'data.json')
}

// DataStore — single source of truth for Project/Phase/Task
let dataStore: DataStore

// ─── Project CRUD ───
ipcMain.handle('project:list', async () => {
  return dataStore.projectList()
})

ipcMain.handle('project:create', async (_event, input: import('../../../shared/types').CreateProjectInput) => {
  const project = dataStore.projectCreate(input)
  // Best-effort plan tree seed; failure here must not block project creation.
  workflow.ensureProject(project).catch(() => {})
  return project
})

ipcMain.handle('project:update', async (_event, id: string, patch: Partial<import('../../../shared/types').Project>) => {
  return dataStore.projectUpdate(id, patch)
})

ipcMain.handle('project:delete', async (_event, id: string) => {
  dataStore.projectDelete(id)
})

// ─── Phase CRUD ───
ipcMain.handle('phase:list', async (_event, projectId: string) => {
  return dataStore.phaseList(projectId)
})

ipcMain.handle('phase:create', async (_event, projectId: string, name: string, description?: string) => {
  const phase = dataStore.phaseCreate(projectId, name, description)
  const project = dataStore.projectList().find(p => p.id === projectId)
  if (project) workflow.ensurePhase(project, phase).catch(() => {})
  return phase
})

ipcMain.handle('phase:update', async (_event, id: string, patch: Partial<import('../../../shared/types').Phase>) => {
  return dataStore.phaseUpdate(id, patch)
})

ipcMain.handle('phase:delete', async (_event, id: string) => {
  dataStore.phaseDelete(id)
})

// ─── Task CRUD ───
ipcMain.handle('task:list', async (_event, phaseId: string) => {
  return dataStore.taskList(phaseId)
})

ipcMain.handle('task:create', async (_event, phaseId: string, name: string, purpose: string, prompt: string) => {
  const task = dataStore.taskCreate(phaseId, name, purpose, prompt)
  const project = dataStore.projectList().find(p => p.id === task.projectId)
  // phaseList scoped by project; find phase among that project's phases
  const phase = project ? dataStore.phaseList(project.id).find(ph => ph.id === phaseId) : null
  if (project && phase) workflow.ensureTask(project, phase, task).catch(() => {})
  return task
})

ipcMain.handle('task:update', async (_event, id: string, patch: Partial<import('../../../shared/types').Task>) => {
  return dataStore.taskUpdate(id, patch)
})

ipcMain.handle('task:delete', async (_event, id: string) => {
  dataStore.taskDelete(id)
})

ipcMain.handle('task:reorder', async (_event, phaseId: string, orderedIds: string[]) => {
  dataStore.taskReorder(phaseId, orderedIds)
  return { success: true }
})

ipcMain.handle('phase:reorder', async (_event, projectId: string, orderedIds: string[]) => {
  dataStore.phaseReorder(projectId, orderedIds)
  return { success: true }
})

ipcMain.handle('schedule:compute', async (_event, projectId: string) => {
  try {
    const all = dataStore.getAll()
    const result = await computeSchedule(
      projectId,
      all.tasks,
      all.phases,
      (prompt) => runClaudeOnProject(projectId, prompt),
    )
    return { success: true, result }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('task:run', async (_event, taskId: string) => {
  const task = dataStore.taskGet(taskId)
  if (!task) return { success: false, error: 'Task not found' }
  const project = dataStore.projectList().find(p => p.id === task.projectId)
  if (!project) return { success: false, error: 'Project not found' }

  // Ensure agent service is ready
  initAgentService()

  // Auto-connect project if not connected
  try {
    await connMgr.getConnection(project)
  } catch (connErr) {
    const errMsg = `Connection failed: ${connErr}`
    broadcastToAll('task:log', { taskId, log: { id: `${taskId}-err-${Date.now()}`, taskId, timestamp: new Date().toISOString(), type: 'error', content: errMsg } })
    return { success: false, error: errMsg }
  }

  dataStore.taskUpdate(taskId, { status: 'running' })
  broadcastToAll('task:status', { taskId, status: 'running' })

  const startLog = { id: `${taskId}-start-${Date.now()}`, taskId, timestamp: new Date().toISOString(), type: 'agent_start' as const, content: 'Agent started' }
  dataStore.taskAddLog(taskId, startLog)
  broadcastToAll('task:log', { taskId, log: startLog })

  // Ensure plan files exist + build layered prefix from PLAN/CHECKLIST/NOTES
  // for project → phase → task. Best-effort: failures fall back to bare
  // prompt. Hard time-budget so a slow filesystem never blocks agent start.
  let prefixedPrompt = task.prompt
  const phase = dataStore.phaseList(project.id).find(ph => ph.id === task.phaseId)
  if (phase) {
    // Fire-and-forget the file seed — never await it.
    workflow.ensureTask(project, phase, task).catch(() => {})

    // Build prefix with a 4-second budget. If reads are slow on first run
    // (mkdir + 7 cats over SSH), we'd rather start the agent without the
    // prefix than make the user stare at a stuck spinner.
    try {
      const PREFIX_TIMEOUT_MS = 4000
      const prefix = await Promise.race<string | null>([
        workflow.buildPrefix(project, phase, task),
        new Promise(resolve => setTimeout(() => resolve(null), PREFIX_TIMEOUT_MS)),
      ])
      // Cap total prefix size — guards SSH command-line + token budget.
      const MAX_PREFIX = 6000
      if (prefix && prefix.trim()) {
        const trimmed = prefix.length > MAX_PREFIX
          ? prefix.slice(0, MAX_PREFIX) + '\n... (prefix truncated)\n'
          : prefix
        prefixedPrompt = `${trimmed}\n---\n\n${task.prompt}`
        console.log(`[task:run] prefix injected, ${prefix.length} chars (capped at ${MAX_PREFIX})`)
      } else if (!prefix) {
        console.log(`[task:run] prefix build timed out at ${PREFIX_TIMEOUT_MS}ms — running with bare prompt`)
      }
    } catch (e) {
      console.log(`[task:run] prefix build failed: ${e} — running with bare prompt`)
    }
  }

  try {
    await agentService!.startAgent(
      task.projectId, task.phaseId, taskId,
      project.workspacePath, prefixedPrompt,
      project.settings.agentEngine || 'claude'
    )
    return { success: true }
  } catch (err) {
    const errMsg = String(err)
    dataStore.taskUpdate(taskId, { status: 'failed' })
    broadcastToAll('task:status', { taskId, status: 'failed' })

    const errLog = { id: `${taskId}-err-${Date.now()}`, taskId, timestamp: new Date().toISOString(), type: 'error' as const, content: errMsg }
    dataStore.taskAddLog(taskId, errLog)
    broadcastToAll('task:log', { taskId, log: errLog })

    return { success: false, error: errMsg }
  }
})

ipcMain.handle('task:send', async (_event, taskId: string, message: string) => {
  // AgentService.sendMessage handles logging + broadcast
  agentService?.sendMessage(taskId, message)
  return { success: true }
})

ipcMain.handle('task:stop', async (_event, taskId: string) => {
  agentService?.stopAgent(taskId)
  dataStore.taskUpdate(taskId, { status: 'failed' })
  return { success: true }
})

// ─── Bulk data (legacy compatibility) ───
ipcMain.handle('data:load', async () => {
  try {
    return { success: true, data: dataStore.getAll() }
  } catch {
    return { success: true, data: null }
  }
})

ipcMain.handle('data:save', async (_event, data: import('../../../shared/types').SavedData) => {
  try {
    dataStore.replaceAll(data)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── Server-side data sync ───
// Save workspace data to server's ~/.workanywhere/data.json
ipcMain.handle('data:save-to-server', async () => {
  try {
    const conn = getAnyConn()
    if (!conn) return { success: false, error: 'Not connected' }
    const data = dataStore.getAll()
    const json = JSON.stringify(data)
    const b64 = Buffer.from(json, 'utf-8').toString('base64')
    await conn.exec(`mkdir -p ~/.workanywhere && echo '${b64}' | base64 -d > ~/.workanywhere/data.json`)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// Load workspace data from server's ~/.workanywhere/data.json
ipcMain.handle('data:load-from-server', async () => {
  try {
    const conn = getAnyConn()
    if (!conn) return { success: false, error: 'Not connected' }
    const raw = await conn.exec('cat ~/.workanywhere/data.json 2>/dev/null || echo ""')
    const trimmed = raw.trim()
    if (!trimmed) return { success: true, data: null }
    const data: import('../../../shared/types').SavedData = JSON.parse(trimmed)
    // Also update local DataStore
    if (data.projects?.length || data.phases?.length || data.tasks?.length) {
      dataStore.replaceAll(data)
    }
    return { success: true, data }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('config:load', async () => {
  const configPath = getConfigPath()
  try {
    if (existsSync(configPath)) {
      return { success: true, config: JSON.parse(readFileSync(configPath, 'utf-8')) }
    }
    return { success: true, config: null }
  } catch {
    return { success: true, config: null }
  }
})

ipcMain.handle('config:save', async (_event, config: Record<string, unknown>) => {
  try {
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2))
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── Session Descriptor export/import ───
ipcMain.handle('descriptor:export', async (_event, projectId: string) => {
  try {
    const project = dataStore.projectList().find(p => p.id === projectId)
    if (!project) return { success: false, error: 'Project not found' }

    const phases = dataStore.phaseList(projectId)
    const allTasks: import('../../../shared/types').Task[] = []
    for (const ph of phases) {
      allTasks.push(...dataStore.taskList(ph.id))
    }

    const descriptor: import('../../../shared/types').SessionDescriptor = {
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedFrom: require('os').hostname(),
      project: {
        name: project.name,
        workspacePath: project.workspacePath,
        connection: project.connection,
        settings: project.settings,
      },
      phases: phases.map(ph => ({
        name: ph.name,
        description: ph.description,
        order: ph.order,
        status: ph.status,
      })),
      tasks: allTasks.map(t => {
        const phase = phases.find(ph => ph.id === t.phaseId)
        return {
          phaseName: phase?.name || '',
          name: t.name,
          purpose: t.purpose || '',
          prompt: t.prompt,
          status: t.status,
          sessionId: t.sessionId,
        }
      }),
    }
    return { success: true, descriptor }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('descriptor:import', async (_event, descriptor: import('../../../shared/types').SessionDescriptor) => {
  try {
    // Create project
    const project = dataStore.projectCreate({
      name: descriptor.project.name,
      workspacePath: descriptor.project.workspacePath,
      connection: descriptor.project.connection,
    })
    dataStore.projectUpdate(project.id, { settings: descriptor.project.settings })

    // Create phases
    const phaseMap = new Map<string, string>() // phaseName → phaseId
    for (const ph of descriptor.phases) {
      const phase = dataStore.phaseCreate(project.id, ph.name, ph.description)
      phaseMap.set(ph.name, phase.id)
    }

    // Create tasks
    for (const t of descriptor.tasks) {
      const phaseId = phaseMap.get(t.phaseName)
      if (!phaseId) continue
      const task = dataStore.taskCreate(phaseId, t.name, t.purpose || '', t.prompt)
      if (t.sessionId) {
        dataStore.taskUpdate(task.id, { sessionId: t.sessionId })
      }
    }

    return { success: true, projectId: project.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── Remote file read ───
ipcMain.handle('ssh:read-file', async (_event, filePath: string) => {
  const conn = getAnyConn()
  if (!conn) return { success: false, error: 'Not connected' }
  try {
    // Check file size first (limit 2MB for text, 5MB for binary)
    const statOut = await conn.exec(`stat -c '%s' ${JSON.stringify(filePath)} 2>/dev/null || echo '-1'`)
    const fileSize = parseInt(statOut.trim(), 10)
    if (fileSize < 0) return { success: false, error: 'File not found' }

    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'pdf', 'ico']
    const isBinary = binaryExts.includes(ext)

    if (isBinary) {
      if (fileSize > 5 * 1024 * 1024) return { success: false, error: 'File too large (>5MB)' }
      const content = await conn.exec(`base64 ${JSON.stringify(filePath)}`)
      return { success: true, content: content.replace(/\n/g, ''), encoding: 'base64' as const, size: fileSize }
    } else {
      if (fileSize > 2 * 1024 * 1024) return { success: false, error: 'File too large (>2MB)' }
      const content = await conn.exec(`cat ${JSON.stringify(filePath)}`)
      return { success: true, content, encoding: 'utf8' as const, size: fileSize }
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── Remote folder browser ───
ipcMain.handle('ssh:list-dir', async (_event, dirPath: string) => {
  const conn = getAnyConn()
  if (!conn) return { success: false, error: 'Not connected' }
  try {
    const output = await conn.exec(
      `ls -1pa ${JSON.stringify(dirPath)} 2>/dev/null | head -100`
    )
    const entries = output.trim().split('\n').filter(Boolean).map(name => {
      const isDir = name.endsWith('/')
      return {
        name: isDir ? name.slice(0, -1) : name,
        isDir,
        path: dirPath.replace(/\/$/, '') + '/' + (isDir ? name.slice(0, -1) : name)
      }
    })
    // Sort: dirs first, then files
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { success: true, entries, currentPath: dirPath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('ssh:mkdir', async (_event, dirPath: string) => {
  const conn = getAnyConn()
  if (!conn) return { success: false, error: 'Not connected' }
  try {
    await conn.exec(`mkdir -p ${JSON.stringify(dirPath)}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('ssh:home', async () => {
  const conn = getAnyConn()
  if (!conn) return { success: false, error: 'Not connected' }
  try {
    const home = (await conn.exec('echo $HOME')).trim()
    return { success: true, home }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// ─── File upload to server ───
ipcMain.handle('ssh:upload-file', async (_event, opts: {
  fileName: string
  data: number[]  // Buffer serialized as array
  workspacePath: string
}) => {
  const conn = getAnyConn()
  if (!conn) return { success: false, error: 'Not connected' }
  try {
    const remotePath = `${opts.workspacePath.replace(/\/$/, '')}/${opts.fileName}`
    const buf = Buffer.from(opts.data)
    // Use base64 upload via exec (works for both SSH and local)
    const b64 = buf.toString('base64')
    await conn.exec(`mkdir -p "$(dirname ${JSON.stringify(remotePath)})"`)
    // Split into chunks for large files
    await conn.exec(`rm -f ${JSON.stringify(remotePath)}.b64tmp`)
    const chunkSize = 60000
    for (let i = 0; i < b64.length; i += chunkSize) {
      const chunk = b64.slice(i, i + chunkSize)
      await conn.exec(`printf '%s' ${JSON.stringify(chunk)} >> ${JSON.stringify(remotePath)}.b64tmp`)
    }
    await conn.exec(`base64 -d ${JSON.stringify(remotePath)}.b64tmp > ${JSON.stringify(remotePath)} && rm -f ${JSON.stringify(remotePath)}.b64tmp`)
    return { success: true, remotePath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

