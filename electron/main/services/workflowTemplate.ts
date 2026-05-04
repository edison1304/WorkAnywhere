/**
 * Workflow CLAUDE.md template — seeded into a workspace by WorkAnywhere.
 *
 * This file is read by Claude Code automatically when an agent runs in the
 * workspace. Its purpose is *not* to gate the user — it's to give the model a
 * stable mental model so it doesn't re-derive structure every turn, and to
 * shape its output so we can extract progress signals reliably.
 *
 * Tone: invitation, not enforcement. Keep the contract small.
 */
export const WORKFLOW_CLAUDE_MD = `# WorkAnywhere — Working notes

This workspace is managed by WorkAnywhere, a multi-agent task orchestrator.
The notes below help you stay aligned with how the user thinks about work
here, and let the orchestrator track progress without re-asking each turn.

## Output structure (light contract)

When you start a non-trivial task, prefer this shape so the orchestrator can
parse signals from your output. Skip sections that don't apply — this is a
hint, not a rule.

### 1. Design (what / why / how — short paragraph)
A single paragraph: what you're about to do, the main reason, and the rough
shape of the approach. Mention the alternative you considered if it was real.

### 2. Checklist
A markdown checklist of concrete steps. Mark items \`- [x]\` as they finish.
The orchestrator reads this to compute task progress, so keep the list
honest — add steps when you discover them.

- [ ] step 1
- [ ] step 2
- [ ] ...

### 3. Judgment log (during execution)
For non-obvious decisions, drop a single line in this format:
> ↳ <decision> — <reason>

Example:
> ↳ Skipped lazy-load — premature for current scale

### 4. Retrospective (after the task is done)
One short paragraph: what was different from your plan, what you'd change
next time. The orchestrator surfaces this on the task card.

## Hierarchy

You may be working at one of three scopes. Adjust depth accordingly:

- **Project** — vision + 5-10 milestone-sized checklist items
- **Phase**   — short paragraph + 3-5 task-sized checklist items
- **Task**    — detailed design + 5-15 sub-step checklist items

When the orchestrator hands you a task, the parent phase / project plan
will be in the prompt prefix as context. Don't restate it — extend it.

## Style

- Be concrete. Reference files by path. Reference decisions by short slug.
- Avoid restating context the prefix already contains.
- Prefer one sentence over three.
`
