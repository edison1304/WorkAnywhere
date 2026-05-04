/**
 * WorkflowFileService — creates and reads the per-entity plan files
 * (PLAN.md / CHECKLIST.md / NOTES.md) on the workspace's filesystem
 * via the active connection (local or SSH).
 *
 * Design:
 *   - File creation is *idempotent* and *non-destructive*. If a file
 *     already exists we never overwrite. Skeletons only fill empty slots.
 *   - All writes are best-effort. A failure here must never block agent
 *     execution — the workflow is a soft scaffold.
 *   - Caller-side: invoked when entities are created / renamed and just
 *     before agent runs (to ensure files exist).
 */

import type { Project, Phase, Task } from '../../../shared/types'
import type { ConnectionManager } from './ConnectionManager'
import {
  rootDir, plansDir, projectDir, phaseDir, taskDir,
  claudeMdPath, planFile, checklistFile, notesFile,
} from './workflowPaths'
import { WORKFLOW_CLAUDE_MD } from './workflowTemplate'

export class WorkflowFileService {
  constructor(
    private connMgr: ConnectionManager,
    private getProject: (projectId: string) => Project | null,
  ) {}

  // ─── Skeletons ────────────────────────────────────────

  private projectPlanSkeleton(p: Project): string {
    return `# Project Plan — ${p.name}

## Vision
(왜 이 프로젝트인가, 한 단락)

## Milestones
- [ ] (큰 단위 5-10개)

## Notes
(프로젝트 레벨 결정·맥락)
`
  }

  private projectChecklistSkeleton(p: Project): string {
    return `# Checklist — ${p.name}

(이 프로젝트가 끝나려면 무엇이 다 되어야 하는지. phase 단위로 적습니다.)

- [ ] phase 1
- [ ] phase 2
`
  }

  private projectNotesSkeleton(p: Project): string {
    return `# Notes — ${p.name}

(프로젝트 진행 중 결정·교훈을 누적. \`↳ <decision> — <reason>\` 형식 권장.)
`
  }

  private phasePlanSkeleton(ph: Phase): string {
    return `# Phase Plan — ${ph.name}

## Goal
(이 phase가 끝나면 무엇이 변하는가, 한 단락)

## Approach
(어떻게 풀 것인가, 짧게)
`
  }

  private phaseChecklistSkeleton(ph: Phase): string {
    return `# Checklist — ${ph.name}

- [ ] task 1
- [ ] task 2
`
  }

  private phaseNotesSkeleton(ph: Phase): string {
    return `# Notes — ${ph.name}
`
  }

  private taskPlanSkeleton(t: Task): string {
    return `# Task Plan — ${t.name}

## Design
${t.purpose ? `**Purpose:** ${t.purpose}\n\n` : ''}(무엇을, 왜, 어떻게 — 한 단락)

## Approach
(단계 분해의 근거. 대안과 trade-off가 있다면 짧게.)
`
  }

  private taskChecklistSkeleton(_t: Task): string {
    return `# Checklist

- [ ] (실행 첫 단계)
- [ ] (단계마다 완료 시 [x] 처리)
`
  }

  private taskNotesSkeleton(_t: Task): string {
    return `# Notes

(judgment log — \`↳ <decision> — <reason>\`)

(retrospective — 완료 후 한 단락)
`
  }

  // ─── Connection helpers ──────────────────────────────

  private async getConn(projectId: string) {
    const project = this.getProject(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    return this.connMgr.getConnection(project)
  }

  /** Quote a path safely for shell (single-quote with escaping). */
  private q(p: string): string {
    return `'${p.replace(/'/g, "'\\''")}'`
  }

  /** mkdir -p and write file only if missing — base64 transport for safety. */
  private async writeIfMissing(projectId: string, path: string, content: string): Promise<void> {
    try {
      const conn = await this.getConn(projectId)
      const dir = path.substring(0, path.lastIndexOf('/'))
      const b64 = Buffer.from(content, 'utf-8').toString('base64')
      // mkdir -p, then write only if file does not exist
      const cmd = `mkdir -p ${this.q(dir)} && [ -f ${this.q(path)} ] || (echo '${b64}' | base64 -d > ${this.q(path)})`
      await conn.exec(cmd)
    } catch {
      // soft scaffold — failures must not block
    }
  }

  /** Read a file's content (returns empty string on any failure). */
  async readFile(projectId: string, path: string): Promise<string> {
    try {
      const conn = await this.getConn(projectId)
      const out = await conn.exec(`[ -f ${this.q(path)} ] && cat ${this.q(path)} || true`)
      return out
    } catch {
      return ''
    }
  }

  /** Overwrite a file with content. Best-effort. mkdir -p the parent. */
  async writeFile(projectId: string, path: string, content: string): Promise<void> {
    try {
      const conn = await this.getConn(projectId)
      const dir = path.substring(0, path.lastIndexOf('/'))
      const b64 = Buffer.from(content, 'utf-8').toString('base64')
      await conn.exec(`mkdir -p ${this.q(dir)} && echo '${b64}' | base64 -d > ${this.q(path)}`)
    } catch {
      // soft scaffold
    }
  }

  /** Append content to a file (creating it if absent). Best-effort. */
  async appendFile(projectId: string, path: string, content: string): Promise<void> {
    try {
      const conn = await this.getConn(projectId)
      const dir = path.substring(0, path.lastIndexOf('/'))
      const b64 = Buffer.from(content, 'utf-8').toString('base64')
      await conn.exec(`mkdir -p ${this.q(dir)} && echo '${b64}' | base64 -d >> ${this.q(path)}`)
    } catch {
      // soft scaffold
    }
  }

  // ─── Public: ensure files exist ───────────────────────

  async ensureWorkspace(projectId: string, workspacePath: string): Promise<void> {
    try {
      const conn = await this.getConn(projectId)
      await conn.exec(`mkdir -p ${this.q(plansDir(workspacePath))}`)
      await this.writeIfMissing(projectId, claudeMdPath(workspacePath), WORKFLOW_CLAUDE_MD)
    } catch {
      // soft
    }
  }

  async ensureProject(project: Project): Promise<void> {
    const dir = projectDir(project.workspacePath, project)
    await this.ensureWorkspace(project.id, project.workspacePath)
    await this.writeIfMissing(project.id, planFile(dir), this.projectPlanSkeleton(project))
    await this.writeIfMissing(project.id, checklistFile(dir), this.projectChecklistSkeleton(project))
    await this.writeIfMissing(project.id, notesFile(dir), this.projectNotesSkeleton(project))
  }

  async ensurePhase(project: Project, phase: Phase): Promise<void> {
    await this.ensureProject(project)
    const dir = phaseDir(project.workspacePath, project, phase)
    await this.writeIfMissing(project.id, planFile(dir), this.phasePlanSkeleton(phase))
    await this.writeIfMissing(project.id, checklistFile(dir), this.phaseChecklistSkeleton(phase))
    await this.writeIfMissing(project.id, notesFile(dir), this.phaseNotesSkeleton(phase))
  }

  async ensureTask(project: Project, phase: Phase, task: Task): Promise<void> {
    await this.ensurePhase(project, phase)
    const dir = taskDir(project.workspacePath, project, phase, task)
    await this.writeIfMissing(project.id, planFile(dir), this.taskPlanSkeleton(task))
    await this.writeIfMissing(project.id, checklistFile(dir), this.taskChecklistSkeleton(task))
    await this.writeIfMissing(project.id, notesFile(dir), this.taskNotesSkeleton(task))
  }

  // ─── Read for prefix injection ────────────────────────

  /**
   * Build the prompt prefix injected ahead of every task run.
   * Layered: project plan summary → phase plan summary → full task PLAN +
   * CHECKLIST + recent NOTES tail. Token-conscious — long sections truncated.
   */
  async buildPrefix(project: Project, phase: Phase, task: Task): Promise<string> {
    const projDir = projectDir(project.workspacePath, project)
    const phDir = phaseDir(project.workspacePath, project, phase)
    const tDir = taskDir(project.workspacePath, project, phase, task)

    const [projPlan, projCheck, phPlan, phCheck, tPlan, tCheck, tNotes] = await Promise.all([
      this.readFile(project.id, planFile(projDir)),
      this.readFile(project.id, checklistFile(projDir)),
      this.readFile(project.id, planFile(phDir)),
      this.readFile(project.id, checklistFile(phDir)),
      this.readFile(project.id, planFile(tDir)),
      this.readFile(project.id, checklistFile(tDir)),
      this.readFile(project.id, notesFile(tDir)),
    ])

    const lines: string[] = []
    lines.push(`# Workflow context (orchestrator-injected — read once, reference as needed)`)
    lines.push('')

    // Project — short summary only
    if (projPlan.trim() || projCheck.trim()) {
      lines.push(`## Project: ${project.name}`)
      if (projPlan.trim()) lines.push(this.headSummary(projPlan, 12))
      if (projCheck.trim()) lines.push(`### Checklist progress`, this.checkProgress(projCheck))
      lines.push('')
    }

    // Phase — short summary
    if (phPlan.trim() || phCheck.trim()) {
      lines.push(`## Phase: ${phase.name}`)
      if (phPlan.trim()) lines.push(this.headSummary(phPlan, 16))
      if (phCheck.trim()) lines.push(`### Checklist progress`, this.checkProgress(phCheck))
      lines.push('')
    }

    // Task — full
    lines.push(`## Task: ${task.name}`)
    lines.push(`Files: ${planFile(tDir)} · ${checklistFile(tDir)} · ${notesFile(tDir)}`)
    if (tPlan.trim()) {
      lines.push(`### Plan`)
      lines.push(this.truncate(tPlan, 2400))
    }
    if (tCheck.trim()) {
      lines.push(`### Checklist`)
      lines.push(this.truncate(tCheck, 1600))
    }
    if (tNotes.trim()) {
      lines.push(`### Recent notes`)
      lines.push(this.tail(tNotes, 1600))
    }

    lines.push('')
    lines.push(`Update CHECKLIST.md (mark items \`- [x]\`) and append decisions to NOTES.md as you work. Keep design / approach in PLAN.md current.`)
    lines.push('')

    return lines.join('\n')
  }

  // ─── Internal: text shaping ──────────────────────────

  private headSummary(text: string, maxLines: number): string {
    const lines = text.split('\n').filter(l => l.trim()).slice(0, maxLines)
    return lines.join('\n')
  }

  private checkProgress(checkText: string): string {
    const items = checkText.match(/^\s*-\s*\[(x|X| )\]/gm) ?? []
    const done = items.filter(s => /\[(x|X)\]/.test(s)).length
    return `${done}/${items.length} 완료`
  }

  private truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + '\n... (생략)'
  }

  private tail(text: string, max: number): string {
    return text.length <= max ? text : '... (생략)\n' + text.slice(-max)
  }
}
