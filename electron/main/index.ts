import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

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
    titleBarStyle: 'hiddenInset',
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

// ─── IPC Handlers (placeholder) ───
ipcMain.handle('project:list', async () => {
  return []
})

ipcMain.handle('project:create', async (_event, input) => {
  const project = {
    id: crypto.randomUUID(),
    ...input,
    settings: { autoArtifactScan: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  return project
})

ipcMain.handle('project:delete', async (_event, _id: string) => {})

ipcMain.handle('job:create', async (_event, projectId: string, prompt: string, name?: string) => {
  const job = {
    id: crypto.randomUUID(),
    projectId,
    name: name || prompt.slice(0, 50),
    status: 'queued' as const,
    prompt,
    steps: [],
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  return job
})

ipcMain.handle('job:list', async (_event, _projectId: string) => { return [] })
ipcMain.handle('job:send', async (_event, _jobId: string, _message: string) => {})
ipcMain.handle('job:stop', async (_event, _jobId: string) => {})
