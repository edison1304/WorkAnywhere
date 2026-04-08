import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi } from '../../shared/types'

const api: IpcApi = {
  projectList: () => ipcRenderer.invoke('project:list'),
  projectCreate: (input) => ipcRenderer.invoke('project:create', input),
  projectDelete: (id) => ipcRenderer.invoke('project:delete', id),

  jobCreate: (projectId, prompt, name) =>
    ipcRenderer.invoke('job:create', projectId, prompt, name),
  jobList: (projectId) => ipcRenderer.invoke('job:list', projectId),
  jobSend: (jobId, message) => ipcRenderer.invoke('job:send', jobId, message),
  jobStop: (jobId) => ipcRenderer.invoke('job:stop', jobId),

  onJobStatus: (cb) => {
    const handler = (_event: unknown, data: Parameters<typeof cb>[0]) => cb(data)
    ipcRenderer.on('job:status', handler)
    return () => ipcRenderer.removeListener('job:status', handler)
  },
  onJobOutput: (cb) => {
    const handler = (_event: unknown, data: Parameters<typeof cb>[0]) => cb(data)
    ipcRenderer.on('job:output', handler)
    return () => ipcRenderer.removeListener('job:output', handler)
  },
  onArtifactNew: (cb) => {
    const handler = (_event: unknown, data: Parameters<typeof cb>[0]) => cb(data)
    ipcRenderer.on('artifact:new', handler)
    return () => ipcRenderer.removeListener('artifact:new', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
