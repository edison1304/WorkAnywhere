import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { SSHService } from './services/SSHService'
import { WorkspaceManager } from './services/WorkspaceManager'
import { AgentService } from './services/AgentService'
import { DataStore } from './services/DataStore'

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
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : { frame: true }),
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

// ─── SSH + Agent Services ───
let sshService: SSHService | null = null
let workspaceManager: WorkspaceManager | null = null
let agentService: AgentService | null = null

// SSH connection
ipcMain.handle('ssh:connect', async (_event, config: import('../../../shared/types').ConnectionConfig, appConfig?: import('../../../shared/types').AppConfig) => {
  try {
    sshService = new SSHService()

    // Apply claude/opencode config from app settings
    if (appConfig) {
      sshService.setClaudeConfig(appConfig)
    } else {
      // Fallback: read from file
      const configPath = getConfigPath()
      if (existsSync(configPath)) {
        try {
          sshService.setClaudeConfig(JSON.parse(readFileSync(configPath, 'utf-8')))
        } catch { /* ignore */ }
      }
    }

    await sshService.connect(config)

    workspaceManager = new WorkspaceManager(sshService)
    await workspaceManager.init()

    agentService = new AgentService(sshService, workspaceManager)

    // Forward agent events to all windows + persist to DataStore
    agentService.on('task:status', (data) => {
      if (dataStore) {
        const patch: Partial<import('../../../shared/types').Task> = { status: data.status }
        if (data.status === 'completed' || data.status === 'failed') {
          patch.completedAt = new Date().toISOString()
        }
        dataStore.taskUpdate(data.taskId, patch)
      }
      broadcastToAll('task:status', data)
      // Send desktop notification on completion/failure
      if (data.status === 'completed' || data.status === 'failed') {
        const emoji = data.status === 'completed' ? '✅' : '❌'
        if (Notification.isSupported()) {
          const n = new Notification({
            title: `${emoji} Task ${data.status}`,
            body: `Task ${data.taskId} has ${data.status}`,
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

    agentService.on('task:log', (data) => {
      if (dataStore) {
        dataStore.taskAddLog(data.taskId, data.log)
      }
      broadcastToAll('task:log', data)
    })
    agentService.on('pty:data', (data) => broadcastToAll('pty:data', data))
    agentService.on('pty:close', (data) => broadcastToAll('pty:close', data))

    // Check claude availability
    const claude = await sshService.checkClaude()

    return { success: true, claude }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('ssh:disconnect', async () => {
  agentService?.removeAllListeners()
  sshService?.disconnect()
  sshService = null
  workspaceManager = null
  agentService = null
  return { success: true }
})

ipcMain.handle('ssh:status', async () => {
  return { connected: sshService?.isConnected() || false }
})

// Update engine config at runtime (without reconnecting)
ipcMain.handle('ssh:update-engine-config', async (_event, appConfig: import('../../../shared/types').AppConfig) => {
  if (sshService) {
    sshService.setClaudeConfig(appConfig)
    return { success: true }
  }
  return { success: false, error: 'Not connected' }
})

ipcMain.handle('ssh:exec', async (_event, command: string) => {
  if (!sshService) return { success: false, error: 'Not connected' }
  try {
    const output = await sshService.exec(command)
    return { success: true, output }
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

// ─── Workspace management ───
ipcMain.handle('workspace:load', async () => {
  if (!workspaceManager) return { success: false, error: 'Not connected' }
  try {
    const workspace = await workspaceManager.load()
    return { success: true, workspace }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('workspace:save', async (_event, workspace) => {
  if (!workspaceManager) return { success: false, error: 'Not connected' }
  try {
    await workspaceManager.save(workspace)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
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
  return dataStore.projectCreate(input)
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
  return dataStore.phaseCreate(projectId, name, description)
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

ipcMain.handle('task:create', async (_event, phaseId: string, name: string, prompt: string) => {
  return dataStore.taskCreate(phaseId, name, prompt)
})

ipcMain.handle('task:update', async (_event, id: string, patch: Partial<import('../../../shared/types').Task>) => {
  return dataStore.taskUpdate(id, patch)
})

ipcMain.handle('task:delete', async (_event, id: string) => {
  dataStore.taskDelete(id)
})

ipcMain.handle('task:run', async (_event, taskId: string) => {
  const task = dataStore.taskGet(taskId)
  if (!task) return { success: false, error: 'Task not found' }
  const project = dataStore.projectList().find(p => p.id === task.projectId)
  if (!project) return { success: false, error: 'Project not found' }
  if (!agentService) return { success: false, error: 'Not connected' }

  dataStore.taskUpdate(taskId, { status: 'running' })
  dataStore.taskAddLog(taskId, {
    id: `${taskId}-start-${Date.now()}`,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'agent_start',
    content: 'Agent started',
  })

  try {
    await agentService.startAgent(
      task.projectId, task.phaseId, taskId,
      project.workspacePath, task.prompt,
      project.settings.agentEngine || 'claude'
    )
    return { success: true }
  } catch (err) {
    dataStore.taskUpdate(taskId, { status: 'failed' })
    dataStore.taskAddLog(taskId, {
      id: `${taskId}-err-${Date.now()}`,
      taskId,
      timestamp: new Date().toISOString(),
      type: 'error',
      content: String(err),
    })
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('task:send', async (_event, taskId: string, message: string) => {
  agentService?.sendMessage(taskId, message)
  dataStore.taskAddLog(taskId, {
    id: `${taskId}-msg-${Date.now()}`,
    taskId,
    timestamp: new Date().toISOString(),
    type: 'text',
    content: `[YOU] ${message}`,
  })
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

// ─── Remote folder browser ───
ipcMain.handle('ssh:list-dir', async (_event, dirPath: string) => {
  if (!sshService?.isConnected()) return { success: false, error: 'Not connected' }
  try {
    // List directories and files with type indicators
    const output = await sshService.exec(
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
  if (!sshService?.isConnected()) return { success: false, error: 'Not connected' }
  try {
    await sshService.exec(`mkdir -p ${JSON.stringify(dirPath)}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('ssh:home', async () => {
  if (!sshService?.isConnected()) return { success: false, error: 'Not connected' }
  try {
    const home = (await sshService.exec('echo $HOME')).trim()
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
  if (!sshService?.isConnected()) return { success: false, error: 'Not connected' }
  try {
    const remotePath = `${opts.workspacePath.replace(/\/$/, '')}/${opts.fileName}`
    const buf = Buffer.from(opts.data)
    await sshService.uploadFile(buf, remotePath)
    return { success: true, remotePath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

