import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { fetchDashboardStats } from '../databaseService'
import { getDatabase, createQueryBuilder } from '@/lib/database'

// Mock dependencies
vi.mock('@/lib/database', () => ({
  initDatabase: vi.fn(),
  getDatabase: vi.fn(),
  createQueryBuilder: vi.fn()
}))

describe('fetchDashboardStats', () => {
  let mockQueries: {
    getProspectStats: Mock
    getNewSignalsCountForToday: Mock
    getPortfolioStats: Mock
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mock query results
    mockQueries = {
      getProspectStats: vi.fn().mockResolvedValue({
        total: 100,
        by_status: { new: 50, contacted: 50 },
        avg_priority_score: 75,
        avg_health_score: 85
      }),
      getNewSignalsCountForToday: vi.fn().mockResolvedValue(5),
      getPortfolioStats: vi.fn().mockResolvedValue({
        atRisk: 10,
        total: 100
      })
    }

    // Setup database mocks
    vi.mocked(getDatabase).mockReturnValue({} as ReturnType<typeof getDatabase>)
    vi.mocked(createQueryBuilder).mockReturnValue(
      mockQueries as unknown as ReturnType<typeof createQueryBuilder>
    )
  })

  it('calculates average health grade correctly', async () => {
    const stats = await fetchDashboardStats()

    expect(stats).toBeDefined()
    expect(stats.avgPriorityScore).toBe(75) // Should be correct now
    expect(stats.avgHealthGrade).toBe('B') // 85 -> B
  })

  it('calculates A grade correctly', async () => {
    mockQueries.getProspectStats.mockResolvedValue({
      total: 100,
      avg_priority_score: 95,
      avg_health_score: 95
    })

    const stats = await fetchDashboardStats()
    expect(stats.avgHealthGrade).toBe('A')
  })

  it('calculates C grade correctly', async () => {
    mockQueries.getProspectStats.mockResolvedValue({
      total: 100,
      avg_priority_score: 75,
      avg_health_score: 75
    })

    const stats = await fetchDashboardStats()
    expect(stats.avgHealthGrade).toBe('C')
  })
})
