import { useState, useMemo, useCallback } from 'react'
import { useSafeKV as useKV } from '@/hooks/useSparkKV'
import { Tabs, TabsContent } from '@public-records/ui/tabs'
import { StatsOverview } from '@/components/StatsOverview'
import { ProspectDetailDialog } from '@/components/ProspectDetailDialog'
import { StaleDataWarning } from '@/components/StaleDataWarning'
import { QuickAccessBanner } from '@/components/QuickAccessBanner'
import { DemoTour } from '@/components/DemoTour'

// Layout components
import { Header, LoadingAndErrorState, MobileBottomNav } from '@/components/layout'
import { CommandRail } from '@/components/layout/CommandRail'

// Feature tabs
import { ProspectsTab } from '@/features/prospects'
import { PortfolioTab } from '@/features/portfolio'
import { IntelligenceTab } from '@/features/intelligence'
import { AnalyticsTab } from '@/features/analytics'
import { RequalificationTab } from '@/features/requalification'
import { AgenticTab } from '@/features/agentic'
import { CoverageTab } from '@/features/coverage/CoverageTab'

// Hooks
import { useProspectFilters } from '@/hooks/useProspectFilters'
import { useProspectSorting } from '@/hooks/useProspectSorting'
import { useProspectSelection } from '@/hooks/useProspectSelection'
import { useDataFetching } from '@/hooks/useDataFetching'
import { useProspectActions } from '@/hooks/useProspectActions'
import { useNotesAndReminders } from '@/hooks/useNotesAndReminders'
import { useAgenticEngine } from '@/hooks/use-agentic-engine'
import { useSystemContext } from '@/hooks/useSystemContext'
import { useDataTier } from '@/hooks/useDataTier'

// Utils and types
import { generateDashboardStats } from '@/lib/demoData'
import { Prospect } from '@public-records/core'
import { ExportFormat } from '@/lib/exportUtils'
import { UserAction } from '@/lib/agentic/types'
import { logUserAction } from '@/lib/api/userActions'
import { toast } from 'sonner'

function App() {
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [exportFormat, setExportFormat] = useKV<ExportFormat>('export-format', 'json')
  const [tourOpen, setTourOpen] = useState(false)
  const { dataTier } = useDataTier()

  // Real, free public data (USAspending.gov) is the default source. Preview
  // (synthetic) data is opt-in via VITE_USE_MOCK_DATA=true, and is also used
  // automatically as a fallback if a live load fails — so the deck is never an
  // empty shell, but shows REAL data whenever it can.
  const mockFlag = String(import.meta.env.VITE_USE_MOCK_DATA ?? '').toLowerCase()
  const useDemoData = ['1', 'true', 'yes'].includes(mockFlag)

  // Data fetching
  const data = useDataFetching({ useMockData: useDemoData, dataTier })
  // Pull out stable references (useKV setter / useCallback fetcher) plus the
  // specific value the refresh handler reads, so the callbacks below can depend
  // on these instead of the whole `data` object, which is recreated every render
  // and would defeat their memoization.
  const { setUserActions, fetchData, loadError } = data

  // Filtering, sorting, and selection
  const filters = useProspectFilters(data.prospects)
  const sorting = useProspectSorting(filters.filteredProspects)
  const selection = useProspectSelection()

  // Notes and reminders
  const notesAndReminders = useNotesAndReminders()

  // Track user actions for agentic analysis
  const trackAction = useCallback(
    async (type: string, details: Record<string, unknown> = {}) => {
      const newAction: UserAction = {
        type,
        timestamp: new Date().toISOString(),
        details
      }

      setUserActions((current) => [...(current ?? []), newAction].slice(-100))

      if (!useDemoData) {
        try {
          await logUserAction(newAction)
        } catch (error) {
          console.error('Failed to persist user action', error)
        }
      }
    },
    // Depend only on the specific (stable) setter rather than the whole `data`
    // object, which is recreated every render and would defeat memoization.
    [setUserActions, useDemoData]
  )

  // Prospect actions (claim, unclaim, export, delete)
  const prospectActions = useProspectActions({
    useMockData: useDemoData,
    prospects: data.prospects,
    setProspects: data.setProspects,
    trackAction,
    exportFormat: exportFormat || 'json',
    hasFilters:
      filters.searchQuery !== '' ||
      filters.industryFilter !== 'all' ||
      filters.stateFilter !== 'all' ||
      filters.minScore > 0
  })

  // Agentic engine with system context
  const systemContext = useSystemContext({
    prospects: data.prospects,
    competitors: data.competitors,
    portfolio: data.portfolio,
    userActions: data.userActions
  })

  const agentic = useAgenticEngine(systemContext, {
    enabled: true,
    autonomousExecutionEnabled: false,
    safetyThreshold: 80
  })

  // Dashboard stats
  const stats = useMemo(() => {
    if (data.prospects.length === 0 || data.portfolio.length === 0) {
      return null
    }
    try {
      return generateDashboardStats(data.prospects, data.portfolio)
    } catch (error) {
      console.error('Failed to generate dashboard stats', error)
      return null
    }
  }, [data.prospects, data.portfolio])

  // Handlers
  const handleRefreshData = useCallback(async () => {
    const success = await fetchData()
    if (success) {
      void trackAction('refresh-data')
      toast.success('Data refreshed', {
        description: useDemoData
          ? 'Demo data regenerated for offline preview mode.'
          : 'Latest datasets synchronized from ingestion services.'
      })
    } else {
      toast.error('Refresh failed', {
        description: loadError ?? 'Unable to refresh data from the server.'
      })
    }
  }, [fetchData, trackAction, useDemoData, loadError])

  const handleProspectSelect = useCallback(
    (prospect: Prospect) => {
      setSelectedProspect(prospect)
      setDialogOpen(true)
      void trackAction('prospect-select', { prospectId: prospect.id })
    },
    [trackAction]
  )

  const handleClaimFromDialog = useCallback(
    async (prospect: Prospect) => {
      await prospectActions.handleClaimLead(prospect)
      setSelectedProspect(null)
      setDialogOpen(false)
    },
    [prospectActions]
  )

  return (
    <Tabs defaultValue="prospects" className="min-h-screen">
      <div className="flex min-h-screen">
        <CommandRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onRefresh={handleRefreshData}
            dataSource={data.dataSource}
            dataSourceName={data.dataSourceName}
          />
          <QuickAccessBanner />
          <DemoTour isOpen={tourOpen} onClose={() => setTourOpen(false)} />

          <main className="flex-1 px-3 py-4 pb-24 sm:px-4 sm:py-6 md:px-6 md:py-8 md:pb-8 lg:px-8">
            <div className="mx-auto max-w-[1600px] space-y-4 sm:space-y-6 md:space-y-8">
              <LoadingAndErrorState
                isLoading={data.isLoading}
                loadError={data.loadError}
                onRetry={() => void data.fetchData()}
              />

              {stats ? (
                <StatsOverview stats={stats} />
              ) : (
                !data.isLoading && (
                  <div className="glass-effect border border-white/10 rounded-lg p-4 text-sm text-white/70">
                    No aggregated metrics are available yet. Refresh to pull the latest insights.
                  </div>
                )
              )}

              {data.lastDataRefresh && (
                <StaleDataWarning
                  lastUpdated={data.lastDataRefresh}
                  onRefresh={handleRefreshData}
                />
              )}

              <TabsContent value="prospects" className="space-y-4 sm:space-y-6">
                <ProspectsTab
                  prospects={data.prospects}
                  filteredProspects={sorting.sortedProspects}
                  totalCount={data.prospects.length}
                  searchQuery={filters.searchQuery}
                  industryFilter={filters.industryFilter}
                  stateFilter={filters.stateFilter}
                  minScore={filters.minScore}
                  advancedFilters={filters.advancedFilters}
                  activeFilterCount={filters.activeFilterCount}
                  industries={filters.industries}
                  states={filters.states}
                  sortField={sorting.sortField}
                  sortDirection={sorting.sortDirection}
                  selectedIds={selection.selectedIds}
                  exportFormat={exportFormat || 'json'}
                  onSearchChange={filters.setSearchQuery}
                  onIndustryChange={filters.setIndustryFilter}
                  onStateChange={filters.setStateFilter}
                  onMinScoreChange={filters.setMinScore}
                  onAdvancedFiltersChange={filters.setAdvancedFilters}
                  onSortChange={sorting.handleSortChange}
                  onSelectionChange={selection.setSelectedIds}
                  onExportFormatChange={(format) => setExportFormat(format)}
                  onProspectSelect={handleProspectSelect}
                  onBatchClaim={prospectActions.handleBatchClaim}
                  onBatchExport={prospectActions.handleBatchExport}
                  onBatchDelete={prospectActions.handleBatchDelete}
                />
              </TabsContent>

              <TabsContent value="portfolio" className="space-y-4 sm:space-y-6">
                <PortfolioTab portfolio={data.portfolio} />
              </TabsContent>

              <TabsContent value="intelligence" className="space-y-4 sm:space-y-6">
                <IntelligenceTab competitors={data.competitors} />
              </TabsContent>

              <TabsContent value="analytics" className="space-y-4 sm:space-y-6">
                <AnalyticsTab
                  prospects={data.prospects}
                  portfolio={data.portfolio}
                  dataTier={dataTier}
                  usePreviewData={useDemoData}
                />
              </TabsContent>

              <TabsContent value="requalification" className="space-y-4 sm:space-y-6">
                <RequalificationTab />
              </TabsContent>

              <TabsContent value="coverage" className="space-y-4 sm:space-y-6">
                <CoverageTab />
              </TabsContent>

              <TabsContent value="agentic" className="space-y-4 sm:space-y-6">
                <AgenticTab agentic={agentic} competitors={data.competitors} />
              </TabsContent>
            </div>
          </main>
          <MobileBottomNav />
        </div>
      </div>

      <ProspectDetailDialog
        prospect={selectedProspect}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onClaim={handleClaimFromDialog}
        onUnclaim={prospectActions.handleUnclaimLead}
        onExport={prospectActions.handleExportProspect}
        notes={notesAndReminders.notes}
        reminders={notesAndReminders.reminders}
        onAddNote={notesAndReminders.handleAddNote}
        onDeleteNote={notesAndReminders.handleDeleteNote}
        onAddReminder={notesAndReminders.handleAddReminder}
        onCompleteReminder={notesAndReminders.handleCompleteReminder}
        onDeleteReminder={notesAndReminders.handleDeleteReminder}
        onSendEmail={(email) => notesAndReminders.handleSendEmail(email, trackAction)}
      />
    </Tabs>
  )
}

export default App
