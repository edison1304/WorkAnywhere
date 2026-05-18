import { Router } from 'express'
import type { DataStore } from '../../../../electron/main/services/DataStore'
import type { GatewaySync } from '../services/GatewaySync'
import type { AgentBridge } from '../services/AgentBridge'

export function taskRoutes(dataStore: DataStore, sync: GatewaySync, agent: AgentBridge): Router {
  const r = Router()

  r.get('/', (req, res) => {
    const phaseId = req.query.phaseId as string
    if (!phaseId) {
      res.status(400).json({ success: false, error: 'phaseId query param required' })
      return
    }
    res.json({ success: true, data: dataStore.taskList(phaseId) })
  })

  r.post('/', (req, res) => {
    const { phaseId, name, purpose, prompt } = req.body
    try {
      const task = dataStore.taskCreate(phaseId, name, purpose, prompt)
      sync.publishEvent('entity_upsert', 'task', task.id, task)
      res.json({ success: true, data: task })
    } catch (err) {
      res.status(400).json({ success: false, error: String(err) })
    }
  })

  r.put('/:id', (req, res) => {
    const task = dataStore.taskUpdate(req.params.id, req.body)
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' })
      return
    }
    sync.publishEvent('entity_upsert', 'task', task.id, task)
    res.json({ success: true, data: task })
  })

  r.delete('/:id', (req, res) => {
    dataStore.taskDelete(req.params.id)
    sync.publishEvent('entity_delete', 'task', req.params.id, null)
    res.json({ success: true })
  })

  r.post('/reorder', (req, res) => {
    const { phaseId, orderedIds } = req.body
    dataStore.taskReorder(phaseId, orderedIds)
    res.json({ success: true })
  })

  // ── Agent interaction ──

  r.post('/:id/run', async (req, res) => {
    const task = dataStore.taskGet(req.params.id)
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' })
      return
    }
    const project = dataStore.projectList().find(p => p.id === task.projectId)
    const result = await agent.start({
      projectId: task.projectId,
      phaseId: task.phaseId,
      taskId: task.id,
      workspacePath: project?.workspacePath || '~',
      prompt: task.prompt,
    })
    if (result.success) {
      dataStore.taskUpdate(task.id, { status: 'running' })
      sync.publishEvent('task_status', 'task', task.id, { status: 'running' })
    }
    res.json(result)
  })

  r.post('/:id/stop', async (req, res) => {
    const result = await agent.stop(req.params.id)
    if (result.success) {
      dataStore.taskUpdate(req.params.id, { status: 'failed' })
      sync.publishEvent('task_status', 'task', req.params.id, { status: 'failed' })
    }
    res.json(result)
  })

  r.post('/:id/send', async (req, res) => {
    const { message } = req.body
    const result = await agent.send(req.params.id, message)
    res.json(result)
  })

  r.post('/:id/permission', async (req, res) => {
    const { approved, format } = req.body
    const result = await agent.respondPermission(req.params.id, approved, format)
    res.json(result)
  })

  return r
}
