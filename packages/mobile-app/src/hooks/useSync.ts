import { useState, useEffect, useCallback, useRef } from 'react'
import type { Project, Phase, Task, LogEntry, Artifact, Plan, TaskStatus, SavedData } from '@shared/types'
import type { WsServerEvent } from '@shared/apiContract'
import type { GatewayClient } from '../api/client'

interface SyncState {
  projects: Project[]
  phases: Phase[]
  tasks: Task[]
  connected: boolean
  loading: boolean
}

/**
 * useSync — real-time state sync via WebSocket.
 * Platform-agnostic (works in both React DOM and React Native).
 */
export function useSync(client: GatewayClient | null) {
  const [state, setState] = useState<SyncState>({
    projects: [], phases: [], tasks: [],
    connected: false, loading: true,
  })

  useEffect(() => {
    if (!client) return
    client.dataLoad().then((data: SavedData) => {
      setState(prev => ({
        ...prev,
        projects: data.projects || [],
        phases: data.phases || [],
        tasks: data.tasks || [],
        loading: false,
      }))
      client.connectSync(0)
    }).catch(() => {
      setState(prev => ({ ...prev, loading: false }))
    })
    return () => client.disconnectSync()
  }, [client])

  useEffect(() => {
    if (!client) return
    const unsubs: Array<() => void> = []

    unsubs.push(client.on('connected', () => {
      setState(prev => ({ ...prev, connected: true }))
    }))
    unsubs.push(client.on('disconnected', () => {
      setState(prev => ({ ...prev, connected: false }))
    }))

    unsubs.push(client.on('sync', (event: WsServerEvent & { type: 'sync' }) => {
      const se = event.event
      setState(prev => {
        switch (se.type) {
          case 'entity_upsert': return applyUpsert(prev, se.entityType, se.payload)
          case 'entity_delete': return applyDelete(prev, se.entityType, se.entityId)
          case 'task_log_append': return applyLogAppend(prev, se.entityId, se.payload)
          case 'task_status': return applyTaskStatus(prev, se.entityId, se.payload.status)
          case 'task_artifact': return applyArtifact(prev, se.entityId, se.payload)
          default: return prev
        }
      })
    }))

    unsubs.push(client.on('task:log', (e: { taskId: string; log: LogEntry }) => {
      setState(prev => applyLogAppend(prev, e.taskId, [e.log]))
    }))
    unsubs.push(client.on('task:status', (e: { taskId: string; status: TaskStatus }) => {
      setState(prev => applyTaskStatus(prev, e.taskId, e.status))
    }))
    unsubs.push(client.on('artifact:new', (e: { taskId: string; artifact: Artifact }) => {
      setState(prev => applyArtifact(prev, e.taskId, e.artifact))
    }))
    unsubs.push(client.on('task:plan', (e: { taskId: string; plan: Plan }) => {
      setState(prev => ({
        ...prev,
        tasks: prev.tasks.map(t =>
          t.id === e.taskId ? { ...t, plan: e.plan, updatedAt: new Date().toISOString() } : t
        ),
      }))
    }))

    return () => unsubs.forEach(fn => fn())
  }, [client])

  const refreshData = useCallback(async () => {
    if (!client) return
    try {
      const data = await client.dataLoad()
      setState(prev => ({
        ...prev,
        projects: data.projects || [],
        phases: data.phases || [],
        tasks: data.tasks || [],
      }))
    } catch { /* ignore */ }
  }, [client])

  return { ...state, refreshData }
}

// ─── Pure state transforms ───

function applyUpsert(state: SyncState, entityType: string, payload: any): SyncState {
  switch (entityType) {
    case 'project': {
      const idx = state.projects.findIndex(p => p.id === payload.id)
      const projects = [...state.projects]
      if (idx >= 0) projects[idx] = { ...projects[idx], ...payload }
      else projects.push(payload)
      return { ...state, projects }
    }
    case 'phase': {
      const idx = state.phases.findIndex(ph => ph.id === payload.id)
      const phases = [...state.phases]
      if (idx >= 0) phases[idx] = { ...phases[idx], ...payload }
      else phases.push(payload)
      return { ...state, phases }
    }
    case 'task': {
      const idx = state.tasks.findIndex(t => t.id === payload.id)
      const tasks = [...state.tasks]
      if (idx >= 0) tasks[idx] = { ...tasks[idx], ...payload }
      else tasks.push(payload)
      return { ...state, tasks }
    }
    default: return state
  }
}

function applyDelete(state: SyncState, entityType: string, entityId: string): SyncState {
  switch (entityType) {
    case 'project': return {
      ...state,
      projects: state.projects.filter(p => p.id !== entityId),
      phases: state.phases.filter(ph => ph.projectId !== entityId),
      tasks: state.tasks.filter(t => t.projectId !== entityId),
    }
    case 'phase': return {
      ...state,
      phases: state.phases.filter(ph => ph.id !== entityId),
      tasks: state.tasks.filter(t => t.phaseId !== entityId),
    }
    case 'task': return { ...state, tasks: state.tasks.filter(t => t.id !== entityId) }
    default: return state
  }
}

function applyLogAppend(state: SyncState, taskId: string, logs: LogEntry[]): SyncState {
  return {
    ...state,
    tasks: state.tasks.map(t => {
      if (t.id !== taskId) return t
      const existingIds = new Set(t.logs.map(l => l.id))
      const newLogs = (Array.isArray(logs) ? logs : [logs]).filter(l => !existingIds.has(l.id))
      if (newLogs.length === 0) return t
      return { ...t, logs: [...t.logs, ...newLogs], updatedAt: new Date().toISOString() }
    }),
  }
}

function applyTaskStatus(state: SyncState, taskId: string, status: TaskStatus): SyncState {
  return {
    ...state,
    tasks: state.tasks.map(t =>
      t.id === taskId ? { ...t, status, updatedAt: new Date().toISOString() } : t
    ),
  }
}

function applyArtifact(state: SyncState, taskId: string, artifact: Artifact): SyncState {
  return {
    ...state,
    tasks: state.tasks.map(t => {
      if (t.id !== taskId) return t
      const idx = t.artifacts.findIndex(a => a.filePath === artifact.filePath)
      const artifacts = [...t.artifacts]
      if (idx >= 0) artifacts[idx] = { ...artifact, action: 'modified' }
      else artifacts.push(artifact)
      return { ...t, artifacts, updatedAt: new Date().toISOString() }
    }),
  }
}
