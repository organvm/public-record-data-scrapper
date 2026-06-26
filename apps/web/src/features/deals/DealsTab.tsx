import { useCallback, useEffect, useState } from 'react'
import { Deal, DealStage } from '@public-records/core'
import { DealPipeline } from '@/components/deals'
import { useDealActions } from '@/hooks/useDealActions'
import type { Deal as ApiDeal, DealStage as ApiDealStage, DealListResponse } from '@/lib/api/deals'

// The pipeline UI consumes the canonical camelCase `Deal`/`DealStage` from
// `@public-records/core`, while the REST client returns snake_case rows. These
// mappers bridge the two without inventing data: any field the API omits stays
// undefined / falls back to a safe default.
function mapDeal(row: ApiDeal): Deal {
  return {
    id: row.id,
    orgId: row.org_id,
    prospectId: row.prospect_id,
    contactId: row.contact_id,
    lenderId: row.lender_id,
    stageId: row.stage_id ?? '',
    assignedTo: row.assigned_to,
    amountRequested: row.amount_requested,
    amountApproved: row.amount_approved,
    termMonths: row.term_months,
    factorRate: row.factor_rate,
    dailyPayment: row.daily_payment,
    weeklyPayment: row.weekly_payment,
    useOfFunds: row.use_of_funds,
    useOfFundsDetails: row.use_of_funds_details,
    bankConnected: false,
    averageDailyBalance: row.average_daily_balance,
    monthlyRevenue: row.monthly_revenue,
    nsfCount: row.nsf_count,
    existingPositions: row.existing_positions,
    priority: row.priority,
    probability: row.probability,
    expectedCloseDate: row.expected_close_date,
    lostReason: row.lost_reason,
    lostNotes: row.lost_notes,
    fundedAt: row.funded_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapStage(row: ApiDealStage): DealStage {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    slug: row.name.toLowerCase().replace(/\s+/g, '-'),
    description: row.description,
    stageOrder: row.position,
    isTerminal: row.is_won || row.is_lost,
    terminalType: row.is_won ? 'won' : row.is_lost ? 'lost' : undefined,
    color: row.color,
    autoActions: {},
    createdAt: row.created_at
  }
}

export function DealsTab() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [stages, setStages] = useState<DealStage[]>([])
  const [loaded, setLoaded] = useState(false)

  // orgId is intentionally empty: the server derives the tenant from the
  // authenticated token and the client omits a blank org_id.
  const dealActions = useDealActions({ orgId: '' })
  const { handleFetchDeals, handleFetchStages } = dealActions

  const load = useCallback(async () => {
    const [dealResult, stageResult] = await Promise.all([
      handleFetchDeals() as Promise<DealListResponse | null>,
      handleFetchStages()
    ])
    if (dealResult) setDeals(dealResult.deals.map(mapDeal))
    if (stageResult.length > 0) setStages(stageResult.map(mapStage))
    setLoaded(true)
  }, [handleFetchDeals, handleFetchStages])

  useEffect(() => {
    void load()
  }, [load])

  const handleStageChange = useCallback(
    async (dealId: string, newStageId: string) => {
      const updated = await dealActions.handleMoveToStage(dealId, { stage_id: newStageId })
      if (updated) {
        setDeals((current) =>
          current.map((d) => (d.id === dealId ? { ...d, stageId: newStageId } : d))
        )
      }
    },
    [dealActions]
  )

  return (
    <DealPipeline
      deals={deals}
      stages={stages.length > 0 ? stages : undefined}
      onDealClick={() => {}}
      onDealCreate={() => {}}
      onDealStageChange={(dealId, newStageId) => void handleStageChange(dealId, newStageId)}
      onDealEdit={() => {}}
      onDealDelete={() => {}}
      className={loaded ? undefined : 'opacity-70'}
    />
  )
}
