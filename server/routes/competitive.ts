import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { CompetitiveHeatMapService } from '../services/CompetitiveHeatMapService'
import { FilingVelocityService } from '../services/FilingVelocityService'
import { FreshCapacityService } from '../services/FreshCapacityService'
import { database } from '../database/connection'

const router = Router()

const stateParamSchema = z.object({
  state: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase())
})

const funderParamSchema = z.object({
  name: z.string().min(1)
})

const prospectIdParamSchema = z.object({
  prospectId: z.string().uuid()
})

const recentEventsQuerySchema = z.object({
  hours: z.string().regex(/^\d+$/).optional()
})

const acceleratingQuerySchema = z.object({
  state: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase())
    .optional()
})

const saturationQuerySchema = z.object({
  industry: z.string().max(100).optional()
})

// GET /api/competitive/saturation/:state — market saturation + HHI for a state
router.get(
  '/saturation/:state',
  validateRequest({ params: stateParamSchema, query: saturationQuerySchema }),
  async (req, res) => {
    try {
      const { state } = req.params

      const service = new CompetitiveHeatMapService(database)
      const saturation = await service.getCompetitiveSaturation(
        state.toUpperCase(),
        req.query.industry as string | undefined
      )
      res.json(saturation)
    } catch (err) {
      console.error('[competitive] Saturation error:', (err as Error).message)
      res.status(500).json({ error: 'Failed to compute saturation' })
    }
  }
)

// GET /api/competitive/funder/:name — geographic heat map for a funder
router.get('/funder/:name', validateRequest({ params: funderParamSchema }), async (req, res) => {
  try {
    const { name } = req.params
    const service = new CompetitiveHeatMapService(database)
    const heatMap = await service.getGeographicHeatMap(name)
    res.json({ funder: name, states: heatMap })
  } catch (err) {
    console.error('[competitive] Funder heatmap error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to get funder heat map' })
  }
})

// GET /api/competitive/events/recent — recent filing events
router.get(
  '/events/recent',
  validateRequest({ query: recentEventsQuerySchema }),
  async (req, res) => {
    try {
      // Parse with explicit radix, guard NaN/non-positive, and clamp to a sane
      // upper bound (90 days) so a caller cannot request an unbounded window.
      const parsedHours = parseInt(req.query.hours as string, 10)
      const hours =
        Number.isFinite(parsedHours) && parsedHours > 0 ? Math.min(parsedHours, 24 * 90) : 168 // default 7 days
      const events = await database.query(
        `SELECT id, prospect_id as "prospectId", event_type as "eventType",
              filing_id as "filingId", event_date as "eventDate",
              metadata, created_at as "createdAt"
       FROM filing_events
       WHERE created_at >= NOW() - $1::integer * INTERVAL '1 hour'
       ORDER BY created_at DESC
       LIMIT 100`,
        [hours]
      )
      res.json({ events, count: events.length })
    } catch (err) {
      console.error('[competitive] Events error:', (err as Error).message)
      res.status(500).json({ error: 'Failed to get recent events' })
    }
  }
)

// GET /api/competitive/velocity/:prospectId — velocity metrics for a prospect
router.get(
  '/velocity/:prospectId',
  validateRequest({ params: prospectIdParamSchema }),
  async (req, res) => {
    try {
      const { prospectId } = req.params
      const velocityService = new FilingVelocityService(database)
      const metrics = await velocityService.computeVelocity(prospectId)
      res.json({ prospectId, metrics })
    } catch (err) {
      console.error('[competitive] Velocity error:', (err as Error).message)
      res.status(500).json({ error: 'Failed to compute velocity' })
    }
  }
)

// GET /api/competitive/capacity/:prospectId — fresh capacity score
router.get(
  '/capacity/:prospectId',
  validateRequest({ params: prospectIdParamSchema }),
  async (req, res) => {
    try {
      const { prospectId } = req.params
      const capacityService = new FreshCapacityService(database)
      const result = await capacityService.computeForProspect(prospectId)
      res.json({ prospectId, ...result })
    } catch (err) {
      console.error('[competitive] Capacity error:', (err as Error).message)
      res.status(500).json({ error: 'Failed to compute capacity' })
    }
  }
)

// GET /api/competitive/accelerating — prospects with accelerating filing velocity
router.get(
  '/accelerating',
  validateRequest({ query: acceleratingQuerySchema }),
  async (req, res) => {
    try {
      const state = req.query.state as string | undefined
      const velocityService = new FilingVelocityService(database)
      const prospects = await velocityService.detectAccelerating(state)
      res.json({ prospects, count: prospects.length })
    } catch (err) {
      console.error('[competitive] Accelerating error:', (err as Error).message)
      res.status(500).json({ error: 'Failed to detect accelerating prospects' })
    }
  }
)

export default router
