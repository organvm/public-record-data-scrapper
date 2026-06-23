import type { CompetitorData, DataTier, PortfolioCompany, Prospect } from '@public-records/core'
import { StatusDashboard } from '@/components/StatusDashboard'
import type { UserAction } from '@/lib/agentic/types'

interface StatusTabProps {
  prospects: Prospect[]
  portfolio: PortfolioCompany[]
  competitors: CompetitorData[]
  userActions: UserAction[]
  isLoading: boolean
  loadError: string | null
  lastDataRefresh: string
  usePreviewData: boolean
  dataTier: DataTier
  onRefresh: () => void
}

export function StatusTab(props: StatusTabProps) {
  return <StatusDashboard {...props} />
}
