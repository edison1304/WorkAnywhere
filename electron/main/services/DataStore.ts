import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { Project, Phase, Task, SavedData, CreateProjectInput, LogEntry, Artifact, SyncEventType } from '../../../shared/types'

export interface DataChangeEvent {
  type: SyncEventType
  entityType: 'project' | 'phase' | 'task'
  entityId: string
  payload: any
}

/**
 * DataStore — Project/Phase/Task CRUD with JSON file persistence.
 *
 * Single source of truth for all entity data.
 * Reads from / writes to a JSON file (dataPath).
 * All mutations persist immediately.
 *
 * onChange: called on every local mutation for SyncService to publish.
 * applyRemote: applies remote events without triggering onChange (no echo).
 */
export class DataStore {
  private projects: Project[] = []
  private phases: Phase[] = []
  private tasks: Task[] = []
  private loaded = false
  private _suppressEvents = false
  private _onChangeCallbacks: Array<(event: DataChangeEvent) => void> = []

  constructor(private dataPath: string) {}

  onChange(cb: (event: DataChangeEvent) => void): void {
    this._onChangeCallbacks.push(cb)
  }

  private emitChange(event: DataChangeEvent): void {
    if (this._suppressEvents) return
    for (const cb of this._onChangeCallbacks) cb(event)
  }

  // ─── Remote event application (no echo) ───

  applyRemote(action: 'upsert' | 'delete', entityType: 'project' | 'phase' | 'task', data: any): void {
    this._suppressEvents = true
    try {
      if (action === 'delete') {
        switch (entityType) {
          case 'project': this.projectDelete(data.id); break
          case 'phase': this.phaseDelete(data.id); break
          case 'task': this.taskDelete(data.id); break
        }
      } else {
        switch (entityType) {
          case 'project': {
            const idx = this.projects.findIndex(p => p.id === data.id)
            if (idx >= 0) this.projects[idx] = { ...this.projects[idx], ...data }
            else this.projects.push(data)
            break
          }
          case 'phase': {
            const idx = this.phases.findIndex(ph => ph.id === data.id)
            if (idx >= 0) this.phases[idx] = { ...this.phases[idx], ...data }
            else this.phases.push(data)
            break
          }
          case 'task': {
            const idx = this.tasks.findIndex(t => t.id === data.id)
            if (idx >= 0) this.tasks[idx] = { ...this.tasks[idx], ...data }
            else this.tasks.push(data)
            break
          }
        }
        this.persist()
      }
    } finally {
      this._suppressEvents = false
    }
  }

  applyRemoteLogs(taskId: string, logs: LogEntry[]): void {
    this._suppressEvents = true
    try {
      const task = this.tasks.find(t => t.id === taskId)
      if (!task) return
      const existingIds = new Set(task.logs.map(l => l.id))
      const newLogs = logs.filter(l => !existingIds.has(l.id))
      if (newLogs.length > 0) {
        task.logs.push(...newLogs)
        task.updatedAt = new Date().toISOString()
        this.persist()
      }
    } finally {
      this._suppressEvents = false
    }
  }

  applyRemoteArtifact(taskId: string, artifact: Artifact): void {
    this._suppressEvents = true
    try {
      this.taskAddArtifact(taskId, artifact)
    } finally {
      this._suppressEvents = false
    }
  }

  // ─── Lifecycle ───

  load(): SavedData {
    if (!this.loaded) {
      try {
        if (existsSync(this.dataPath)) {
          const raw: SavedData = JSON.parse(readFileSync(this.dataPath, 'utf-8'))
          this.projects = raw.projects || []
          this.phases = raw.phases || []
          // Reset active tasks to idle on startup (agent processes don't survive restart)
          // Also backfill order field for tasks that don't have one
          const tasksByPhase: Record<string, number> = {}
          this.tasks = (raw.tasks || []).map(t => {
            const status = t.status === 'running' || t.status === 'queued' || t.status === 'waiting'
              ? 'idle' as const : t.status
            if (t.order == null) {
              tasksByPhase[t.phaseId] = (tasksByPhase[t.phaseId] || 0) + 1
              return { ...t, status, order: tasksByPhase[t.phaseId] }
            }
            return status !== t.status ? { ...t, status } : t
          })
        }
      } catch {
        // corrupt file — start fresh
      }
      this.loaded = true
    }
    return { projects: this.projects, phases: this.phases, tasks: this.tasks }
  }

  private persist(): void {
    writeFileSync(
      this.dataPath,
      JSON.stringify({ projects: this.projects, phases: this.phases, tasks: this.tasks }, null, 2)
    )
  }

  // ─── Project CRUD ───

  projectList(): Project[] {
    return this.projects
  }

  projectCreate(input: CreateProjectInput): Project {
    const now = new Date().toISOString()
    const project: Project = {
      id: crypto.randomUUID(),
      name: input.name,
      workspacePath: input.workspacePath,
      connection: input.connection,
      settings: { agentEngine: 'claude', autoArtifactScan: true },
      createdAt: now,
      updatedAt: now,
    }
    this.projects.push(project)
    this.persist()
    this.emitChange({ type: 'entity_upsert', entityType: 'project', entityId: project.id, payload: project })
    return project
  }

  projectUpdate(id: string, patch: Partial<Project>): Project | null {
    const idx = this.projects.findIndex(p => p.id === id)
    if (idx === -1) return null
    this.projects[idx] = {
      ...this.projects[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    }
    this.persist()
    this.emitChange({ type: 'entity_upsert', entityType: 'project', entityId: id, payload: this.projects[idx] })
    return this.projects[idx]
  }

  projectDelete(id: string): void {
    this.tasks = this.tasks.filter(t => t.projectId !== id)
    this.phases = this.phases.filter(ph => ph.projectId !== id)
    this.projects = this.projects.filter(p => p.id !== id)
    this.persist()
    this.emitChange({ type: 'entity_delete', entityType: 'project', entityId: id, payload: null })
  }

  // ─── Phase CRUD ───

  phaseList(projectId: string): Phase[] {
    return this.phases.filter(ph => ph.projectId === projectId)
  }

  phaseCreate(projectId: string, name: string, description?: string): Phase {
    const now = new Date().toISOString()
    const order = this.phases.filter(ph => ph.projectId === projectId).length + 1
    const phase: Phase = {
      id: crypto.randomUUID(),
      projectId,
      name,
      description,
      order,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    this.phases.push(phase)
    this.persist()
    this.emitChange({ type: 'entity_upsert', entityType: 'phase', entityId: phase.id, payload: phase })
    return phase
  }

  phaseUpdate(id: string, patch: Partial<Phase>): Phase | null {
    const idx = this.phases.findIndex(ph => ph.id === id)
    if (idx === -1) return null
    this.phases[idx] = {
      ...this.phases[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    }
    this.persist()
    this.emitChange({ type: 'entity_upsert', entityType: 'phase', entityId: id, payload: this.phases[idx] })
    return this.phases[idx]
  }

  phaseDelete(id: string): void {
    this.tasks = this.tasks.filter(t => t.phaseId !== id)
    this.phases = this.phases.filter(ph => ph.id !== id)
    this.persist()
    this.emitChange({ type: 'entity_delete', entityType: 'phase', entityId: id, payload: null })
  }

  // ─── Task CRUD ───

  taskList(phaseId: string): Task[] {
    return this.tasks.filter(t => t.phaseId === phaseId)
  }

  taskGet(id: string): Task | null {
    return this.tasks.find(t => t.id === id) || null
  }

  taskCreate(phaseId: string, name: string, purpose: string, prompt: string): Task {
    const phase = this.phases.find(ph => ph.id === phaseId)
    const now = new Date().toISOString()
    const order = this.tasks.filter(t => t.phaseId === phaseId).length + 1
    const task: Task = {
      id: crypto.randomUUID(),
      phaseId,
      projectId: phase?.projectId || '',
      name,
      purpose,
      order,
      status: 'idle',
      prompt,
      logs: [],
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.push(task)
    this.persist()
    this.emitChange({ type: 'entity_upsert', entityType: 'task', entityId: task.id, payload: task })
    return task
  }

  taskUpdate(id: string, patch: Partial<Task>): Task | null {
    const idx = this.tasks.findIndex(t => t.id === id)
    if (idx === -1) return null
    this.tasks[idx] = {
      ...this.tasks[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    }
    this.persist()
    // For status changes, emit a specific event type for efficiency
    if (patch.status) {
      this.emitChange({ type: 'task_status', entityType: 'task', entityId: id, payload: { status: patch.status } })
    } else {
      this.emitChange({ type: 'entity_upsert', entityType: 'task', entityId: id, payload: this.tasks[idx] })
    }
    return this.tasks[idx]
  }

  taskDelete(id: string): void {
    this.tasks = this.tasks.filter(t => t.id !== id)
    this.persist()
    this.emitChange({ type: 'entity_delete', entityType: 'task', entityId: id, payload: null })
  }

  taskAddLog(taskId: string, log: LogEntry): void {
    const task = this.tasks.find(t => t.id === taskId)
    if (task) {
      task.logs.push(log)
      task.updatedAt = new Date().toISOString()
      this.persist()
      // Log appends are high-volume — emit for SyncService to batch
      this.emitChange({ type: 'task_log_append', entityType: 'task', entityId: taskId, payload: log })
    }
  }

  taskAddArtifact(taskId: string, artifact: Artifact): void {
    const task = this.tasks.find(t => t.id === taskId)
    if (task) {
      const idx = task.artifacts.findIndex(a => a.filePath === artifact.filePath)
      if (idx >= 0) {
        task.artifacts[idx] = { ...artifact, action: 'modified' }
      } else {
        task.artifacts.push(artifact)
      }
      task.updatedAt = new Date().toISOString()
      this.persist()
      this.emitChange({ type: 'task_artifact', entityType: 'task', entityId: taskId, payload: artifact })
    }
  }

  // ─── Reorder ───

  taskReorder(phaseId: string, orderedIds: string[]): void {
    orderedIds.forEach((id, i) => {
      const task = this.tasks.find(t => t.id === id)
      if (task && task.phaseId === phaseId) {
        task.order = i + 1
        task.updatedAt = new Date().toISOString()
      }
    })
    this.persist()
  }

  phaseReorder(projectId: string, orderedIds: string[]): void {
    orderedIds.forEach((id, i) => {
      const phase = this.phases.find(ph => ph.id === id)
      if (phase && phase.projectId === projectId) {
        phase.order = i + 1
        phase.updatedAt = new Date().toISOString()
      }
    })
    this.persist()
  }

  // ─── Bulk operations (for legacy compatibility) ───

  getAll(): SavedData {
    return { projects: this.projects, phases: this.phases, tasks: this.tasks }
  }

  replaceAll(data: SavedData): void {
    this.projects = data.projects || []
    this.phases = data.phases || []
    this.tasks = data.tasks || []
    this.persist()
  }
}
