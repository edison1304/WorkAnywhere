import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi } from '../../shared/types'

const api: IpcApi = {
  projectList: () => ipcRenderer.invoke('project:list'),
  projectCreate: (input) => ipcRenderer.invoke('project:create', input),
  projectUpdate: (id, patch) => ipcRenderer.invoke('project:update', id, patch),
  projectDelete: (id) => ipcRenderer.invoke('project:delete', id),

  phaseList: (projectId) => ipcRenderer.invoke('phase:list', projectId),
  phaseCreate: (projectId, name, description) => ipcRenderer.invoke('phase:create', projectId, name, description),
  phaseUpdate: (id, patch) => ipcRenderer.invoke('phase:update', id, patch),
  phaseDelete: (id) => ipcRenderer.invoke('phase:delete', id),

  taskList: (phaseId) => ipcRenderer.invoke('task:list', phaseId),
  taskCreate: (phaseId, name, purpose, prompt) => ipcRenderer.invoke('task:create', phaseId, name, purpose, prompt),
  taskUpdate: (id, patch) => ipcRenderer.invoke('task:update', id, patch),
  taskDelete: (id) => ipcRenderer.invoke('task:delete', id),
  taskRun: (taskId) => ipcRenderer.invoke('task:run', taskId),
  taskSend: (taskId, message) => ipcRenderer.invoke('task:send', taskId, message),
  taskStop: (taskId) => ipcRenderer.invoke('task:stop', taskId),

  onTaskStatus: (cb) => {
    const handler = (_event: unknown, data: Parameters<typeof cb>[0]) => cb(data)
    ipcRenderer.on('task:status', handler)
    return () => ipcRenderer.removeListener('task:status', handler)
  },
  onTaskLog: (cb) => {
    const handler = (_event: unknown, data: Parameters<typeof cb>[0]) => cb(data)
    ipcRenderer.on('task:log', handler)
    return () => ipcRenderer.removeListener('task:log', handler)
  },
  onArtifactNew: (cb) => {
    const handler = (_event: unknown, data: Parameters<typeof cb>[0]) => cb(data)
    ipcRenderer.on('artifact:new', handler)
    return () => ipcRenderer.removeListener('artifact:new', handler)
  },
  onConnectionStatus: (cb) => {
    const handler = (_event: unknown, data: Parameters<typeof cb>[0]) => cb(data)
    ipcRenderer.on('connection:status', handler)
    return () => ipcRenderer.removeListener('connection:status', handler)
  },

  // Window management
  windowDetach: (panelId, options) => ipcRenderer.invoke('window:detach', panelId, options),
  windowReattach: (panelId) => ipcRenderer.invoke('window:reattach', panelId),
  windowListDetached: () => ipcRenderer.invoke('window:list-detached'),
  onWindowReattached: (cb) => {
    const handler = (_event: unknown, panelId: string) => cb(panelId)
    ipcRenderer.on('window:reattached', handler)
    return () => ipcRenderer.removeListener('window:reattached', handler)
  },

  // State sync between windows
  syncState: (data) => ipcRenderer.send('state:sync', data),
  onStateSync: (cb) => {
    const handler = (_event: unknown, data: unknown) => cb(data)
    ipcRenderer.on('state:sync', handler)
    return () => ipcRenderer.removeListener('state:sync', handler)
  },

  // Notifications
  sendNotification: (options) => ipcRenderer.invoke('notify:send', options),

  // Focus main window (from detached windows)
  focusMain: () => ipcRenderer.invoke('window:focus-main'),

  // Connection (per-project)
  projectConnect: (projectId, appConfig?) => ipcRenderer.invoke('project:connect', projectId, appConfig),
  projectDisconnect: (projectId) => ipcRenderer.invoke('project:disconnect', projectId),

  // Connection (legacy / browse mode)
  localConnect: (appConfig?) => ipcRenderer.invoke('local:connect', appConfig),
  sshConnect: (config, appConfig?) => ipcRenderer.invoke('ssh:connect', config, appConfig),
  remoteConnect: (remoteLink, appConfig?) => ipcRenderer.invoke('remote:connect', remoteLink, appConfig),
  sshUpdateEngineConfig: (appConfig) => ipcRenderer.invoke('ssh:update-engine-config', appConfig),
  sshDisconnect: () => ipcRenderer.invoke('ssh:disconnect'),
  sshStatus: () => ipcRenderer.invoke('ssh:status'),
  sshExec: (command) => ipcRenderer.invoke('ssh:exec', command),

  // Agent control
  agentStart: (opts) => ipcRenderer.invoke('agent:start', opts),
  agentStop: (taskId) => ipcRenderer.invoke('agent:stop', taskId),
  agentResume: (taskId) => ipcRenderer.invoke('agent:resume', taskId),
  agentSend: (taskId, message) => ipcRenderer.invoke('agent:send', taskId, message),

  // PTY I/O
  ptyWrite: (taskId, data) => ipcRenderer.send('pty:write', taskId, data),
  ptyResize: (taskId, cols, rows) => ipcRenderer.send('pty:resize', taskId, cols, rows),
  onPtyData: (cb) => {
    const handler = (_event: unknown, data: { taskId: string; data: string }) => cb(data)
    ipcRenderer.on('pty:data', handler)
    return () => ipcRenderer.removeListener('pty:data', handler)
  },
  onPtyClose: (cb) => {
    const handler = (_event: unknown, data: { taskId: string }) => cb(data)
    ipcRenderer.on('pty:close', handler)
    return () => ipcRenderer.removeListener('pty:close', handler)
  },

  // Workspace
  workspaceLoad: () => ipcRenderer.invoke('workspace:load'),
  workspaceSave: (workspace) => ipcRenderer.invoke('workspace:save', workspace),

  // Config
  configLoad: () => ipcRenderer.invoke('config:load'),
  configSave: (config) => ipcRenderer.invoke('config:save', config),

  // Data persistence (projects/phases/tasks)
  dataLoad: () => ipcRenderer.invoke('data:load'),
  dataSave: (data) => ipcRenderer.invoke('data:save', data),

  // File read/upload
  sshReadFile: (filePath) => ipcRenderer.invoke('ssh:read-file', filePath),
  sshUploadFile: (opts) => ipcRenderer.invoke('ssh:upload-file', opts),

  // Remote folder browser
  sshListDir: (path) => ipcRenderer.invoke('ssh:list-dir', path),
  sshMkdir: (path) => ipcRenderer.invoke('ssh:mkdir', path),
  sshHome: () => ipcRenderer.invoke('ssh:home'),

  // Summarize (Claude CLI)
  taskSummarize: (taskId) => ipcRenderer.invoke('task:summarize', taskId),
  phaseSummarize: (phaseId) => ipcRenderer.invoke('phase:summarize', phaseId),
  projectSummarize: (projectId) => ipcRenderer.invoke('project:summarize', projectId),

  // Session Descriptor
  descriptorExport: (projectId) => ipcRenderer.invoke('descriptor:export', projectId),
  descriptorImport: (descriptor) => ipcRenderer.invoke('descriptor:import', descriptor),

  // Window info
  setWindowTitle: (title) => ipcRenderer.send('window:set-title', title),
  getWindowHash: () => window.location.hash.replace('#', ''),
}

contextBridge.exposeInMainWorld('api', api)
