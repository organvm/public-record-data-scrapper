import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the database connection used by AlertService.
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn(),
    getPoolClient: vi.fn()
  }
}))

import { database } from '../../database/connection'
import { AlertService } from '../../services/AlertService'

const mockedQuery = vi.mocked(database.query)
const mockedGetPoolClient = vi.mocked(database.getPoolClient)

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert-1',
    org_id: 'org-1',
    rule_id: null,
    prospect_id: 'prospect-1',
    type: 'score_critical',
    severity: 'high',
    status: 'active',
    title: 'Score critically low',
    message: 'Below threshold',
    data: { currentScore: 30 },
    created_at: '2026-06-06T00:00:00.000Z',
    acknowledged_at: null,
    acknowledged_by: null,
    resolved_at: null,
    resolved_by: null,
    resolution_notes: null,
    ...overrides
  }
}

describe('AlertService persistence', () => {
  let service: AlertService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AlertService()
  })

  it('createAlert INSERTs into alerts and maps the returned row', async () => {
    mockedQuery.mockResolvedValueOnce([alertRow()])

    const alert = await service.createAlert({
      orgId: 'org-1',
      prospectId: 'prospect-1',
      type: 'score_critical',
      severity: 'high',
      title: 'Score critically low',
      message: 'Below threshold',
      data: { currentScore: 30 }
    })

    expect(mockedQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO alerts')
    expect(params).toEqual([
      'org-1',
      null,
      'prospect-1',
      'score_critical',
      'high',
      'Score critically low',
      'Below threshold',
      JSON.stringify({ currentScore: 30 })
    ])

    // Mapped to camelCase Alert shape.
    expect(alert).toMatchObject({
      id: 'alert-1',
      orgId: 'org-1',
      prospectId: 'prospect-1',
      status: 'active',
      data: { currentScore: 30 }
    })
  })

  it('getActiveAlerts queries active alerts for an org', async () => {
    mockedQuery.mockResolvedValueOnce([alertRow(), alertRow({ id: 'alert-2' })])

    const alerts = await service.getActiveAlerts('org-1')

    const [sql, params] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain('FROM alerts')
    expect(String(sql)).toContain("status = 'active'")
    expect(params).toEqual(['org-1'])
    expect(alerts).toHaveLength(2)
    expect(alerts[0].id).toBe('alert-1')
  })

  it('acknowledgeAlert UPDATEs status to acknowledged', async () => {
    mockedQuery.mockResolvedValueOnce([])

    await service.acknowledgeAlert('alert-1', 'user-9')

    const [sql, params] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain("status = 'acknowledged'")
    expect(params).toEqual(['alert-1', 'user-9'])
  })

  it('resolveAlert UPDATEs status to resolved with notes', async () => {
    mockedQuery.mockResolvedValueOnce([])

    await service.resolveAlert('alert-1', 'user-9', 'handled by phone')

    const [sql, params] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain("status = 'resolved'")
    expect(params).toEqual(['alert-1', 'user-9', 'handled by phone'])
  })

  it('listAlerts builds a filtered, paginated query and returns total', async () => {
    mockedQuery
      .mockResolvedValueOnce([{ total: 3 }]) // count
      .mockResolvedValueOnce([alertRow()]) // page

    const result = await service.listAlerts({
      orgId: 'org-1',
      status: 'active',
      severity: 'high',
      limit: 10,
      offset: 0
    })

    expect(result.total).toBe(3)
    expect(result.alerts).toHaveLength(1)

    const countSql = String(mockedQuery.mock.calls[0][0])
    expect(countSql).toContain('SELECT COUNT(*)')
    const countParams = mockedQuery.mock.calls[0][1] as unknown[]
    expect(countParams[0]).toBe('org-1')
    // status passed as an array for the ANY() filter.
    expect(countParams).toContainEqual(['active'])
    expect(countParams).toContain('high')

    const pageSql = String(mockedQuery.mock.calls[1][0])
    expect(pageSql).toContain('LIMIT')
    expect(pageSql).toContain('OFFSET')
  })

  it('getEnabledRules returns mapped rules for an org', async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        id: 'rule-1',
        org_id: 'org-1',
        type: 'score_critical',
        threshold: '40',
        action: 'in_app',
        severity: 'high',
        enabled: true,
        prospect_ids: null,
        webhook_url: null,
        config: null,
        created_at: '2026-06-06T00:00:00.000Z',
        updated_at: '2026-06-06T00:00:00.000Z'
      }
    ])

    const rules = await service.getEnabledRules('org-1')

    const [sql, params] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain('FROM alert_rules')
    expect(String(sql)).toContain('enabled = true')
    expect(params).toEqual(['org-1'])
    expect(rules[0]).toMatchObject({
      id: 'rule-1',
      orgId: 'org-1',
      type: 'score_critical',
      threshold: 40, // numeric coercion
      enabled: true
    })
  })

  it('saveRule upserts and returns the persisted rule', async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        id: 'rule-7',
        org_id: 'org-1',
        type: 'health_drop',
        threshold: '15',
        action: 'email',
        severity: 'medium',
        enabled: true,
        prospect_ids: null,
        webhook_url: null,
        config: null,
        created_at: '2026-06-06T00:00:00.000Z',
        updated_at: '2026-06-06T00:00:00.000Z'
      }
    ])

    const saved = await service.saveRule({
      id: 'rule-7',
      orgId: 'org-1',
      type: 'health_drop',
      threshold: 15,
      action: 'email',
      severity: 'medium',
      enabled: true
    })

    const [sql] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO alert_rules')
    expect(String(sql)).toContain('ON CONFLICT (id) DO UPDATE')
    expect(saved.id).toBe('rule-7')
    expect(saved.threshold).toBe(15)
  })

  it('configureAlertRules replaces rules transactionally', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'rule-a',
            org_id: 'org-1',
            type: 'score_critical',
            threshold: '50',
            action: 'in_app',
            severity: 'critical',
            enabled: true,
            prospect_ids: null,
            webhook_url: null,
            config: null,
            created_at: '2026-06-06T00:00:00.000Z',
            updated_at: '2026-06-06T00:00:00.000Z'
          }
        ]
      }) // INSERT
      .mockResolvedValueOnce(undefined) // COMMIT
    const release = vi.fn()
    mockedGetPoolClient.mockResolvedValueOnce({
      query: clientQuery,
      release
    } as never)

    const result = await service.configureAlertRules('org-1', [
      {
        type: 'score_critical',
        threshold: 50,
        action: 'in_app',
        severity: 'critical',
        enabled: true
      }
    ])

    const statements = clientQuery.mock.calls.map((c) => String(c[0]))
    expect(statements[0]).toContain('BEGIN')
    expect(statements[1]).toContain('DELETE FROM alert_rules')
    expect(statements[2]).toContain('INSERT INTO alert_rules')
    expect(statements[3]).toContain('COMMIT')
    expect(release).toHaveBeenCalledOnce()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('rule-a')
  })

  it('configureAlertRules rolls back and releases the client on failure', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('constraint violation')) // DELETE fails
      .mockResolvedValueOnce(undefined) // ROLLBACK
    const release = vi.fn()
    mockedGetPoolClient.mockResolvedValueOnce({
      query: clientQuery,
      release
    } as never)

    await expect(
      service.configureAlertRules('org-1', [
        { type: 'health_drop', threshold: 10, action: 'email', severity: 'low', enabled: true }
      ])
    ).rejects.toThrow('constraint violation')

    const statements = clientQuery.mock.calls.map((c) => String(c[0]))
    expect(statements).toContain('ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })
})
