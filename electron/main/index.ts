import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { SSHService } from './services/SSHService'
import { WorkspaceManager } from './services/WorkspaceManager'
import { AgentService } from './services/AgentService'

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
ipcMain.handle('ssh:connect', async (_event, config: import('../../../shared/types').ConnectionConfig) => {
  try {
    sshService = new SSHService()
    await sshService.connect(config)

    workspaceManager = new WorkspaceManager(sshService)
    await workspaceManager.init()

    agentService = new AgentService(sshService, workspaceManager)

    // Forward agent events to all windows
    agentService.on('task:status', (data) => {
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

    agentService.on('task:log', (data) => broadcastToAll('task:log', data))
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
  workspacePath: string; prompt: string
}) => {
  if (!agentService) return { success: false, error: 'Not connected' }
  try {
    await agentService.startAgent(
      opts.projectId, opts.phaseId, opts.taskId,
      opts.workspacePath, opts.prompt
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

// ─── Local config (connection settings, no password) ───
function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

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

// ─── Legacy placeholders ───
ipcMain.handle('project:list', async () => [])
ipcMain.handle('project:create', async (_event, input) => ({
  id: crypto.randomUUID(), ...input,
  settings: { autoArtifactScan: true },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}))
ipcMain.handle('project:delete', async () => {})
