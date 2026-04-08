// ─── Project ───
export interface Project {
  id: string
  name: string
  workspacePath: string
  connection: ConnectionConfig
  settings: ProjectSettings
  createdAt: string
  updatedAt: string
}

export interface ConnectionConfig {
  type: 'local' | 'ssh'
  ssh?: {
    host: string
    port: number
    username: string
    authMethod: 'key' | 'password' | 'agent'
    keyPath?: string
  }
}

export interface ProjectSettings {
  claudeMdPath?: string
  defaultBranch?: string
  autoArtifactScan: boolean
}

// ─── Job ───
export interface Job {
  id: string
  projectId: string
  name: string
  status: JobStatus
  sessionId?: string
  prompt: string
  steps: Step[]
  artifacts: Artifact[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'review'

// ─── Step ───
export interface Step {
  id: string
  jobId: string
  index: number
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  toolCalls: ToolCall[]
  startedAt?: string
  completedAt?: string
}

export interface ToolCall {
  tool: string
  input: Record<string, unknown>
  output?: string
  duration?: number
}

// ─── Artifact ───
export interface Artifact {
  id: string
  jobId: string
  filePath: string
  type: ArtifactType
  action: 'created' | 'modified' | 'deleted'
  detectedAt: string
}

export type ArtifactType =
  | 'code' | 'markdown' | 'yaml' | 'json'
  | 'image' | 'pdf' | 'text' | 'other'

// ─── IPC ───
export interface IpcApi {
  // Project
  projectList(): Promise<Project[]>
  projectCreate(input: CreateProjectInput): Promise<Project>
  projectDelete(id: string): Promise<void>

  // Job
  jobCreate(projectId: string, prompt: string, name?: string): Promise<Job>
  jobList(projectId: string): Promise<Job[]>
  jobSend(jobId: string, message: string): Promise<void>
  jobStop(jobId: string): Promise<void>

  // Events (Main → Renderer)
  onJobStatus(cb: (data: { jobId: string; status: JobStatus }) => void): () => void
  onJobOutput(cb: (data: { jobId: string; text: string }) => void): () => void
  onArtifactNew(cb: (data: { jobId: string; artifact: Artifact }) => void): () => void
}

export interface CreateProjectInput {
  name: string
  workspacePath: string
  connection: ConnectionConfig
}
