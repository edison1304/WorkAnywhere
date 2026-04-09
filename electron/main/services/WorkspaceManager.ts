import type { SSHService } from './SSHService'

/**
 * Server-side workspace config at ~/.workanywhere/workspace.json
 * Managed by Main Claude or by the app directly via SSH
 */
export interface ServerWorkspace {
  version: 1
  projects: ServerProject[]
}

export interface ServerProject {
  id: string
  name: string
  path: string                    // workspace path on server
  phases: ServerPhase[]
}

export interface ServerPhase {
  id: string
  name: string
  description?: string
  tasks: ServerTask[]
}

export interface ServerTask {
  id: string
  name: string
  prompt: string
  status: 'idle' | 'running' | 'completed' | 'failed'
  claudeSessionId?: string        // Claude Code session ID for --resume
  remoteLink?: string             // Remote control link (for method 1)
  lastRunAt?: string
  completedAt?: string
}

const WORKSPACE_DIR = '~/.workanywhere'
const WORKSPACE_FILE = `${WORKSPACE_DIR}/workspace.json`

export class WorkspaceManager {
  constructor(private ssh: SSHService) {}

  async init(): Promise<void> {
    await this.ssh.exec(`mkdir -p ${WORKSPACE_DIR}`)
    // Create workspace.json if it doesn't exist
    const exists = await this.ssh.exec(`test -f ${WORKSPACE_FILE} && echo "yes" || echo "no"`)
    if (exists.trim() === 'no') {
      const initial: ServerWorkspace = { version: 1, projects: [] }
      await this.ssh.writeFile(
        WORKSPACE_FILE.replace('~', await this.getHome()),
        JSON.stringify(initial, null, 2)
      )
    }
  }

  private async getHome(): Promise<string> {
    return (await this.ssh.exec('echo $HOME')).trim()
  }

  private async getWorkspacePath(): Promise<string> {
    const home = await this.getHome()
    return WORKSPACE_FILE.replace('~', home)
  }

  async load(): Promise<ServerWorkspace> {
    const path = await this.getWorkspacePath()
    const content = await this.ssh.readFile(path)
    try {
      return JSON.parse(content) as ServerWorkspace
    } catch {
      return { version: 1, projects: [] }
    }
  }

  async save(workspace: ServerWorkspace): Promise<void> {
    const path = await this.getWorkspacePath()
    await this.ssh.writeFile(path, JSON.stringify(workspace, null, 2))
  }

  // ─── Project CRUD ───
  async addProject(id: string, name: string, path: string): Promise<ServerWorkspace> {
    const ws = await this.load()
    ws.projects.push({ id, name, path, phases: [] })
    await this.save(ws)
    return ws
  }

  // ─── Phase CRUD ───
  async addPhase(projectId: string, phase: ServerPhase): Promise<ServerWorkspace> {
    const ws = await this.load()
    const project = ws.projects.find(p => p.id === projectId)
    if (project) {
      project.phases.push(phase)
      await this.save(ws)
    }
    return ws
  }

  // ─── Task CRUD ───
  async addTask(projectId: string, phaseId: string, task: ServerTask): Promise<ServerWorkspace> {
    const ws = await this.load()
    const project = ws.projects.find(p => p.id === projectId)
    const phase = project?.phases.find(ph => ph.id === phaseId)
    if (phase) {
      phase.tasks.push(task)
      await this.save(ws)
    }
    return ws
  }

  async updateTask(
    projectId: string, phaseId: string, taskId: string,
    patch: Partial<ServerTask>
  ): Promise<ServerWorkspace> {
    const ws = await this.load()
    const project = ws.projects.find(p => p.id === projectId)
    const phase = project?.phases.find(ph => ph.id === phaseId)
    const task = phase?.tasks.find(t => t.id === taskId)
    if (task) {
      Object.assign(task, patch)
      await this.save(ws)
    }
    return ws
  }

  // ─── Claude session management ───
  async listClaudeSessions(): Promise<string> {
    // List active claude sessions on server
    return this.ssh.exec('claude sessions list 2>/dev/null || echo "[]"')
  }
}
