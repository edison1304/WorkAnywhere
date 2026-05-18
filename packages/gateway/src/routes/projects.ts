import { Router } from 'express'
import type { DataStore } from '../../../../electron/main/services/DataStore'
import type { GatewaySync } from '../services/GatewaySync'

export function projectRoutes(dataStore: DataStore, sync: GatewaySync): Router {
  const r = Router()

  r.get('/', (_req, res) => {
    res.json({ success: true, data: dataStore.projectList() })
  })

  r.post('/', (req, res) => {
    try {
      const project = dataStore.projectCreate(req.body)
      sync.publishEvent('entity_upsert', 'project', project.id, project)
      res.json({ success: true, data: project })
    } catch (err) {
      res.status(400).json({ success: false, error: String(err) })
    }
  })

  r.put('/:id', (req, res) => {
    const project = dataStore.projectUpdate(req.params.id, req.body)
    if (!project) {
      res.status(404).json({ success: false, error: 'Project not found' })
      return
    }
    sync.publishEvent('entity_upsert', 'project', project.id, project)
    res.json({ success: true, data: project })
  })

  r.delete('/:id', (req, res) => {
    dataStore.projectDelete(req.params.id)
    sync.publishEvent('entity_delete', 'project', req.params.id, null)
    res.json({ success: true })
  })

  return r
}
