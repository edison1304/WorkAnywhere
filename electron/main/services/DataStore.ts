import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { Project, Phase, Task, SavedData, CreateProjectInput } from '../../../shared/types'

/**
 * DataStore — Project/Phase/Task CRUD with JSON file persistence.
 *
 * Single source of truth for all entity data.
 * Reads from / writes to a JSON file (dataPath).
 * All mutations persist immediately.
 */
export class DataStore {
  private projects: Project[] = []
  private phases: Phase[] = []
  private tasks: Task[] = []
  private loaded = false

  constructor(private dataPath: string) {}

  // ─── Lifecycle ───

  load(): SavedData {
    if (!this.loaded) {
      try {
        if (existsSync(this.dataPath)) {
          const raw: SavedData = JSON.parse(readFileSync(this.dataPath, 'utf-8'))
          this.projects = raw.projects || []
          this.phases = raw.phases || []
          // Reset active tasks to idle on startup (agent processes don't survive restart)
          this.tasks = (raw.tasks || []).map(t =>
            t.status === 'running' || t.status === 'queued' || t.status === 'waiting'
              ? { ...t, status: 'idle' as const }
              : t
          )
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
    return project
  }

  projectUpdate(id: string, patch: Partial<Project>): Project | null {
    const idx = this.projects.findIndex(p => p.id === id)
    if (idx === -1) return null
    this.projects[idx] = {
      ...this.projects[idx],
      ...patch,
      id, // prevent id overwrite
      updatedAt: new Date().toISOString(),
    }
    this.persist()
    return this.projects[idx]
  }

  projectDelete(id: string): void {
    // Cascade: delete phases and tasks belonging to this project
    const phaseIds = this.phases.filter(ph => ph.projectId === id).map(ph => ph.id)
    this.tasks = this.tasks.filter(t => t.projectId !== id)
    this.phases = this.phases.filter(ph => ph.projectId !== id)
    this.projects = this.projects.filter(p => p.id !== id)
    this.persist()
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
    return phase
  }

  phaseUpdate(id: string, patch: Partial<Phase>): Phase | null {
    const idx = this.phases.findIndex(ph => ph.id === id)
    if (idx === -1) return null
    this.phases[idx] = {
      ...this.phases[idx],
      ...patch,
      id, // prevent id overwrite
      updatedAt: new Date().toISOString(),
    }
    this.persist()
    return this.phases[idx]
  }

  phaseDelete(id: string): void {
    // Cascade: delete tasks belonging to this phase
    this.tasks = this.tasks.filter(t => t.phaseId !== id)
    this.phases = this.phases.filter(ph => ph.id !== id)
    this.persist()
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
    const task: Task = {
      id: crypto.randomUUID(),
      phaseId,
      projectId: phase?.projectId || '',
      name,
      purpose,
      status: 'idle',
      prompt,
      logs: [],
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.push(task)
    this.persist()
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
    return this.tasks[idx]
  }

  taskDelete(id: string): void {
    this.tasks = this.tasks.filter(t => t.id !== id)
    this.persist()
  }

  taskAddLog(taskId: string, log: import('../../../shared/types').LogEntry): void {
    const task = this.tasks.find(t => t.id === taskId)
    if (task) {
      task.logs.push(log)
      task.updatedAt = new Date().toISOString()
      this.persist()
    }
  }

  taskAddArtifact(taskId: string, artifact: import('../../../shared/types').Artifact): void {
    const task = this.tasks.find(t => t.id === taskId)
    if (task) {
      // Update existing artifact for same filePath, or add new
      const idx = task.artifacts.findIndex(a => a.filePath === artifact.filePath)
      if (idx >= 0) {
        task.artifacts[idx] = { ...artifact, action: 'modified' }
      } else {
        task.artifacts.push(artifact)
      }
      task.updatedAt = new Date().toISOString()
      this.persist()
    }
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
