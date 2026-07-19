import { expect, test } from '@playwright/test'

test('built Pages bundle loads receipt-bound public records and never calls a missing /api', async ({
  page
}) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  await page.route('https://data.austintexas.gov/resource/3syk-w9eu.json**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json;charset=utf-8',
        'access-control-allow-origin': '*',
        'last-modified': 'Thu, 16 Jul 2026 12:57:51 GMT'
      },
      body: JSON.stringify([
        {
          permit_number: '2026-000001 PP',
          contractor_company_name: 'Example Plumbing LLC',
          issue_date: '2026-07-16T00:00:00.000',
          permit_type_desc: 'Plumbing Permit'
        },
        {
          permit_number: '2026-000002 BP',
          contractor_company_name: 'Example Builders Inc',
          issue_date: '2026-07-15T00:00:00.000',
          permit_type_desc: 'Building Permit'
        }
      ])
    })
  })

  await page.goto('./')

  await expect(
    page.getByRole('heading', { name: 'Austin Issued Construction Permits' })
  ).toBeVisible()
  await expect(page.getByText('Example Plumbing LLC')).toBeVisible()
  await expect(page.getByText('Example Builders Inc')).toBeVisible()
  await expect(page.getByTestId('source-receipt-id')).toContainText(
    'austin-issued-construction-permits-3syk-w9eu'
  )

  expect(
    requests.some((url) =>
      url.endsWith('/public-record-data-scrapper/data/austin-building-permits.receipt.json')
    )
  ).toBe(true)
  expect(
    requests.some((url) => {
      const parsed = new URL(url)
      return parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')
    })
  ).toBe(false)
  expect(
    requests.some((url) => {
      const parsed = new URL(url)
      return parsed.pathname === '/_spark' || parsed.pathname.startsWith('/_spark/')
    })
  ).toBe(false)
})
