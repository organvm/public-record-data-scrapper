import { expect, test, type Page, type Route } from '@playwright/test'
import type { CompetitorData, PortfolioCompany, Prospect } from '@public-records/core'

const claimDate = '2026-06-20'

function buildProspects(): Prospect[] {
  return [
    {
      id: 'prospect-acme',
      companyName: 'Acme Kitchen Supply',
      industry: 'restaurant',
      state: 'CA',
      status: 'new',
      priorityScore: 92,
      defaultDate: '2022-08-14',
      timeSinceDefault: 1406,
      lastFilingDate: '2026-04-09',
      estimatedRevenue: 1250000,
      narrative:
        'Defaulted 3 years ago on equipment financing, now showing expansion and hiring signals.',
      uccFilings: [
        {
          id: 'CA-2026-0001',
          debtorName: 'Acme Kitchen Supply',
          securedParty: 'First Capital MCA',
          filingDate: '2026-04-09',
          state: 'CA',
          lienAmount: 85000,
          status: 'lapsed',
          filingType: 'UCC-1'
        }
      ],
      growthSignals: [
        {
          id: 'signal-acme-expansion',
          type: 'expansion',
          description: 'Opened a second location with new commercial kitchen equipment.',
          detectedDate: '2026-06-18',
          score: 27,
          confidence: 0.92,
          mlConfidence: 91
        },
        {
          id: 'signal-acme-hiring',
          type: 'hiring',
          description: 'Posted line cook and operations manager roles.',
          detectedDate: '2026-06-15',
          score: 17,
          confidence: 0.84,
          mlConfidence: 85
        }
      ],
      healthScore: {
        grade: 'B',
        score: 78,
        sentimentTrend: 'improving',
        reviewCount: 168,
        avgSentiment: 0.71,
        violationCount: 0,
        lastUpdated: '2026-06-19'
      },
      mlScoring: {
        confidence: 88,
        recoveryLikelihood: 82,
        modelVersion: 'test-v1',
        lastUpdated: '2026-06-19',
        factors: {
          healthTrend: 80,
          signalQuality: 92,
          industryRisk: 72,
          timeToRecovery: 76,
          financialStability: 79
        }
      }
    },
    {
      id: 'prospect-bravo',
      companyName: 'Bravo Medical Group',
      industry: 'healthcare',
      state: 'TX',
      status: 'new',
      priorityScore: 74,
      defaultDate: '2023-09-10',
      timeSinceDefault: 1014,
      lastFilingDate: '2026-01-17',
      estimatedRevenue: 2400000,
      narrative: 'Prior UCC default with a recent hiring signal and improving review trend.',
      uccFilings: [
        {
          id: 'TX-2026-0112',
          debtorName: 'Bravo Medical Group',
          securedParty: 'Business Lending LLC',
          filingDate: '2026-01-17',
          state: 'TX',
          lienAmount: 120000,
          status: 'lapsed',
          filingType: 'UCC-1'
        }
      ],
      growthSignals: [
        {
          id: 'signal-bravo-hiring',
          type: 'hiring',
          description: 'Hiring additional billing and front desk staff.',
          detectedDate: '2026-06-10',
          score: 15,
          confidence: 0.81
        }
      ],
      healthScore: {
        grade: 'C',
        score: 66,
        sentimentTrend: 'stable',
        reviewCount: 93,
        avgSentiment: 0.58,
        violationCount: 1,
        lastUpdated: '2026-06-17'
      },
      mlScoring: {
        confidence: 71,
        recoveryLikelihood: 68,
        modelVersion: 'test-v1',
        lastUpdated: '2026-06-19',
        factors: {
          healthTrend: 66,
          signalQuality: 74,
          industryRisk: 70,
          timeToRecovery: 63,
          financialStability: 64
        }
      }
    },
    {
      id: 'prospect-cedar',
      companyName: 'Cedar Construction LLC',
      industry: 'construction',
      state: 'FL',
      status: 'new',
      priorityScore: 51,
      defaultDate: '2021-12-02',
      timeSinceDefault: 1661,
      estimatedRevenue: 920000,
      narrative: 'Older UCC default with no current growth signals.',
      uccFilings: [
        {
          id: 'FL-2025-4450',
          debtorName: 'Cedar Construction LLC',
          securedParty: 'Equipment Leasing Inc',
          filingDate: '2025-11-30',
          state: 'FL',
          lienAmount: 64000,
          status: 'lapsed',
          filingType: 'UCC-1'
        }
      ],
      growthSignals: [],
      healthScore: {
        grade: 'D',
        score: 48,
        sentimentTrend: 'declining',
        reviewCount: 41,
        avgSentiment: 0.38,
        violationCount: 3,
        lastUpdated: '2026-06-12'
      }
    }
  ]
}

const competitors: CompetitorData[] = [
  {
    lenderName: 'First Capital MCA',
    filingCount: 310,
    avgDealSize: 92000,
    marketShare: 15.5,
    industries: ['restaurant', 'retail'],
    topState: 'CA',
    monthlyTrend: 8.2
  }
]

const portfolio: PortfolioCompany[] = [
  {
    id: 'portfolio-1',
    companyName: 'Northside Retail',
    fundingDate: '2025-08-03',
    fundingAmount: 115000,
    currentStatus: 'performing',
    healthScore: {
      grade: 'B',
      score: 80,
      sentimentTrend: 'stable',
      reviewCount: 122,
      avgSentiment: 0.7,
      violationCount: 0,
      lastUpdated: '2026-06-18'
    }
  },
  {
    id: 'portfolio-2',
    companyName: 'Harbor Services',
    fundingDate: '2025-11-19',
    fundingAmount: 175000,
    currentStatus: 'at-risk',
    healthScore: {
      grade: 'D',
      score: 46,
      sentimentTrend: 'declining',
      reviewCount: 59,
      avgSentiment: 0.4,
      violationCount: 2,
      lastUpdated: '2026-06-16'
    },
    lastAlertDate: '2026-06-19'
  }
]

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

async function stubApi(page: Page) {
  let prospects = buildProspects()
  const requests: string[] = []

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const endpoint = `${method} ${url.pathname}`
    requests.push(endpoint)

    if (method === 'GET' && url.pathname === '/api/prospects') {
      await fulfillJson(route, prospects)
      return
    }

    const claimMatch = url.pathname.match(/^\/api\/prospects\/([^/]+)\/claim$/)
    if (method === 'POST' && claimMatch) {
      const prospectId = decodeURIComponent(claimMatch[1])
      const { user } = request.postDataJSON() as { user?: string }
      const claimant = user || 'Current User'
      let updated: Prospect | undefined

      prospects = prospects.map((prospect) => {
        if (prospect.id !== prospectId) return prospect
        updated = {
          ...prospect,
          status: 'claimed',
          claimedBy: claimant,
          claimedDate: claimDate
        }
        return updated
      })

      if (!updated) {
        await fulfillJson(route, { message: 'Prospect not found' }, 404)
        return
      }

      await fulfillJson(route, updated)
      return
    }

    if (method === 'POST' && url.pathname === '/api/prospects/batch/claim') {
      const { ids, user } = request.postDataJSON() as { ids?: string[]; user?: string }
      const idSet = new Set(ids ?? [])
      const claimant = user || 'Current User'
      const updatedProspects: Prospect[] = []

      prospects = prospects.map((prospect) => {
        if (!idSet.has(prospect.id)) return prospect
        const updated = {
          ...prospect,
          status: 'claimed' as const,
          claimedBy: claimant,
          claimedDate: claimDate
        }
        updatedProspects.push(updated)
        return updated
      })

      await fulfillJson(route, updatedProspects)
      return
    }

    if (method === 'GET' && url.pathname === '/api/competitors') {
      await fulfillJson(route, competitors)
      return
    }

    if (method === 'GET' && url.pathname === '/api/portfolio') {
      await fulfillJson(route, portfolio)
      return
    }

    if (method === 'GET' && url.pathname === '/api/user-actions') {
      await fulfillJson(route, [])
      return
    }

    if (method === 'POST' && url.pathname === '/api/user-actions') {
      await fulfillJson(route, request.postDataJSON())
      return
    }

    await fulfillJson(route, { message: `Unhandled test API route: ${endpoint}` }, 500)
  })

  return {
    requests,
    getProspects: () => prospects
  }
}

test.describe('Main prospect user flow', () => {
  test('loads public-record prospects, filters, inspects filings, and claims a lead', async ({
    page
  }) => {
    const api = await stubApi(page)
    await page.addInitScript(() => window.localStorage.clear())

    await page.goto('/')

    await expect(
      page.getByRole('heading', { name: 'UCC-MCA Intelligence Platform' })
    ).toBeVisible()
    await expect(page.getByText('Showing 3 of 3 prospects')).toBeVisible()
    await expect(page.getByText('Total Prospects')).toBeVisible()
    await expect(page.getByText('High-Value Leads')).toBeVisible()

    await page.getByPlaceholder('Search companies...').fill('Acme Kitchen')
    await expect(page.getByText('Showing 1 of 3 prospects')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Acme Kitchen Supply' })).toBeVisible()
    await expect(page.getByText('Bravo Medical Group')).toHaveCount(0)

    await page.getByRole('heading', { name: 'Acme Kitchen Supply' }).click()

    const dialog = page.getByRole('dialog', { name: 'Acme Kitchen Supply' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Opportunity Summary')).toBeVisible()
    await expect(dialog.getByText('Opened a second location')).toBeVisible()

    await dialog.getByRole('tab', { name: /UCC Filings \(1\)/ }).click()
    const filingsPanel = dialog.getByRole('tabpanel').filter({ hasText: 'First Capital MCA' })
    await expect(filingsPanel).toBeVisible()
    await expect(filingsPanel.getByText('First Capital MCA')).toBeVisible()
    await expect(filingsPanel.getByText('2026-04-09')).toBeVisible()
    await expect(filingsPanel.getByText('lapsed')).toBeVisible()

    await dialog.getByRole('button', { name: 'Claim Lead' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Lead claimed successfully')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Claimed by Current User' })).toBeVisible()
    expect(api.getProspects().find((prospect) => prospect.id === 'prospect-acme')).toMatchObject(
      {
        status: 'claimed',
        claimedBy: 'Current User',
        claimedDate: claimDate
      }
    )
    expect(api.requests).toContain('POST /api/prospects/prospect-acme/claim')
    expect(api.requests).toContain('POST /api/user-actions')
  })
})
