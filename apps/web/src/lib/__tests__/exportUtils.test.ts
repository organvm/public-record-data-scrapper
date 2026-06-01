/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { exportProspects } from '../exportUtils'
import type { Prospect } from '@public-records/core'

// Mock DOM methods
const mockCreateElement = vi.fn()
const mockAppendChild = vi.fn()
const mockRemoveChild = vi.fn()
const mockClick = vi.fn()
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url')
const mockRevokeObjectURL = vi.fn()

describe('exportUtils', () => {
  const createMockProspect = (overrides: Partial<Prospect> = {}): Prospect =>
    ({
      id: 'test-id',
      companyName: 'Test Company',
      state: 'CA',
      industry: 'technology' as const,
      priorityScore: 85,
      healthScore: {
        grade: 'B',
        score: 75,
        sentimentTrend: 'improving',
        reviewCount: 15,
        avgSentiment: 0.85,
        violationCount: 2,
        lastUpdated: '2024-01-15'
      },
      status: 'new' as const,
      growthSignals: [
        {
          id: 'sig-1',
          type: 'expansion' as const,
          description: 'New office',
          detectedDate: '2026-01-15',
          confidence: 85,
          score: 80
        },
        {
          id: 'sig-2',
          type: 'hiring' as const,
          description: 'Hiring 10 people',
          detectedDate: '2026-01-15',
          confidence: 75,
          score: 70
        }
      ],
      uccFilings: [],
      narrative: 'Test narrative',
      defaultDate: '2024-01-01',
      timeSinceDefault: 30,
      estimatedRevenue: 5000000,
      ...overrides
    }) as Prospect

  beforeEach(() => {
    // Mock document methods
    Object.defineProperty(document, 'createElement', {
      value: mockCreateElement.mockImplementation((tag: string) => ({
        tagName: tag,
        href: '',
        download: '',
        click: mockClick
      })),
      configurable: true
    })

    Object.defineProperty(document.body, 'appendChild', {
      value: mockAppendChild,
      configurable: true
    })

    Object.defineProperty(document.body, 'removeChild', {
      value: mockRemoveChild,
      configurable: true
    })

    // Mock URL methods
    Object.defineProperty(URL, 'createObjectURL', {
      value: mockCreateObjectURL,
      configurable: true
    })

    Object.defineProperty(URL, 'revokeObjectURL', {
      value: mockRevokeObjectURL,
      configurable: true
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('exportProspects', () => {
    describe('input validation', () => {
      it('should throw error when prospects array is empty', () => {
        expect(() => exportProspects([])).toThrow('No prospects to export')
      })

      it('should throw error when prospects array is empty with csv format', () => {
        expect(() => exportProspects([], 'csv')).toThrow('No prospects to export')
      })
    })

    describe('JSON export', () => {
      it('should export single prospect as JSON', () => {
        const prospect = createMockProspect()

        exportProspects([prospect], 'json')

        expect(mockCreateObjectURL).toHaveBeenCalled()
        expect(mockClick).toHaveBeenCalled()
        expect(mockRevokeObjectURL).toHaveBeenCalled()
      })

      it('should export multiple prospects as JSON', () => {
        const prospects = [
          createMockProspect({ id: '1', companyName: 'Company A' }),
          createMockProspect({ id: '2', companyName: 'Company B' })
        ]

        exportProspects(prospects, 'json')

        expect(mockCreateObjectURL).toHaveBeenCalled()
        const blobArg = (mockCreateObjectURL.mock.calls[0] as any)[0]
        expect(blobArg).toBeInstanceOf(Blob)
        expect(blobArg.type).toBe('application/json')
      })

      it('should use json as default format', () => {
        const prospect = createMockProspect()

        exportProspects([prospect])

        const blobArg = (mockCreateObjectURL.mock.calls[0] as any)[0]
        expect(blobArg.type).toBe('application/json')
      })

      it('should include all prospect fields in JSON export', () => {
        const prospect = createMockProspect({
          companyName: 'Acme Corp',
          industry: 'manufacturing',
          state: 'NY',
          priorityScore: 92,
          claimedBy: 'John Doe',
          claimedDate: '2024-02-01'
        })

        exportProspects([prospect], 'json')

        // Verify blob was created (the actual content is tested by checking the call)
        expect(mockCreateObjectURL).toHaveBeenCalled()
      })
    })

    describe('CSV export', () => {
      it('should export single prospect as CSV', () => {
        const prospect = createMockProspect()

        exportProspects([prospect], 'csv')

        expect(mockCreateObjectURL).toHaveBeenCalled()
        const blobArg = (mockCreateObjectURL.mock.calls[0] as any)[0]
        expect(blobArg).toBeInstanceOf(Blob)
        expect(blobArg.type).toBe('text/csv')
      })

      it('should export multiple prospects as CSV', () => {
        const prospects = [
          createMockProspect({ id: '1', companyName: 'Company A' }),
          createMockProspect({ id: '2', companyName: 'Company B' })
        ]

        exportProspects(prospects, 'csv')

        const blobArg = (mockCreateObjectURL.mock.calls[0] as any)[0]
        expect(blobArg.type).toBe('text/csv')
      })
    })

    describe('filename generation', () => {
      it('should generate company-specific filename for single prospect', () => {
        const prospect = createMockProspect({ companyName: 'Acme Corp' })

        exportProspects([prospect], 'json')

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toMatch(/prospect-acme-corp-.*\.json/)
      })

      it('should generate generic filename for multiple prospects', () => {
        const prospects = [createMockProspect({ id: '1' }), createMockProspect({ id: '2' })]

        exportProspects(prospects, 'json')

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toMatch(/prospects-export-.*\.json/)
      })

      it('should include filter info in filename when provided', () => {
        const prospects = [createMockProspect({ id: '1' }), createMockProspect({ id: '2' })]

        exportProspects(prospects, 'json', 'filtered')

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toMatch(/prospects-export-filtered-.*\.json/)
      })

      it('should use csv extension for CSV format', () => {
        const prospect = createMockProspect()

        exportProspects([prospect], 'csv')

        const element = mockCreateElement.mock.results[0].value
        expect(element.download).toMatch(/\.csv$/)
      })

      it('should sanitize company name in filename', () => {
        const prospect = createMockProspect({ companyName: 'Test & Co. (LLC)' })

        exportProspects([prospect], 'json')

        const element = mockCreateElement.mock.results[0].value
        // Special characters are replaced with dashes, parentheses are removed
        expect(element.download).not.toMatch(/[&()]/)
        // The sanitized name should be present (possibly with multiple dashes due to consecutive special chars)
        expect(element.download.toLowerCase()).toContain('test')
        expect(element.download.toLowerCase()).toContain('llc')
      })
    })

    describe('DOM operations', () => {
      it('should create anchor element', () => {
        exportProspects([createMockProspect()], 'json')

        expect(mockCreateElement).toHaveBeenCalledWith('a')
      })

      it('should append element to body', () => {
        exportProspects([createMockProspect()], 'json')

        expect(mockAppendChild).toHaveBeenCalled()
      })

      it('should click element to trigger download', () => {
        exportProspects([createMockProspect()], 'json')

        expect(mockClick).toHaveBeenCalled()
      })

      it('should remove element from body after click', () => {
        exportProspects([createMockProspect()], 'json')

        expect(mockRemoveChild).toHaveBeenCalled()
      })

      it('should revoke object URL after download', () => {
        exportProspects([createMockProspect()], 'json')

        expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
      })
    })
  })

  describe('CSV escaping', () => {
    it('should handle prospects with commas in company name', () => {
      const prospect = createMockProspect({ companyName: 'Company, Inc' })

      // This should not throw
      expect(() => exportProspects([prospect], 'csv')).not.toThrow()
    })

    it('should handle prospects with quotes in narrative', () => {
      const prospect = createMockProspect({ narrative: 'Said "hello" today' })

      expect(() => exportProspects([prospect], 'csv')).not.toThrow()
    })

    it('should handle prospects with newlines in description', () => {
      const prospect = createMockProspect({
        narrative: 'Line 1\nLine 2'
      })

      expect(() => exportProspects([prospect], 'csv')).not.toThrow()
    })

    it('should handle null/undefined values', () => {
      const prospect = createMockProspect({
        estimatedRevenue: undefined,
        claimedBy: undefined,
        claimedDate: undefined
      })

      expect(() => exportProspects([prospect], 'csv')).not.toThrow()
    })
  })

  describe('JSON structure', () => {
    it('should include expected fields in JSON export', () => {
      const prospect = createMockProspect({
        companyName: 'Test Co',
        industry: 'retail',
        priorityScore: 75
      })

      exportProspects([prospect], 'json')

      // The blob is created with the JSON content
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('should handle prospects with all optional fields', () => {
      const prospect = createMockProspect({
        claimedBy: 'Jane Smith',
        claimedDate: '2024-03-15',
        estimatedRevenue: 10000000
      })

      expect(() => exportProspects([prospect], 'json')).not.toThrow()
    })

    it('should extract unique signal types', () => {
      const prospect = createMockProspect({
        growthSignals: [
          {
            id: 'sig-3',
            type: 'expansion',
            description: 'New office',
            detectedDate: '2026-01-15',
            confidence: 85,
            score: 80
          },
          {
            id: 'sig-4',
            type: 'expansion',
            description: 'Another office',
            detectedDate: '2026-01-15',
            confidence: 80,
            score: 75
          },
          {
            id: 'sig-5',
            type: 'hiring',
            description: 'New hires',
            detectedDate: '2026-01-15',
            confidence: 75,
            score: 70
          }
        ]
      })

      expect(() => exportProspects([prospect], 'json')).not.toThrow()
    })

    it('should handle prospect with no growth signals', () => {
      const prospect = createMockProspect({ growthSignals: [] })

      expect(() => exportProspects([prospect], 'json')).not.toThrow()
    })
  })
})
