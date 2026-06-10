import { useState } from 'react'
import {
  Deal,
  DealStage,
  DealDocument,
  DocumentType,
  Disclosure,
  Contact,
  Prospect
} from '@public-records/core'
import { Card, CardHeader, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Badge } from '@public-records/ui/badge'
import { Progress } from '@public-records/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@public-records/ui/tabs'
import { ActivityTimeline } from '@/components/shared/ActivityTimeline'
import {
  ArrowLeft,
  PencilSimple,
  CurrencyDollar,
  Calendar,
  Clock,
  Buildings,
  User,
  FileText,
  Upload,
  CheckCircle,
  XCircle,
  WarningCircle,
  Bank,
  ChartLine,
  Scales,
  CaretRight,
  Download
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'
import { ContactActivity } from '@public-records/core'

interface DealDetailProps {
  deal: Deal
  stage: DealStage
  documents: DealDocument[]
  disclosure?: Disclosure | null
  contact?: Contact | null
  prospect?: Prospect | null
  activities: ContactActivity[]
  onBack: () => void
  onEdit: () => void
  onStageChange: (newStageId: string) => void
  onDocumentUpload: (documentType: DocumentType) => void
  onDocumentDownload: (document: DealDocument) => void
  onGenerateDisclosure: () => void
  onSendDisclosure: () => void
  stages: DealStage[]
  className?: string
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

function formatDate(dateString?: string): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatPercent(value?: number): string {
  if (value === undefined || value === null) return '-'
  return `${value.toFixed(2)}%`
}

const documentTypeLabels: Record<DocumentType, string> = {
  application: 'Application',
  bank_statement: 'Bank Statements',
  tax_return: 'Tax Returns',
  voided_check: 'Voided Check',
  drivers_license: "Driver's License",
  business_license: 'Business License',
  landlord_letter: 'Landlord Letter',
  contract: 'Contract',
  signed_contract: 'Signed Contract',
  disclosure: 'Disclosure',
  signed_disclosure: 'Signed Disclosure',
  other: 'Other Documents'
}

const requiredDocuments: DocumentType[] = [
  'application',
  'bank_statement',
  'voided_check',
  'drivers_license'
]

const disclosureStatusConfig: Record<
  string,
  { color: string; icon: typeof CheckCircle; label: string }
> = {
  draft: { color: 'text-slate-500', icon: FileText, label: 'Draft' },
  generated: { color: 'text-blue-500', icon: FileText, label: 'Generated' },
  sent: { color: 'text-amber-500', icon: Clock, label: 'Sent' },
  viewed: { color: 'text-purple-500', icon: CheckCircle, label: 'Viewed' },
  signed: { color: 'text-green-500', icon: CheckCircle, label: 'Signed' },
  expired: { color: 'text-red-500', icon: XCircle, label: 'Expired' },
  superseded: { color: 'text-slate-400', icon: XCircle, label: 'Superseded' }
}

export function DealDetail({
  deal,
  stage,
  documents,
  disclosure,
  contact,
  prospect,
  activities,
  onBack,
  onEdit,
  onStageChange,
  onDocumentUpload,
  onDocumentDownload,
  onGenerateDisclosure,
  onSendDisclosure,
  stages,
  className
}: DealDetailProps) {
  const [activeTab, setActiveTab] = useState('overview')

  // Calculate document completion
  const documentsByType = documents.reduce(
    (acc, doc) => {
      acc[doc.documentType] = doc
      return acc
    },
    {} as Record<DocumentType, DealDocument>
  )

  const requiredDocsCount = requiredDocuments.length
  const completedDocsCount = requiredDocuments.filter((type) => documentsByType[type]).length
  const documentProgress = Math.round((completedDocsCount / requiredDocsCount) * 100)

  // Sort stages for progression display
  const sortedStages = [...stages].sort((a, b) => a.stageOrder - b.stageOrder)
  const currentStageIndex = sortedStages.findIndex((s) => s.id === stage.id)

  // Underwriting metrics
  const hasUnderwritingData = deal.bankConnected && deal.averageDailyBalance !== undefined

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} weight="bold" className="mr-2" />
          Back
        </Button>
      </div>

      {/* Deal Header Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            {/* Deal Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-semibold">
                  {deal.dealNumber || `Deal-${deal.id.slice(0, 8)}`}
                </h2>
                <Badge style={{ backgroundColor: stage.color || '#6366f1' }} className="text-white">
                  {stage.name}
                </Badge>
                <Badge
                  variant={
                    deal.priority === 'urgent'
                      ? 'destructive'
                      : deal.priority === 'high'
                        ? 'default'
                        : 'outline'
                  }
                >
                  {deal.priority.charAt(0).toUpperCase() + deal.priority.slice(1)}
                </Badge>
              </div>

              {/* Amount Summary */}
              <div className="flex flex-wrap gap-6 mt-4">
                <div>
                  <p className="text-xs text-muted-foreground">Requested</p>
                  <p className="text-xl font-semibold text-primary">
                    {formatCurrency(deal.amountRequested)}
                  </p>
                </div>
                {deal.amountApproved && (
                  <div>
                    <p className="text-xs text-muted-foreground">Approved</p>
                    <p className="text-xl font-semibold text-green-500">
                      {formatCurrency(deal.amountApproved)}
                    </p>
                  </div>
                )}
                {deal.amountFunded && (
                  <div>
                    <p className="text-xs text-muted-foreground">Funded</p>
                    <p className="text-xl font-semibold text-emerald-500">
                      {formatCurrency(deal.amountFunded)}
                    </p>
                  </div>
                )}
              </div>

              {/* Stage Progression */}
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  {sortedStages.map((s, index) => {
                    const isCompleted = index < currentStageIndex
                    const isCurrent = s.id === stage.id
                    return (
                      <div key={s.id} className="flex items-center">
                        <button
                          onClick={() => onStageChange(s.id)}
                          className={cn(
                            'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors',
                            isCompleted
                              ? 'bg-green-500 text-white'
                              : isCurrent
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          )}
                          title={`Move to ${s.name}`}
                        >
                          {index + 1}
                        </button>
                        {index < sortedStages.length - 1 && (
                          <CaretRight
                            size={14}
                            className={cn(
                              'mx-1',
                              isCompleted ? 'text-green-500' : 'text-muted-foreground'
                            )}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  {sortedStages.map((s) => (
                    <span key={s.id} className="flex-1 text-center truncate">
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-col gap-2">
              <Button onClick={onEdit}>
                <PencilSimple size={14} weight="bold" className="mr-2" />
                Edit Deal
              </Button>
              {!disclosure && (
                <Button variant="outline" onClick={onGenerateDisclosure}>
                  <Scales size={14} weight="bold" className="mr-2" />
                  Generate Disclosure
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <CardHeader className="pb-0">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="documents">
                Documents
                <Badge variant="secondary" className="ml-2">
                  {documents.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="underwriting">Underwriting</TabsTrigger>
              <TabsTrigger value="disclosure">Disclosure</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="pt-4">
            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-0 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Deal Terms */}
                <Card className="p-4">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <CurrencyDollar size={16} weight="fill" className="text-primary" />
                    Deal Terms
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Term</span>
                      <span>{deal.termMonths ? `${deal.termMonths} months` : '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Factor Rate</span>
                      <span>{deal.factorRate ? deal.factorRate.toFixed(2) : '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Daily Payment</span>
                      <span>{formatCurrency(deal.dailyPayment)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Weekly Payment</span>
                      <span>{formatCurrency(deal.weeklyPayment)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Payback</span>
                      <span className="font-medium">{formatCurrency(deal.totalPayback)}</span>
                    </div>
                    {deal.commissionAmount && (
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-muted-foreground">Commission</span>
                        <span className="text-green-500 font-medium">
                          {formatCurrency(deal.commissionAmount)}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Use of Funds */}
                <Card className="p-4">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Buildings size={16} weight="fill" className="text-primary" />
                    Use of Funds
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Purpose</span>
                      <p className="font-medium capitalize">{deal.useOfFunds || '-'}</p>
                    </div>
                    {deal.useOfFundsDetails && (
                      <div>
                        <span className="text-muted-foreground">Details</span>
                        <p className="text-sm mt-1">{deal.useOfFundsDetails}</p>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Key Dates */}
                <Card className="p-4">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Calendar size={16} weight="fill" className="text-primary" />
                    Key Dates
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created</span>
                      <span>{formatDate(deal.createdAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Submitted</span>
                      <span>{formatDate(deal.submittedAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Approved</span>
                      <span>{formatDate(deal.approvedAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Funded</span>
                      <span>{formatDate(deal.fundedAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expected Close</span>
                      <span>{formatDate(deal.expectedCloseDate)}</span>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Contact & Prospect Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contact && (
                  <Card className="p-4">
                    <h3 className="font-medium mb-4 flex items-center gap-2">
                      <User size={16} weight="fill" className="text-primary" />
                      Contact
                    </h3>
                    <div className="text-sm">
                      <p className="font-medium">
                        {contact.firstName} {contact.lastName}
                      </p>
                      <p className="text-muted-foreground">{contact.email}</p>
                      <p className="text-muted-foreground">{contact.phone}</p>
                    </div>
                  </Card>
                )}
                {prospect && (
                  <Card className="p-4">
                    <h3 className="font-medium mb-4 flex items-center gap-2">
                      <Buildings size={16} weight="fill" className="text-primary" />
                      Business
                    </h3>
                    <div className="text-sm">
                      <p className="font-medium">{prospect.companyName}</p>
                      <p className="text-muted-foreground capitalize">
                        {prospect.industry} - {prospect.state}
                      </p>
                      <Badge variant="outline" className="mt-2">
                        Score: {prospect.priorityScore}
                      </Badge>
                    </div>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* Documents Tab */}
            <TabsContent value="documents" className="mt-0">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">
                    Document Completion: {completedDocsCount}/{requiredDocsCount} required
                  </span>
                  <span className="text-sm font-medium">{documentProgress}%</span>
                </div>
                <Progress value={documentProgress} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Object.keys(documentTypeLabels) as DocumentType[]).map((docType) => {
                  const doc = documentsByType[docType]
                  const isRequired = requiredDocuments.includes(docType)

                  return (
                    <Card
                      key={docType}
                      className={cn(
                        'p-4',
                        doc ? 'border-green-500/50' : isRequired ? 'border-amber-500/50' : ''
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-10 h-10 rounded-lg flex items-center justify-center',
                              doc ? 'bg-green-500/10' : 'bg-muted'
                            )}
                          >
                            {doc ? (
                              <CheckCircle size={20} weight="fill" className="text-green-500" />
                            ) : (
                              <FileText size={20} className="text-muted-foreground" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{documentTypeLabels[docType]}</p>
                            {isRequired && !doc && (
                              <Badge variant="outline" className="text-xs text-amber-500">
                                Required
                              </Badge>
                            )}
                            {doc && (
                              <p className="text-xs text-muted-foreground">
                                Uploaded {formatDate(doc.uploadedAt)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {doc && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onDocumentDownload(doc)}
                            >
                              <Download size={14} weight="bold" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onDocumentUpload(docType)}
                          >
                            <Upload size={14} weight="bold" className="mr-1" />
                            {doc ? 'Replace' : 'Upload'}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </TabsContent>

            {/* Underwriting Tab */}
            <TabsContent value="underwriting" className="mt-0">
              {hasUnderwritingData ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Bank size={16} weight="fill" className="text-primary" />
                        <span className="text-sm text-muted-foreground">Avg Daily Balance</span>
                      </div>
                      <p className="text-2xl font-semibold">
                        {formatCurrency(deal.averageDailyBalance)}
                      </p>
                    </Card>
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <ChartLine size={16} weight="fill" className="text-primary" />
                        <span className="text-sm text-muted-foreground">Monthly Revenue</span>
                      </div>
                      <p className="text-2xl font-semibold">
                        {formatCurrency(deal.monthlyRevenue)}
                      </p>
                    </Card>
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <WarningCircle size={16} weight="fill" className="text-amber-500" />
                        <span className="text-sm text-muted-foreground">NSF Count</span>
                      </div>
                      <p className="text-2xl font-semibold">{deal.nsfCount ?? '-'}</p>
                    </Card>
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Buildings size={16} weight="fill" className="text-primary" />
                        <span className="text-sm text-muted-foreground">Existing Positions</span>
                      </div>
                      <p className="text-2xl font-semibold">{deal.existingPositions ?? '-'}</p>
                    </Card>
                  </div>

                  {deal.probability !== undefined && (
                    <Card className="p-4">
                      <h3 className="font-medium mb-4">Approval Probability</h3>
                      <div className="flex items-center gap-4">
                        <Progress value={deal.probability} className="flex-1" />
                        <span className="text-lg font-semibold">{deal.probability}%</span>
                      </div>
                    </Card>
                  )}
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <Bank size={48} className="mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-2">Bank Data Not Connected</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Connect bank data to view underwriting metrics and approval probability.
                  </p>
                  <Button>Connect Bank Account</Button>
                </Card>
              )}
            </TabsContent>

            {/* Disclosure Tab */}
            <TabsContent value="disclosure" className="mt-0">
              {disclosure ? (
                <div className="space-y-4">
                  <Card className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Scales size={20} weight="fill" className="text-primary" />
                          <h3 className="font-medium">{disclosure.regulationName}</h3>
                          <Badge variant="outline">{disclosure.state}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {(() => {
                            const config = disclosureStatusConfig[disclosure.status]
                            const Icon = config.icon
                            return (
                              <>
                                <Icon size={14} weight="fill" className={config.color} />
                                <span className={cn('text-sm', config.color)}>{config.label}</span>
                              </>
                            )
                          })()}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {disclosure.documentUrl && (
                          <Button variant="outline" size="sm">
                            <Download size={14} weight="bold" className="mr-2" />
                            Download
                          </Button>
                        )}
                        {disclosure.status === 'generated' && (
                          <Button size="sm" onClick={onSendDisclosure}>
                            Send for Signature
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="p-4">
                      <h4 className="text-sm font-medium mb-3">Disclosure Details</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Funding Amount</span>
                          <span>{formatCurrency(disclosure.fundingAmount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total Dollar Cost</span>
                          <span>{formatCurrency(disclosure.totalDollarCost)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Term</span>
                          <span>{disclosure.termDays ? `${disclosure.termDays} days` : '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">APR Equivalent</span>
                          <span>{formatPercent(disclosure.aprEquivalent)}</span>
                        </div>
                      </div>
                    </Card>

                    <Card className="p-4">
                      <h4 className="text-sm font-medium mb-3">Signature Status</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Sent</span>
                          <span>{formatDate(disclosure.sentAt)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Viewed</span>
                          <span>{formatDate(disclosure.viewedAt)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Signed</span>
                          <span>{formatDate(disclosure.signedAt)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Signed By</span>
                          <span>{disclosure.signedBy || '-'}</span>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <Scales size={48} className="mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-2">No Disclosure Generated</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Generate a disclosure document to comply with state regulations.
                  </p>
                  <Button onClick={onGenerateDisclosure}>Generate Disclosure</Button>
                </Card>
              )}
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="mt-0">
              <ActivityTimeline
                activities={activities}
                maxHeight="500px"
                emptyMessage="No activity recorded for this deal yet."
              />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}
