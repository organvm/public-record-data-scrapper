/**
 * Tests for StateCollectorFactory
 *
 * In the test environment, no API credentials are available, so
 * getCollector() returns undefined for all states. These tests verify
 * factory configuration, state registry, and metadata operations.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  StateCollectorFactory,
  stateCollectorFactory,
  getCollectorForState,
  hasCollectorForState
} from './StateCollectorFactory'

describe('StateCollectorFactory', () => {
  let factory: StateCollectorFactory

  beforeEach(() => {
    factory = new StateCollectorFactory()
  })

  describe('initialization', () => {
    it('should create factory with default config', () => {
      expect(factory).toBeDefined()
    })

    it('should accept custom configuration', () => {
      const customFactory = new StateCollectorFactory({
        cacheCollectors: false,
        lazyLoad: false
      })

      expect(customFactory).toBeDefined()
    })

    it('should start with empty registry', () => {
      const stats = factory.getStats()
      expect(stats.cached).toBe(0)
    })
  })

  describe('getCollector()', () => {
    it('should return undefined for states without credentials', () => {
      // CA requires CA_SOS_API_KEY env var; not set in test env
      const collector = factory.getCollector('CA')
      expect(collector).toBeUndefined()
    })

    it('should fail closed for credential-gated NY without seeds configured', () => {
      // NY uses the portal scraper but is gated on NY_UCC_DEBTOR_SEEDS, which is
      // not set in the test env, so the collector reports isReady()=false and the
      // factory withholds it (mirrors the FL active-contract gate).
      const collector = factory.getCollector('NY')
      expect(collector).toBeUndefined()
    })

    it('should return undefined for unimplemented state', () => {
      const collector = factory.getCollector('IL')
      expect(collector).toBeUndefined()
    })

    it('should handle case-insensitive state codes', () => {
      // All should resolve consistently (undefined in test env)
      const upper = factory.getCollector('CA')
      const lower = factory.getCollector('ca')
      const mixed = factory.getCollector('Ca')

      expect(upper).toBe(lower)
      expect(lower).toBe(mixed)
    })

    it('should not lazy load when disabled', () => {
      const noLazyFactory = new StateCollectorFactory({ lazyLoad: false })
      const collector = noLazyFactory.getCollector('CA')

      expect(collector).toBeUndefined()
    })
  })

  describe('getCollectors()', () => {
    it('should return empty map when no credentials available', () => {
      const collectors = factory.getCollectors(['CA', 'NY', 'TX'])
      // All require credentials not available in test env
      expect(collectors.size).toBe(0)
    })

    it('should return empty map for no states', () => {
      const collectors = factory.getCollectors([])
      expect(collectors.size).toBe(0)
    })

    it('should skip unimplemented states', () => {
      const collectors = factory.getCollectors(['IL', 'OH'])
      expect(collectors.size).toBe(0)
      expect(collectors.has('IL')).toBe(false)
    })

    it('should handle duplicate state codes', () => {
      const collectors = factory.getCollectors(['CA', 'CA', 'CA'])
      // Duplicates normalized; still 0 because no credentials
      expect(collectors.size).toBe(0)
    })
  })

  describe('getAllCollectors()', () => {
    it('should return map of collectors', () => {
      const collectors = factory.getAllCollectors()
      expect(collectors).toBeInstanceOf(Map)
    })

    it('should list all implemented states including those needing config', () => {
      const implemented = factory.getImplementedStates()

      // CA, TX, FL, NY all have collector implementations. FL and NY are
      // credential-gated (active contract / NY_UCC_DEBTOR_SEEDS) and fail closed
      // when unconfigured, but they are still "implemented" — the collection
      // code exists and is tested.
      expect(implemented.length).toBe(4) // CA, TX, FL, NY
      expect(implemented).toContain('NY')
      expect(implemented).toContain('CA')
      expect(implemented).toContain('TX')
      expect(implemented).toContain('FL')
    })
  })

  describe('hasCollector()', () => {
    it('should return true for states in implemented list', () => {
      expect(factory.hasCollector('CA')).toBe(true)
      expect(factory.hasCollector('TX')).toBe(true)
    })

    it('should return false for unimplemented state', () => {
      expect(factory.hasCollector('IL')).toBe(false)
      expect(factory.hasCollector('OH')).toBe(false)
    })

    it('should handle case-insensitive codes', () => {
      expect(factory.hasCollector('ca')).toBe(true)
      expect(factory.hasCollector('Ca')).toBe(true)
      expect(factory.hasCollector('CA')).toBe(true)
    })
  })

  describe('getImplementedStates()', () => {
    it('should return list of implemented states', () => {
      const implemented = factory.getImplementedStates()

      expect(implemented).toBeInstanceOf(Array)
      expect(implemented.length).toBeGreaterThan(0)
    })

    it('should return uppercase state codes', () => {
      const implemented = factory.getImplementedStates()

      implemented.forEach((code) => {
        expect(code).toBe(code.toUpperCase())
        expect(code.length).toBe(2)
      })
    })
  })

  describe('getPendingStates()', () => {
    it('should return list of pending states', () => {
      const pending = factory.getPendingStates()

      expect(pending).toBeInstanceOf(Array)
      expect(pending.length).toBeGreaterThan(0)
    })

    it('should not include implemented states', () => {
      const pending = factory.getPendingStates()
      const implemented = factory.getImplementedStates()

      implemented.forEach((state) => {
        expect(pending).not.toContain(state)
      })
    })

    it('should include all US states eventually', () => {
      const implemented = factory.getImplementedStates()
      const pending = factory.getPendingStates()

      expect(implemented.length + pending.length).toBe(51) // 50 states + DC
    })
  })

  describe('clearCache()', () => {
    it('should clear cached collectors', () => {
      // Attempt to create (may not cache if returns undefined)
      factory.getCollector('CA')
      factory.clearCache()

      const stats = factory.getStats()
      expect(stats.cached).toBe(0)
    })
  })

  describe('getStats()', () => {
    it('should return comprehensive statistics', () => {
      const stats = factory.getStats()

      expect(stats).toHaveProperty('total')
      expect(stats).toHaveProperty('implemented')
      expect(stats).toHaveProperty('pending')
      expect(stats).toHaveProperty('cached')
      expect(stats).toHaveProperty('implementedStates')
      expect(stats).toHaveProperty('pendingStates')
      expect(stats).toHaveProperty('cachedStates')
    })

    it('should count total states correctly', () => {
      const stats = factory.getStats()

      expect(stats.total).toBe(51) // 50 states + DC
    })

    it('should track implemented states', () => {
      const stats = factory.getStats()

      expect(stats.implemented).toBe(4) // CA, TX, FL, NY
      expect(stats.implementedStates).toContain('CA')
      expect(stats.implementedStates).toContain('TX')
      expect(stats.implementedStates).toContain('FL')
      expect(stats.implementedStates).toContain('NY')
    })

    it('should track pending states', () => {
      const stats = factory.getStats()

      expect(stats.pending).toBe(47) // 51 - 4
      expect(stats.pendingStates.length).toBe(47)
    })
  })

  describe('state configuration', () => {
    it('should return config for known states', () => {
      const caConfig = factory.getStateConfig('CA')
      expect(caConfig).toBeDefined()
      expect(caConfig?.hasApi).toBe(true)
      expect(caConfig?.accessMethods).toContain('api')
    })

    it('should return undefined for unknown states', () => {
      const config = factory.getStateConfig('ZZ')
      expect(config).toBeUndefined()
    })

    it('should report NY uses the scrape access method', () => {
      const nyConfig = factory.getStateConfig('NY')
      expect(nyConfig).toBeDefined()
      expect(nyConfig?.accessMethods).toContain('scrape')
    })

    it('should report FL requires vendor agreement', () => {
      const flConfig = factory.getStateConfig('FL')
      expect(flConfig).toBeDefined()
      expect(flConfig?.requiresVendor).toBe(true)
    })
  })

  describe('singleton instance', () => {
    it('should export singleton instance', () => {
      expect(stateCollectorFactory).toBeDefined()
      expect(stateCollectorFactory).toBeInstanceOf(StateCollectorFactory)
    })
  })

  describe('helper functions', () => {
    it('should provide getCollectorForState helper', () => {
      // Returns undefined without credentials in test env
      const collector = getCollectorForState('CA')
      expect(collector).toBeUndefined()
    })

    it('should provide hasCollectorForState helper', () => {
      expect(hasCollectorForState('CA')).toBe(true)
      expect(hasCollectorForState('TX')).toBe(true)
      expect(hasCollectorForState('FL')).toBe(true)
      expect(hasCollectorForState('IL')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle invalid state codes gracefully', () => {
      const collector = factory.getCollector('INVALID')
      expect(collector).toBeUndefined()
    })

    it('should handle empty string', () => {
      const collector = factory.getCollector('')
      expect(collector).toBeUndefined()
    })

    it('should handle numeric codes', () => {
      const collector = factory.getCollector('12')
      expect(collector).toBeUndefined()
    })

    it('should handle too-long codes', () => {
      const collector = factory.getCollector('NEWYORK')
      expect(collector).toBeUndefined()
    })
  })

  describe('implementation progress', () => {
    it('should have California in implemented states', () => {
      const implemented = factory.getImplementedStates()
      expect(implemented).toContain('CA')
      expect(factory.hasCollector('CA')).toBe(true)
    })

    it('should have Texas in implemented states', () => {
      const implemented = factory.getImplementedStates()
      expect(implemented).toContain('TX')
      expect(factory.hasCollector('TX')).toBe(true)
    })

    it('should have Florida in implemented states', () => {
      const implemented = factory.getImplementedStates()
      expect(implemented).toContain('FL')
      expect(factory.hasCollector('FL')).toBe(true)
    })

    it('should be ready for Illinois collector', () => {
      const pending = factory.getPendingStates()
      expect(pending).toContain('IL')
    })

    it('should track implementation progress', () => {
      const stats = factory.getStats()
      const progress = (stats.implemented / stats.total) * 100

      expect(progress).toBeGreaterThan(0)
      expect(progress).toBeLessThanOrEqual(100)
    })
  })
})
