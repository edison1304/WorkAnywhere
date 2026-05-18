import { Router } from 'express'
import type { DataStore } from '../../../../electron/main/services/DataStore'
import type { GatewaySync } from '../services/GatewaySync'

export function phaseRoutes(dataStore: DataStore, sync: GatewaySync): Router {
  const r = Router()

  r.get('/', (req, res) => {
    const projectId = req.query.projectId as string
    if (!projectId) {
      res.status(400).json({ success: false, error: 'projectId query param required' })
      return
    }
    res.json({ success: true, data: dataStore.phaseList(projectId) })
  })

  r.post('/', (req, res) => {
    const { projectId, name, description } = req.body
    try {
      const phase = dataStore.phaseCreate(projectId, name, description)
      sync.publishEvent('entity_upsert', 'phase', phase.id, phase)
      res.json({ success: true, data: phase })
    } catch (err) {
      res.status(400).json({ success: false, error: String(err) })
    }
  })

  r.put('/:id', (req, res) => {
    const phase = dataStore.phaseUpdate(req.params.id, req.body)
    if (!phase) {
      res.status(404).json({ success: false, error: 'Phase not found' })
      return
    }
    sync.publishEvent('entity_upsert', 'phase', phase.id, phase)
    res.json({ success: true, data: phase })
  })

  r.delete('/:id', (req, res) => {
    dataStore.phaseDelete(req.params.id)
    sync.publishEvent('entity_delete', 'phase', req.params.id, null)
    res.json({ success: true })
  })

  r.post('/reorder', (req, res) => {
    const { projectId, orderedIds } = req.body
    dataStore.phaseReorder(projectId, orderedIds)
    res.json({ success: true })
  })

  return r
}
