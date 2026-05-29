import { useState } from 'react'
import { Input } from '@public-records/ui/input'
import { Checkbox } from '@public-records/ui/checkbox'
import { Button } from '@public-records/ui/button'
import { Badge } from '@public-records/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@public-records/ui/sheet'
import { ProspectCard } from '@/components/ProspectCard'
import { AdvancedFilters } from '@/components/AdvancedFilters'
import { AdvancedFilterState } from '@/components/advanced-filters'
import { BatchOperations } from '@/components/BatchOperations'
import { SortControls, SortField, SortDirection } from '@/components/SortControls'
import { Prospect, IndustryType } from '@public-records/core'
import { ExportFormat } from '@/lib/exportUtils'
import { MagnifyingGlass, Faders } from '@phosphor-icons/react'
import { useIsMobile } from '@public-records/ui/use-mobile'

interface ProspectsTabProps {
  // Data
  prospects: Prospect[]
  filteredProspects: Prospect[]
  totalCount: number
  // Filters
  searchQuery: string
  industryFilter: string
  stateFilter: string
  minScore: number
  advancedFilters: AdvancedFilterState
  activeFilterCount: number
  industries: IndustryType[]
  states: string[]
  // Sort
  sortField: SortField
  sortDirection: SortDirection
  // Selection
  selectedIds: Set<string>
  // Export
  exportFormat: ExportFormat
  // Callbacks
  onSearchChange: (query: string) => void
  onIndustryChange: (industry: string) => void
  onStateChange: (state: string) => void
  onMinScoreChange: (score: number) => void
  onAdvancedFiltersChange: (filters: AdvancedFilterState) => void
  onSortChange: (field: SortField, direction: SortDirection) => void
  onSelectionChange: (ids: Set<string>) => void
  onExportFormatChange: (format: ExportFormat) => void
  onProspectSelect: (prospect: Prospect) => void
  onBatchClaim: (ids: string[]) => void
  onBatchExport: (ids: string[]) => void
  onBatchDelete: (ids: string[]) => void
}

export function ProspectsTab({
  prospects: _prospects,
  filteredProspects,
  totalCount,
  searchQuery,
  industryFilter,
  stateFilter,
  minScore,
  advancedFilters,
  activeFilterCount,
  industries,
  states,
  sortField,
  sortDirection,
  selectedIds,
  exportFormat,
  onSearchChange,
  onIndustryChange,
  onStateChange,
  onMinScoreChange,
  onAdvancedFiltersChange,
  onSortChange,
  onSelectionChange,
  onExportFormatChange,
  onProspectSelect,
  onBatchClaim,
  onBatchExport,
  onBatchDelete
}: ProspectsTabProps) {
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const isMobile = useIsMobile()

  // Count total active filters for FAB badge
  const totalActiveFilters =
    activeFilterCount +
    (industryFilter !== 'all' ? 1 : 0) +
    (stateFilter !== 'all' ? 1 : 0) +
    (minScore > 0 ? 1 : 0)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Search and Filter Controls */}
      <div className="flex flex-col gap-3 sm:gap-4">
        {/* Search - always visible */}
        <div className="relative flex-1">
          <MagnifyingGlass
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70"
          />
          <Input
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 glass-effect border-white/30 text-white placeholder:text-white/50 h-10 sm:h-11"
          />
        </div>

        {/* Desktop filter dropdowns - hidden on mobile */}
        <div className="hidden md:flex gap-2 flex-wrap">
          <Select value={industryFilter} onValueChange={onIndustryChange}>
            <SelectTrigger className="flex-1 min-w-[140px] sm:w-[180px] glass-effect border-white/30 text-white h-10 sm:h-11">
              <SelectValue placeholder="Industry" />
            </SelectTrigger>
            <SelectContent className="glass-effect border-white/30">
              <SelectItem value="all">All Industries</SelectItem>
              {industries.map((ind) => (
                <SelectItem key={ind} value={ind} className="capitalize">
                  {ind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={onStateChange}>
            <SelectTrigger className="flex-1 min-w-[100px] sm:w-[140px] glass-effect border-white/30 text-white h-10 sm:h-11">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent className="glass-effect border-white/30">
              <SelectItem value="all">All States</SelectItem>
              {states.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={minScore.toString()}
            onValueChange={(val) => onMinScoreChange(Number(val))}
          >
            <SelectTrigger className="flex-1 min-w-[120px] sm:w-[140px] glass-effect border-white/30 text-white h-10 sm:h-11">
              <SelectValue placeholder="Min Score" />
            </SelectTrigger>
            <SelectContent className="glass-effect border-white/30">
              <SelectItem value="0">Any Score</SelectItem>
              <SelectItem value="50">50+</SelectItem>
              <SelectItem value="70">70+ (High)</SelectItem>
              <SelectItem value="85">85+ (Elite)</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={exportFormat}
            onValueChange={(val) => onExportFormatChange(val as ExportFormat)}
          >
            <SelectTrigger className="flex-1 min-w-[110px] sm:w-[130px] glass-effect border-white/30 text-white h-10 sm:h-11">
              <SelectValue placeholder="Export Format" />
            </SelectTrigger>
            <SelectContent className="glass-effect border-white/30">
              <SelectItem value="json">Export: JSON</SelectItem>
              <SelectItem value="csv">Export: CSV</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results Header and Controls */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="text-xs sm:text-sm text-white/70">
              Showing {filteredProspects.length} of {totalCount} prospects
            </div>
            <SortControls
              sortField={sortField}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
            />
          </div>
          {/* Desktop Advanced Filters */}
          <div className="hidden md:block">
            <AdvancedFilters
              filters={advancedFilters}
              onFiltersChange={onAdvancedFiltersChange}
              activeFilterCount={activeFilterCount}
            />
          </div>
        </div>

        <BatchOperations
          prospects={filteredProspects}
          selectedIds={selectedIds}
          onSelectionChange={onSelectionChange}
          onBatchClaim={onBatchClaim}
          onBatchExport={onBatchExport}
          onBatchDelete={onBatchDelete}
        />

        {/* Prospect Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {filteredProspects.map((prospect, index) => {
            const isSelected = selectedIds.has(prospect.id)
            return (
              <div
                key={prospect.id}
                className="relative h-full"
                {...(index === 0 ? { 'data-tour': 'prospect-card' } : {})}
              >
                <div className="absolute top-3 sm:top-4 left-3 sm:left-4 z-10">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      const newSelected = new Set(selectedIds)
                      if (checked) {
                        newSelected.add(prospect.id)
                      } else {
                        newSelected.delete(prospect.id)
                      }
                      onSelectionChange(newSelected)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="glass-effect border-white/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                </div>
                <ProspectCard prospect={prospect} onSelect={onProspectSelect} />
              </div>
            )
          })}
        </div>

        {/* Empty State */}
        {filteredProspects.length === 0 && (
          <div className="text-center py-12 text-white/70 glass-effect rounded-lg p-8">
            No prospects match your current filters
          </div>
        )}
      </div>

      {/* Mobile Filter FAB */}
      {isMobile && (
        <Button
          onClick={() => setFilterSheetOpen(true)}
          className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full shadow-lg touch-target"
          size="icon"
          aria-label="Open filters"
          title="Open filters"
        >
          <Faders size={24} weight="bold" />
          <span className="sr-only">Open filters</span>
          {totalActiveFilters > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px] bg-accent">
              {totalActiveFilters}
            </Badge>
          )}
        </Button>
      )}

      {/* Mobile Filter Sheet */}
      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent
          side="bottom"
          className="glass-effect rounded-t-2xl max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader className="pb-4">
            <SheetTitle>Filters & Sort</SheetTitle>
            <SheetDescription>Refine your prospect search</SheetDescription>
          </SheetHeader>

          <div className="space-y-6 pb-8">
            {/* Sort */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Sort By</label>
              <SortControls
                sortField={sortField}
                sortDirection={sortDirection}
                onSortChange={onSortChange}
              />
            </div>

            {/* Industry Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Industry</label>
              <Select value={industryFilter} onValueChange={onIndustryChange}>
                <SelectTrigger className="w-full glass-effect border-white/30 text-white h-12 touch-target">
                  <SelectValue placeholder="All Industries" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="all">All Industries</SelectItem>
                  {industries.map((ind) => (
                    <SelectItem key={ind} value={ind} className="capitalize h-11 touch-target">
                      {ind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* State Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">State</label>
              <Select value={stateFilter} onValueChange={onStateChange}>
                <SelectTrigger className="w-full glass-effect border-white/30 text-white h-12 touch-target">
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="all">All States</SelectItem>
                  {states.map((state) => (
                    <SelectItem key={state} value={state} className="h-11 touch-target">
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Min Score Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Minimum Score</label>
              <Select
                value={minScore.toString()}
                onValueChange={(val) => onMinScoreChange(Number(val))}
              >
                <SelectTrigger className="w-full glass-effect border-white/30 text-white h-12 touch-target">
                  <SelectValue placeholder="Any Score" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="0" className="h-11 touch-target">
                    Any Score
                  </SelectItem>
                  <SelectItem value="50" className="h-11 touch-target">
                    50+
                  </SelectItem>
                  <SelectItem value="70" className="h-11 touch-target">
                    70+ (High)
                  </SelectItem>
                  <SelectItem value="85" className="h-11 touch-target">
                    85+ (Elite)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Export Format */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Export Format</label>
              <Select
                value={exportFormat}
                onValueChange={(val) => onExportFormatChange(val as ExportFormat)}
              >
                <SelectTrigger className="w-full glass-effect border-white/30 text-white h-12 touch-target">
                  <SelectValue placeholder="JSON" />
                </SelectTrigger>
                <SelectContent className="glass-effect border-white/30">
                  <SelectItem value="json" className="h-11 touch-target">
                    JSON
                  </SelectItem>
                  <SelectItem value="csv" className="h-11 touch-target">
                    CSV
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Advanced Filters */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Advanced Filters</label>
              <AdvancedFilters
                filters={advancedFilters}
                onFiltersChange={onAdvancedFiltersChange}
                activeFilterCount={activeFilterCount}
              />
            </div>

            {/* Apply Button */}
            <Button onClick={() => setFilterSheetOpen(false)} className="w-full h-12 touch-target">
              Apply Filters
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
