import { Router } from 'express'
import { PreCallBriefingService } from '../services/PreCallBriefingService'
import { OutreachSequenceService } from '../services/OutreachSequenceService'
import { narrativeService } from '../services/NarrativeService'
import { database } from '../database/connection'

const router = Router()

// GET /api/outreach/briefing/:prospectId — Generate/return pre-call briefing
router.get('/briefing/:prospectId', async (req, res) => {
  try {
    const service = new PreCallBriefingService(database)
    // Try cache first
    const cached = await service.getCachedBriefing(req.params.prospectId)
    if (cached) return res.json(cached)
    // Generate fresh
    const briefing = await service.generateBriefing(req.params.prospectId)
    res.json(briefing)
  } catch (err) {
    if ((err as Error).message.includes('not found')) {
      return res.status(404).json({ error: (err as Error).message })
    }
    res.status(500).json({ error: 'Failed to generate briefing' })
  }
})

// GET /api/outreach/narrative/:prospectId — Generate sales narrative
router.get('/narrative/:prospectId', async (req, res) => {
  try {
    const narrative = await narrativeService.generateNarrative(req.params.prospectId)
    res.json(narrative)
  } catch (err) {
    if ((err as Error).message.includes('not found')) {
      return res.status(404).json({ error: (err as Error).message })
    }
    console.error('[outreach] Narrative error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to generate narrative' })
  }
})

// POST /api/outreach/trigger/:prospectId — Manually trigger outreach
router.post('/trigger/:prospectId', async (req, res) => {
  try {
    const { triggerType = 'termination', capacityScore } = req.body || {}
    const sequenceService = new OutreachSequenceService(database)

    const eligibility = await sequenceService.isEligible(
      req.params.prospectId,
      triggerType,
      capacityScore
    )
    if (!eligibility.eligible) {
      return res.status(409).json({ error: 'Not eligible', reason: eligibility.reason })
    }

    const sequenceId = await sequenceService.createSequence(
      req.params.prospectId,
      triggerType,
      undefined,
      capacityScore
    )
    res.status(201).json({ sequenceId, status: 'created' })
  } catch (err) {
    console.error('[outreach] Trigger error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to trigger outreach' })
  }
})

// GET /api/outreach/sequences/:prospectId — List active sequences
router.get('/sequences/:prospectId', async (req, res) => {
  try {
    const service = new OutreachSequenceService(database)
    const sequences = await service.getActiveSequences(req.params.prospectId)
    res.json({ sequences, count: sequences.length })
  } catch (err) {
    console.error('[outreach] Sequences error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to get sequences' })
  }
})

// POST /api/outreach/sequences/:id/cancel — Cancel a sequence
router.post('/sequences/:id/cancel', async (req, res) => {
  try {
    const service = new OutreachSequenceService(database)
    await service.cancelSequence(req.params.id)
    res.json({ status: 'cancelled' })
  } catch (err) {
    console.error('[outreach] Cancel error:', (err as Error).message)
    res.status(500).json({ error: 'Failed to cancel sequence' })
  }
})

export default router
