/**
 * workflowPaths — path & slug helpers for the per-entity workflow file tree.
 *
 * Layout under workspace:
 *   .workanywhere/
 *     CLAUDE.md                                # workflow guide
 *     plans/<project>/PLAN.md|CHECKLIST.md|NOTES.md
 *                    /<phase>/...
 *                            /<task>/...
 *
 * Slug format: <kebab-name>-<id8>. The id suffix makes the slug stable
 * across rename and unique against name collisions.
 */
import type { Project, Phase, Task } from '../../../shared/types'

const ROOT_SUBDIR = '.workanywhere'
const PLANS_SUBDIR = 'plans'

function kebab(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip combining marks
    .replace(/[\\/]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-') // keep letters/digits (incl. Korean)
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    || 'unnamed'
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

export function projectSlug(project: Project): string {
  return `${kebab(project.name)}-${shortId(project.id)}`
}

export function phaseSlug(phase: Phase): string {
  return `${kebab(phase.name)}-${shortId(phase.id)}`
}

export function taskSlug(task: Task): string {
  return `${kebab(task.name)}-${shortId(task.id)}`
}

// ─── Absolute paths inside the workspace (forward-slash, posix style) ───

export function rootDir(workspacePath: string): string {
  return `${workspacePath}/${ROOT_SUBDIR}`
}

export function plansDir(workspacePath: string): string {
  return `${rootDir(workspacePath)}/${PLANS_SUBDIR}`
}

export function projectDir(workspacePath: string, project: Project): string {
  return `${plansDir(workspacePath)}/${projectSlug(project)}`
}

export function phaseDir(workspacePath: string, project: Project, phase: Phase): string {
  return `${projectDir(workspacePath, project)}/${phaseSlug(phase)}`
}

export function taskDir(workspacePath: string, project: Project, phase: Phase, task: Task): string {
  return `${phaseDir(workspacePath, project, phase)}/${taskSlug(task)}`
}

export function claudeMdPath(workspacePath: string): string {
  return `${rootDir(workspacePath)}/CLAUDE.md`
}

export function planFile(dir: string): string      { return `${dir}/PLAN.md` }
export function checklistFile(dir: string): string { return `${dir}/CHECKLIST.md` }
export function notesFile(dir: string): string     { return `${dir}/NOTES.md` }
