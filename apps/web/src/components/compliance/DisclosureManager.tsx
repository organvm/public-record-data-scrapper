import { useState, useMemo } from 'react'
import { Disclosure, Deal, DisclosureStatus } from '@public-records/core'
import { Card, CardHeader, CardTitle, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Badge } from '@public-records/ui/badge'
import { ScrollArea } from '@public-records/ui/scroll-area'
import { Separator } from '@public-records/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@public-records/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@public-records/ui/dialog'
import {
  MagnifyingGlass,
  Scales,
  FileText,
  PaperPlaneRight,
  Download,
  Eye,
  CheckCircle,
  XCircle,
  Signature,
  Plus,
  Warning
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface DisclosureManagerProps {
  disclosures: Disclosure[]
  deals: Deal[]
  onGenerateDisclosure: (dealId: string) => void
  onSendDisclosure: (disclosureId: string) => void
  onDownloadDisclosure: (disclosure: Disclosure) => void
  onPreviewDisclosure: (disclosure: Disclosure) => void
  className?: string
}

type StatusFilter = 'all' | DisclosureStatus

const statusConfig: Record<
  DisclosureStatus,
  { color: string; bgColor: string; icon: typeof CheckCircle; label: string }
> = {
  draft: {
    color: 'text-slate-500',
    bgColor: 'bg-slate-500/10',
    icon: FileText,
    label: 'Draft'
  },
  generated: {
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    icon: FileText,
    label: 'Generated'
  },
  sent: {
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    icon: PaperPlaneRight,
    label: 'Sent'
  },
  viewed: {
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    icon: Eye,
    label: 'Viewed'
  },
  signed: {
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    icon: CheckCircle,
    label: 'Signed'
  },
  expired: {
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    icon: XCircle,
    label: 'Expired'
  },
  superseded: {
    color: 'text-slate-400',
    bgColor: 'bg-slate-400/10',
    icon: XCircle,
    label: 'Superseded'
  }
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

function formatPercent(value?: number): string {
  if (value === undefined || value === null) return '-'
  return `${value.toFixed(2)}%`
}

function formatDate(dateString?: string): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatDateTime(dateString?: string): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function DisclosureManager({
  disclosures,
  deals,
  onGenerateDisclosure,
  onSendDisclosure,
  onDownloadDisclosure,
  onPreviewDisclosure,
  className
}: DisclosureManagerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [stateFilter, setStateFilter] = useState<string>('all')
  const [selectedDisclosure, setSelectedDisclosure] = useState<Disclosure | null>(null)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [selectedDealId, setSelectedDealId] = useState('')

  // Get unique states from disclosures
  const uniqueStates = useMemo(() => {
    const states = new Set(disclosures.map((d) => d.state))
    return Array.from(states).sort()
  }, [disclosures])

  // Filter disclosures
  const filteredDisclosures = useMemo(() => {
    return disclosures
      .filter((disclosure) => {
        if (statusFilter !== 'all' && disclosure.status !== statusFilter) return false
        if (stateFilter !== 'all' && disclosure.state !== stateFilter) return false
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          return (
            disclosure.regulationName.toLowerCase().includes(query) ||
            disclosure.dealId.toLowerCase().includes(query) ||
            disclosure.state.toLowerCase().includes(query)
          )
        }
        return true
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [disclosures, statusFilter, stateFilter, searchQuery])

  // Calculate status summary
  const statusSummary = useMemo(() => {
    const summary: Record<DisclosureStatus, number> = {
      draft: 0,
      generated: 0,
      sent: 0,
      viewed: 0,
      signed: 0,
      expired: 0,
      superseded: 0
    }
    disclosures.forEach((d) => {
      summary[d.status]++
    })
    return summary
  }, [disclosures])

  // Deals without disclosures
  const dealsWithoutDisclosure = useMemo(() => {
    const dealIdsWithDisclosure = new Set(disclosures.map((d) => d.dealId))
    return deals.filter((deal) => !dealIdsWithDisclosure.has(deal.id))
  }, [deals, disclosures])

  const handleGenerateForDeal = () => {
    if (selectedDealId) {
      onGenerateDisclosure(selectedDealId)
      setShowGenerateDialog(false)
      setSelectedDealId('')
    }
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader className="border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Scales size={20} weight="fill" className="text-primary" />
            Disclosure Manager
            <Badge variant="secondary">{filteredDisclosures.length}</Badge>
          </CardTitle>
          <Button onClick={() => setShowGenerateDialog(true)}>
            <Plus size={14} weight="bold" className="mr-2" />
            Generate Disclosure
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Status Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {(Object.keys(statusConfig) as DisclosureStatus[]).map((status) => {
            const config = statusConfig[status]
            const count = statusSummary[status]
            const Icon = config.icon
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
                className={cn(
                  'p-3 rounded-lg text-center transition-colors',
                  config.bgColor,
                  statusFilter === status && 'ring-2 ring-primary'
                )}
              >
                <Icon size={20} weight="fill" className={cn('mx-auto mb-1', config.color)} />
                <p className="text-lg font-semibold">{count}</p>
                <p className="text-xs text-muted-foreground">{config.label}</p>
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={14}
              weight="bold"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search disclosures..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {uniqueStates.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Disclosures Table */}
        <div className="rounded-lg border">
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Regulation</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Funding Amount</TableHead>
                  <TableHead>APR</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDisclosures.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No disclosures found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDisclosures.map((disclosure) => {
                    const config = statusConfig[disclosure.status]
                    const Icon = config.icon
                    return (
                      <TableRow key={disclosure.id}>
                        <TableCell>
                          <Badge variant="outline" className={cn('gap-1', config.color)}>
                            <Icon size={12} weight="fill" />
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{disclosure.regulationName}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{disclosure.state}</Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {formatCurrency(disclosure.fundingAmount)}
                        </TableCell>
                        <TableCell className="font-mono">
                          {formatPercent(disclosure.aprEquivalent)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(disclosure.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setSelectedDisclosure(disclosure)}
                            >
                              <Eye size={14} weight="bold" />
                            </Button>
                            {disclosure.documentUrl && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => onDownloadDisclosure(disclosure)}
                              >
                                <Download size={14} weight="bold" />
                              </Button>
                            )}
                            {disclosure.status === 'generated' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-primary"
                                onClick={() => onSendDisclosure(disclosure.id)}
                              >
                                <PaperPlaneRight size={14} weight="bold" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>

        {/* Pending Disclosures Warning */}
        {dealsWithoutDisclosure.length > 0 && (
          <Card className="p-4 mt-4 bg-amber-500/10 border-amber-500/30">
            <div className="flex items-start gap-3">
              <Warning size={20} weight="fill" className="text-amber-500 mt-0.5" />
              <div>
                <h4 className="font-medium text-amber-700 dark:text-amber-400">
                  {dealsWithoutDisclosure.length} deals need disclosures
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  Some deals in your pipeline may require state-specific disclosures before funding.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowGenerateDialog(true)}
                >
                  Generate Disclosures
                </Button>
              </div>
            </div>
          </Card>
        )}
      </CardContent>

      {/* Detail Dialog */}
      <Dialog open={!!selectedDisclosure} onOpenChange={() => setSelectedDisclosure(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scales size={20} weight="fill" className="text-primary" />
              Disclosure Details
            </DialogTitle>
            <DialogDescription>
              {selectedDisclosure?.regulationName} - {selectedDisclosure?.state}
            </DialogDescription>
          </DialogHeader>

          {selectedDisclosure && (
            <div className="space-y-6">
              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const config = statusConfig[selectedDisclosure.status]
                    const Icon = config.icon
                    return (
                      <>
                        <div className={cn('p-2 rounded-lg', config.bgColor)}>
                          <Icon size={20} weight="fill" className={config.color} />
                        </div>
                        <div>
                          <p className="font-medium">{config.label}</p>
                          <p className="text-xs text-muted-foreground">Current Status</p>
                        </div>
                      </>
                    )
                  })()}
                </div>
                <Badge variant="outline">Version {selectedDisclosure.version}</Badge>
              </div>

              <Separator />

              {/* Financial Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Funding Amount</p>
                  <p className="text-xl font-semibold text-primary">
                    {formatCurrency(selectedDisclosure.fundingAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Total Dollar Cost</p>
                  <p className="text-xl font-semibold">
                    {formatCurrency(selectedDisclosure.totalDollarCost)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Finance Charge</p>
                  <p className="font-medium">{formatCurrency(selectedDisclosure.financeCharge)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">APR Equivalent</p>
                  <p className="font-medium">{formatPercent(selectedDisclosure.aprEquivalent)}</p>
                </div>
              </div>

              <Separator />

              {/* Payment Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Term</p>
                  <p className="font-medium">
                    {selectedDisclosure.termDays ? `${selectedDisclosure.termDays} days` : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Frequency</p>
                  <p className="font-medium capitalize">
                    {selectedDisclosure.paymentFrequency || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Amount</p>
                  <p className="font-medium">{formatCurrency(selectedDisclosure.paymentAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Number of Payments</p>
                  <p className="font-medium">{selectedDisclosure.numberOfPayments || '-'}</p>
                </div>
              </div>

              <Separator />

              {/* Signature Status */}
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Signature size={16} weight="fill" />
                  Signature Status
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Sent</p>
                    <p>{formatDateTime(selectedDisclosure.sentAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Viewed</p>
                    <p>{formatDateTime(selectedDisclosure.viewedAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Signed</p>
                    <p>{formatDateTime(selectedDisclosure.signedAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Signed By</p>
                    <p>{selectedDisclosure.signedBy || '-'}</p>
                  </div>
                  {selectedDisclosure.signedIp && (
                    <div>
                      <p className="text-muted-foreground">IP Address</p>
                      <p className="font-mono text-xs">{selectedDisclosure.signedIp}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">Expires</p>
                    <p>{formatDateTime(selectedDisclosure.expiresAt)}</p>
                  </div>
                </div>
              </div>

              <DialogFooter>
                {selectedDisclosure.status === 'generated' && (
                  <Button onClick={() => onSendDisclosure(selectedDisclosure.id)}>
                    <PaperPlaneRight size={14} weight="bold" className="mr-2" />
                    Send for Signature
                  </Button>
                )}
                {selectedDisclosure.documentUrl && (
                  <Button
                    variant="outline"
                    onClick={() => onDownloadDisclosure(selectedDisclosure)}
                  >
                    <Download size={14} weight="bold" className="mr-2" />
                    Download
                  </Button>
                )}
                <Button variant="outline" onClick={() => onPreviewDisclosure(selectedDisclosure)}>
                  <Eye size={14} weight="bold" className="mr-2" />
                  Preview
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Generate Dialog */}
      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Disclosure</DialogTitle>
            <DialogDescription>
              Select a deal to generate a state-compliant disclosure document.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Select value={selectedDealId} onValueChange={setSelectedDealId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a deal" />
              </SelectTrigger>
              <SelectContent>
                {dealsWithoutDisclosure.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    All deals have disclosures
                  </div>
                ) : (
                  dealsWithoutDisclosure.map((deal) => (
                    <SelectItem key={deal.id} value={deal.id}>
                      <div className="flex items-center gap-2">
                        <span>{deal.dealNumber || deal.id.slice(0, 8)}</span>
                        <span className="text-muted-foreground">-</span>
                        <span className="font-mono">{formatCurrency(deal.amountRequested)}</span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateForDeal} disabled={!selectedDealId}>
              <Plus size={14} weight="bold" className="mr-2" />
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
