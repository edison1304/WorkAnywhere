import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null

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

  // Dev or production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── IPC Handlers (placeholder) ───
ipcMain.handle('project:list', async () => {
  // TODO: SQLite에서 조회
  return []
})

ipcMain.handle('project:create', async (_event, input) => {
  // TODO: SQLite에 저장
  const project = {
    id: crypto.randomUUID(),
    ...input,
    settings: { autoArtifactScan: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  return project
})

ipcMain.handle('project:delete', async (_event, id: string) => {
  // TODO: SQLite에서 삭제
})

ipcMain.handle('job:create', async (_event, projectId: string, prompt: string, name?: string) => {
  // TODO: Claude Code CLI 세션 생성
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

ipcMain.handle('job:list', async (_event, projectId: string) => {
  // TODO: SQLite에서 조회
  return []
})

ipcMain.handle('job:send', async (_event, jobId: string, message: string) => {
  // TODO: 세션에 메시지 전송
})

ipcMain.handle('job:stop', async (_event, jobId: string) => {
  // TODO: 세션 중단
})
