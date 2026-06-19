import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  EquipmentLifecycleDetector,
  EquipmentFilingInput
} from '../../services/EquipmentLifecycleDetector'

// Mock the database module (used only by detectForProspect)
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

// Fixed reference date so recency math is deterministic.
const NOW = new Date('2026-06-01T00:00:00Z')
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('EquipmentLifecycleDetector', () => {
  let detector: EquipmentLifecycleDetector

  beforeEach(() => {
    vi.clearAllMocks()
    detector = new EquipmentLifecycleDetector()
  })

  describe('detectEquipment', () => {
    it('detects specific equipment collateral and its category', () => {
      const result = detector.detectEquipment('One (1) 2024 CNC milling machine, serial #12345')
      expect(result.isEquipment).toBe(true)
      expect(result.categories).toContain('machinery')
    })

    it('detects vehicle equipment', () => {
      const result = detector.detectEquipment('2023 Freightliner truck and trailer')
      expect(result.isEquipment).toBe(true)
      expect(result.categories).toContain('vehicle')
    })

    it('excludes blanket "all assets" liens even when equipment is listed', () => {
      const result = detector.detectEquipment(
        'All assets including equipment, inventory, and accounts receivable now owned or hereafter acquired'
      )
      expect(result.isEquipment).toBe(false)
      expect(result.categories).toHaveLength(0)
    })

    it('returns false for empty / undefined descriptions', () => {
      expect(detector.detectEquipment(undefined).isEquipment).toBe(false)
      expect(detector.detectEquipment('').isEquipment).toBe(false)
      expect(detector.detectEquipment('future receivables').isEquipment).toBe(false)
    })
  })

  describe('classifySecuredPartyType', () => {
    it('classifies a known equipment lender', () => {
      expect(detector.classifySecuredPartyType('De Lage Landen Financial Services')).toBe('equipment')
      expect(detector.classifySecuredPartyType('Balboa Capital Corporation')).toBe('equipment')
    })

    it('classifies a known MCA funder', () => {
      expect(detector.classifySecuredPartyType('OnDeck Capital, Inc.')).toBe('mca')
      expect(detector.classifySecuredPartyType('Forward Financing LLC')).toBe('mca')
    })

    it('classifies auto captive finance', () => {
      expect(detector.classifySecuredPartyType('Ford Motor Credit Company')).toBe('auto')
    })

    it('falls back to bank via heuristic', () => {
      expect(detector.classifySecuredPartyType('First National Bank')).toBe('bank')
    })

    it('does not false-match short tokens mid-word (cit vs capacity)', () => {
      expect(detector.classifySecuredPartyType('Capacity Builders LLC')).not.toBe('equipment')
      expect(detector.classifySecuredPartyType('CIT Group')).toBe('equipment')
    })

    it('returns unknown for empty or unrecognized names', () => {
      expect(detector.classifySecuredPartyType(undefined)).toBe('unknown')
      expect(detector.classifySecuredPartyType('Zephyr Holdings')).toBe('unknown')
    })
  })

  describe('analyzeFilings', () => {
    it('flags a recent equipment purchase from a non-MCA lender as MCA-adjacent (+10)', () => {
      const filings: EquipmentFilingInput[] = [
        {
          filingDate: daysAgo(30),
          collateralDescription: 'One 2024 CNC lathe machine',
          securedParty: 'Balboa Capital',
          status: 'active'
        }
      ]

      const signal = detector.analyzeFilings(filings, NOW)

      expect(signal.hasRecentEquipmentPurchase).toBe(true)
      expect(signal.recentEquipmentFilingCount).toBe(1)
      expect(signal.securedPartyType).toBe('equipment')
      expect(signal.isMcaAdjacent).toBe(true)
      expect(signal.scoreBoost).toBe(10)
    })

    it('does NOT boost when the equipment was financed by an MCA funder', () => {
      const filings: EquipmentFilingInput[] = [
        {
          filingDate: daysAgo(30),
          collateralDescription: 'Restaurant kitchen equipment and ovens',
          securedParty: 'OnDeck Capital',
          status: 'active'
        }
      ]

      const signal = detector.analyzeFilings(filings, NOW)

      expect(signal.hasRecentEquipmentPurchase).toBe(true)
      expect(signal.securedPartyType).toBe('mca')
      expect(signal.isMcaAdjacent).toBe(false)
      expect(signal.scoreBoost).toBe(0)
    })

    it('does not treat old equipment filings as recent', () => {
      const filings: EquipmentFilingInput[] = [
        {
          filingDate: daysAgo(400),
          collateralDescription: 'Forklift and warehouse machinery',
          securedParty: 'CIT Group',
          status: 'active'
        }
      ]

      const signal = detector.analyzeFilings(filings, NOW)

      expect(signal.totalEquipmentFilingCount).toBe(1)
      expect(signal.hasRecentEquipmentPurchase).toBe(false)
      expect(signal.recentEquipmentFilingCount).toBe(0)
      expect(signal.isMcaAdjacent).toBe(false)
      expect(signal.scoreBoost).toBe(0)
    })

    it('ignores terminated/lapsed liens', () => {
      const filings: EquipmentFilingInput[] = [
        {
          filingDate: daysAgo(20),
          collateralDescription: '2024 excavator',
          securedParty: 'Balboa Capital',
          status: 'terminated'
        }
      ]

      const signal = detector.analyzeFilings(filings, NOW)

      expect(signal.totalEquipmentFilingCount).toBe(0)
      expect(signal.scoreBoost).toBe(0)
    })

    it('ignores blanket liens entirely', () => {
      const filings: EquipmentFilingInput[] = [
        {
          filingDate: daysAgo(10),
          collateralDescription: 'All assets and future receivables',
          securedParty: 'Pearl Capital',
          status: 'active'
        }
      ]

      const signal = detector.analyzeFilings(filings, NOW)

      expect(signal.totalEquipmentFilingCount).toBe(0)
      expect(signal.hasRecentEquipmentPurchase).toBe(false)
    })

    it('returns a neutral signal when there are no filings', () => {
      const signal = detector.analyzeFilings([], NOW)
      expect(signal.hasRecentEquipmentPurchase).toBe(false)
      expect(signal.securedPartyType).toBe('unknown')
      expect(signal.scoreBoost).toBe(0)
    })

    it('respects a custom recency window and boost via config', () => {
      const custom = new EquipmentLifecycleDetector({ recentWindowDays: 30, mcaAdjacencyBoost: 5 })
      const filings: EquipmentFilingInput[] = [
        {
          filingDate: daysAgo(45),
          collateralDescription: '2024 delivery van',
          securedParty: 'Wells Fargo Equipment Finance',
          status: 'active'
        }
      ]

      const signal = custom.analyzeFilings(filings, NOW)
      // 45 days > 30-day window → not recent
      expect(signal.hasRecentEquipmentPurchase).toBe(false)
      expect(signal.scoreBoost).toBe(0)
    })
  })

  describe('detectForProspect', () => {
    it('fetches filings and produces a signal', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          status: 'active',
          filing_date: daysAgo(15),
          secured_party: 'De Lage Landen',
          collateral_description: 'CNC machine and tooling'
        }
      ])

      const signal = await detector.detectForProspect('prospect-1')

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(signal.isMcaAdjacent).toBe(true)
      expect(signal.scoreBoost).toBe(10)
    })
  })
})
