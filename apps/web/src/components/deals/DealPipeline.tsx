import { useState, useMemo } from 'react'
import { Deal, DealStage } from '@public-records/core'
import { Card, CardHeader, CardTitle, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Badge } from '@public-records/ui/badge'
import { Progress } from '@public-records/ui/progress'
import { ScrollArea, ScrollBar } from '@public-records/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@public-records/ui/dropdown-menu'
import {
  Plus,
  DotsThreeVertical,
  CurrencyDollar,
  Clock,
  ArrowRight,
  Buildings
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

// Default stages if none provided
const DEFAULT_STAGES: DealStage[] = [
  {
    id: 'lead',
    orgId: '',
    name: 'Lead',
    slug: 'lead',
    stageOrder: 1,
    isTerminal: false,
    color: '#6366f1',
    autoActions: {},
    createdAt: ''
  },
  {
    id: 'contacted',
    orgId: '',
    name: 'Contacted',
    slug: 'contacted',
    stageOrder: 2,
    isTerminal: false,
    color: '#8b5cf6',
    autoActions: {},
    createdAt: ''
  },
  {
    id: 'pack-submitted',
    orgId: '',
    name: 'Pack Submitted',
    slug: 'pack-submitted',
    stageOrder: 3,
    isTerminal: false,
    color: '#a855f7',
    autoActions: {},
    createdAt: ''
  },
  {
    id: 'underwriting',
    orgId: '',
    name: 'Underwriting',
    slug: 'underwriting',
    stageOrder: 4,
    isTerminal: false,
    color: '#ec4899',
    autoActions: {},
    createdAt: ''
  },
  {
    id: 'approved',
    orgId: '',
    name: 'Approved',
    slug: 'approved',
    stageOrder: 5,
    isTerminal: false,
    color: '#14b8a6',
    autoActions: {},
    createdAt: ''
  },
  {
    id: 'funded',
    orgId: '',
    name: 'Funded',
    slug: 'funded',
    stageOrder: 6,
    isTerminal: true,
    terminalType: 'won',
    color: '#22c55e',
    autoActions: {},
    createdAt: ''
  }
]

interface DealPipelineProps {
  deals: Deal[]
  stages?: DealStage[]
  onDealClick: (deal: Deal) => void
  onDealCreate: () => void
  onDealStageChange: (dealId: string, newStageId: string) => void
  onDealEdit: (deal: Deal) => void
  onDealDelete: (deal: Deal) => void
  className?: string
}

interface DealCardProps {
  deal: Deal
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  onMoveToStage: (stageId: string) => void
  stages: DealStage[]
  currentStage: DealStage
}

function formatCurrency(amount?: number): string {
  if (amount === undefined || amount === null) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

function getDaysInStage(deal: Deal): number {
  const updatedAt = new Date(deal.updatedAt)
  const now = new Date()
  return Math.floor((now.getTime() - updatedAt.getTime()) / 86400000)
}

function getPriorityColor(priority: Deal['priority']): string {
  switch (priority) {
    case 'urgent':
      return 'bg-red-500'
    case 'high':
      return 'bg-orange-500'
    case 'normal':
      return 'bg-blue-500'
    case 'low':
      return 'bg-slate-400'
    default:
      return 'bg-slate-400'
  }
}

function DealCard({
  deal,
  onClick,
  onEdit,
  onDelete,
  onMoveToStage,
  stages,
  currentStage
}: DealCardProps) {
  const daysInStage = getDaysInStage(deal)
  const availableAmount = deal.amountFunded || deal.amountApproved || deal.amountRequested

  return (
    <Card
      className="p-3 cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('w-2 h-2 rounded-full', getPriorityColor(deal.priority))} />
          <span className="font-medium text-sm truncate">
            {deal.dealNumber || `Deal-${deal.id.slice(0, 6)}`}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <DotsThreeVertical size={14} weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
            >
              Edit Deal
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Move to</div>
            {stages
              .filter((s) => s.id !== currentStage.id)
              .map((stage) => (
                <DropdownMenuItem
                  key={stage.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMoveToStage(stage.id)
                  }}
                >
                  <ArrowRight size={14} className="mr-2" />
                  {stage.name}
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="text-destructive"
            >
              Delete Deal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Amount */}
      {availableAmount && (
        <div className="flex items-center gap-1 mb-2">
          <CurrencyDollar size={14} className="text-primary" weight="bold" />
          <span className="font-semibold text-primary">{formatCurrency(availableAmount)}</span>
        </div>
      )}

      {/* Metrics Row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock size={12} weight="bold" />
          <span>{daysInStage}d</span>
        </div>
        {deal.probability !== undefined && (
          <Badge variant="outline" className="text-xs py-0 px-1.5">
            {deal.probability}%
          </Badge>
        )}
      </div>

      {/* Progress indicator for underwriting */}
      {deal.bankConnected && (
        <div className="mt-2">
          <Progress value={deal.probability || 0} className="h-1" />
        </div>
      )}
    </Card>
  )
}

export function DealPipeline({
  deals,
  stages = DEFAULT_STAGES,
  onDealClick,
  onDealCreate,
  onDealStageChange,
  onDealEdit,
  onDealDelete,
  className
}: DealPipelineProps) {
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null)

  // Sort stages by order
  const sortedStages = useMemo(() => {
    return [...stages].sort((a, b) => a.stageOrder - b.stageOrder)
  }, [stages])

  // Group deals by stage
  const dealsByStage = useMemo(() => {
    const grouped: Record<string, Deal[]> = {}
    sortedStages.forEach((stage) => {
      grouped[stage.id] = deals.filter((deal) => deal.stageId === stage.id)
    })
    return grouped
  }, [deals, sortedStages])

  // Calculate stage metrics
  const stageMetrics = useMemo(() => {
    const metrics: Record<string, { count: number; totalValue: number }> = {}
    sortedStages.forEach((stage) => {
      const stageDeals = dealsByStage[stage.id] || []
      metrics[stage.id] = {
        count: stageDeals.length,
        totalValue: stageDeals.reduce((sum, deal) => {
          const amount = deal.amountFunded || deal.amountApproved || deal.amountRequested || 0
          return sum + amount
        }, 0)
      }
    })
    return metrics
  }, [dealsByStage, sortedStages])

  // Calculate conversion rates
  const conversionRates = useMemo(() => {
    const rates: Record<string, number> = {}
    for (let i = 1; i < sortedStages.length; i++) {
      const prevStage = sortedStages[i - 1]
      const currentStage = sortedStages[i]
      const prevCount = stageMetrics[prevStage.id]?.count || 0
      const currentCount = stageMetrics[currentStage.id]?.count || 0
      rates[currentStage.id] = prevCount > 0 ? Math.round((currentCount / prevCount) * 100) : 0
    }
    return rates
  }, [sortedStages, stageMetrics])

  // Total pipeline value
  const totalPipelineValue = useMemo(() => {
    return Object.values(stageMetrics).reduce((sum, m) => sum + m.totalValue, 0)
  }, [stageMetrics])

  // Drag and drop handlers
  const handleDragStart = (dealId: string) => {
    setDraggedDealId(dealId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (stageId: string) => {
    if (draggedDealId) {
      onDealStageChange(draggedDealId, stageId)
      setDraggedDealId(null)
    }
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Buildings size={24} weight="fill" className="text-primary" />
            Deal Pipeline
          </h2>
          <p className="text-sm text-muted-foreground">
            {deals.length} deals worth {formatCurrency(totalPipelineValue)}
          </p>
        </div>
        <Button onClick={onDealCreate}>
          <Plus size={16} weight="bold" className="mr-2" />
          New Deal
        </Button>
      </div>

      {/* Pipeline Kanban */}
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4" style={{ minWidth: `${sortedStages.length * 280}px` }}>
          {sortedStages.map((stage, index) => {
            const stageDeals = dealsByStage[stage.id] || []
            const metrics = stageMetrics[stage.id]
            const conversionRate = conversionRates[stage.id]

            return (
              <div
                key={stage.id}
                className={cn(
                  'flex-1 min-w-[260px] max-w-[320px] rounded-lg border-2 transition-colors',
                  draggedDealId ? 'border-dashed border-primary/50' : 'border-transparent'
                )}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(stage.id)}
              >
                <Card className="h-full">
                  {/* Stage Header */}
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: stage.color || '#6366f1' }}
                        />
                        <CardTitle className="text-sm">{stage.name}</CardTitle>
                        <Badge variant="secondary" className="text-xs">
                          {metrics.count}
                        </Badge>
                      </div>
                      {index > 0 && conversionRate !== undefined && (
                        <Badge variant="outline" className="text-xs">
                          {conversionRate}%
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {formatCurrency(metrics.totalValue)}
                    </p>
                  </CardHeader>

                  <CardContent className="pt-0">
                    <ScrollArea className="h-[calc(100vh-320px)] pr-2">
                      <div className="space-y-2">
                        {stageDeals.length === 0 ? (
                          <div className="text-center py-8 text-sm text-muted-foreground">
                            No deals in this stage
                          </div>
                        ) : (
                          stageDeals.map((deal) => (
                            <div
                              key={deal.id}
                              draggable
                              onDragStart={() => handleDragStart(deal.id)}
                            >
                              <DealCard
                                deal={deal}
                                onClick={() => onDealClick(deal)}
                                onEdit={() => onDealEdit(deal)}
                                onDelete={() => onDealDelete(deal)}
                                onMoveToStage={(stageId) => onDealStageChange(deal.id, stageId)}
                                stages={sortedStages}
                                currentStage={stage}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Summary Stats */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-6 justify-center">
          {sortedStages.map((stage) => {
            const metrics = stageMetrics[stage.id]
            return (
              <div key={stage.id} className="text-center">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: stage.color || '#6366f1' }}
                  />
                  <span className="text-xs text-muted-foreground">{stage.name}</span>
                </div>
                <div className="text-lg font-semibold">{metrics.count}</div>
                <div className="text-xs text-muted-foreground">
                  {formatCurrency(metrics.totalValue)}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
