import { Prospect } from '@public-records/core'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@public-records/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription
} from '@public-records/ui/drawer'
import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import { Separator } from '@public-records/ui/separator'
import { HealthGradeBadge } from './HealthGradeBadge'
import { SignalTimeline } from './SignalTimeline'
import { NotesAndReminders } from './NotesAndReminders'
import { EmailComposer } from './EmailComposer'
import { PreCallBriefing } from './outreach/PreCallBriefing'
import { MobileProspectDetails } from './MobileProspectDetails'
import {
  Buildings,
  Export,
  MapPin,
  CurrencyDollar,
  TrendUp,
  TrendDown,
  Brain,
  Envelope
} from '@phosphor-icons/react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@public-records/ui/tabs'
import { Card } from '@public-records/ui/card'
import { Progress } from '@public-records/ui/progress'
import type { ProspectNote, FollowUpReminder, OutreachEmail } from '@public-records/core'
import { useState } from 'react'
import { useIsMobile } from '@public-records/ui/use-mobile'

// Normalize a possibly-undefined/out-of-range score into a valid 0-100 Progress value.
function clampPercent(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

interface ProspectDetailDialogProps {
  prospect: Prospect | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClaim: (prospect: Prospect) => void
  onUnclaim: (prospect: Prospect) => void
  onExport: (prospect: Prospect) => void
  notes?: ProspectNote[]
  reminders?: FollowUpReminder[]
  onAddNote?: (note: Omit<ProspectNote, 'id' | 'createdAt' | 'createdBy'>) => void
  onDeleteNote?: (noteId: string) => void
  onAddReminder?: (
    reminder: Omit<FollowUpReminder, 'id' | 'createdAt' | 'createdBy' | 'completed'>
  ) => void
  onCompleteReminder?: (reminderId: string) => void
  onDeleteReminder?: (reminderId: string) => void
  onSendEmail?: (email: Omit<OutreachEmail, 'id' | 'createdAt' | 'createdBy'>) => void
}

export function ProspectDetailDialog({
  prospect,
  open,
  onOpenChange,
  onClaim,
  onUnclaim,
  onExport,
  notes = [],
  reminders = [],
  onAddNote = () => {},
  onDeleteNote = () => {},
  onAddReminder = () => {},
  onCompleteReminder = () => {},
  onDeleteReminder = () => {},
  onSendEmail = () => {}
}: ProspectDetailDialogProps) {
  const [emailComposerOpen, setEmailComposerOpen] = useState(false)
  const isMobile = useIsMobile()

  if (!prospect) return null

  const yearsSinceDefault = Math.floor(prospect.timeSinceDefault / 365)
  const isClaimed = prospect.status === 'claimed'

  const prospectNotes = notes.filter((n) => n.prospectId === prospect.id)
  const prospectReminders = reminders.filter((r) => r.prospectId === prospect.id)

  // Mobile: Use Drawer with swipe-to-dismiss
  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className="max-h-[90vh] glass-effect">
            <DrawerHeader className="sr-only">
              <DrawerTitle>{prospect.companyName}</DrawerTitle>
              <DrawerDescription>Prospect details</DrawerDescription>
            </DrawerHeader>
            <MobileProspectDetails
              prospect={prospect}
              onClaim={onClaim}
              onUnclaim={onUnclaim}
              onExport={onExport}
              onSendEmail={() => setEmailComposerOpen(true)}
              notes={notes}
              reminders={reminders}
              onAddNote={onAddNote}
              onDeleteNote={onDeleteNote}
              onAddReminder={onAddReminder}
              onCompleteReminder={onCompleteReminder}
              onDeleteReminder={onDeleteReminder}
            />
          </DrawerContent>
        </Drawer>

        <EmailComposer
          prospect={prospect}
          open={emailComposerOpen}
          onOpenChange={setEmailComposerOpen}
          onSendEmail={onSendEmail}
        />
      </>
    )
  }

  // Desktop: Use Dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-2xl mb-2">{prospect.companyName}</DialogTitle>
              <DialogDescription className="flex items-center gap-4 text-base">
                <span className="flex items-center gap-1">
                  <MapPin size={16} weight="fill" />
                  {prospect.state}
                </span>
                <span>•</span>
                <span className="capitalize">{prospect.industry}</span>
                {prospect.estimatedRevenue && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <CurrencyDollar size={16} weight="fill" />$
                      {(prospect.estimatedRevenue / 1000000).toFixed(1)}M est. revenue
                    </span>
                  </>
                )}
              </DialogDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <div className="font-mono text-4xl font-semibold text-primary">
                  {prospect.priorityScore}
                </div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">
                  Priority Score
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <Card className="p-6 bg-muted/50">
            <h3 className="font-semibold mb-3">Opportunity Summary</h3>
            <p className="text-sm leading-relaxed">{prospect.narrative}</p>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground mb-1">Health Score</div>
              <HealthGradeBadge grade={prospect.healthScore.grade} />
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Sentiment Trend</span>
                  <div className="flex items-center gap-1">
                    {prospect.healthScore.sentimentTrend === 'improving' ? (
                      <>
                        <TrendUp size={16} weight="bold" className="text-success" />
                        <span className="text-success">Improving</span>
                      </>
                    ) : prospect.healthScore.sentimentTrend === 'declining' ? (
                      <>
                        <TrendDown size={16} weight="bold" className="text-destructive" />
                        <span className="text-destructive">Declining</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Stable</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Reviews Analyzed</span>
                  <span className="font-mono">{prospect.healthScore.reviewCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Violations</span>
                  <span className="font-mono">{prospect.healthScore.violationCount}</span>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm text-muted-foreground mb-1">Default History</div>
              <Badge variant="outline" className="font-mono text-lg mb-3">
                {yearsSinceDefault} years ago
              </Badge>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Default Date</span>
                  <span className="font-mono">{prospect.defaultDate}</span>
                </div>
                {prospect.lastFilingDate && (
                  <div className="flex items-center justify-between text-sm">
                    <span>Last Filing</span>
                    <span className="font-mono">{prospect.lastFilingDate}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span>UCC Filings</span>
                  <span className="font-mono">{prospect.uccFilings.length}</span>
                </div>
              </div>
            </Card>
          </div>

          {prospect.mlScoring && (
            <Card className="p-6 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Brain size={24} weight="fill" className="text-primary" />
                  <h3 className="font-semibold text-lg">ML Predictive Analysis</h3>
                </div>
                <Badge variant="outline" className="text-xs">
                  Model {prospect.mlScoring.modelVersion}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Overall Confidence</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold font-mono text-primary">
                      {prospect.mlScoring.confidence}%
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {prospect.mlScoring.confidence >= 70
                        ? 'High'
                        : prospect.mlScoring.confidence >= 50
                          ? 'Medium'
                          : 'Low'}
                    </span>
                  </div>
                  <Progress value={clampPercent(prospect.mlScoring.confidence)} className="mt-2" />
                </div>

                <div>
                  <div className="text-sm text-muted-foreground mb-2">Recovery Likelihood</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold font-mono text-success">
                      {prospect.mlScoring.recoveryLikelihood}%
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {prospect.mlScoring.recoveryLikelihood >= 70
                        ? 'Excellent'
                        : prospect.mlScoring.recoveryLikelihood >= 50
                          ? 'Good'
                          : 'Fair'}
                    </span>
                  </div>
                  <Progress
                    value={clampPercent(prospect.mlScoring.recoveryLikelihood)}
                    className="mt-2"
                  />
                </div>
              </div>

              <Separator className="my-4" />

              <div className="space-y-3">
                <div className="text-sm font-medium text-muted-foreground mb-3">
                  Model Factors (weighted analysis)
                </div>

                {Object.entries(prospect.mlScoring.factors).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className="font-mono text-xs">{value}%</span>
                    </div>
                    <Progress value={clampPercent(value)} className="h-1.5" />
                  </div>
                ))}
              </div>

              <div className="mt-4 text-xs text-muted-foreground">
                Last updated: {prospect.mlScoring.lastUpdated}
              </div>
            </Card>
          )}

          <Tabs defaultValue="signals" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="signals">
                Growth Signals ({prospect.growthSignals.length})
              </TabsTrigger>
              <TabsTrigger value="filings">UCC Filings ({prospect.uccFilings.length})</TabsTrigger>
              <TabsTrigger value="briefing">Briefing</TabsTrigger>
              <TabsTrigger value="notes">Notes & Reminders</TabsTrigger>
            </TabsList>

            <TabsContent value="signals" className="mt-4">
              <SignalTimeline signals={prospect.growthSignals} />
            </TabsContent>

            <TabsContent value="filings" className="mt-4 space-y-3">
              {prospect.uccFilings.map((filing) => (
                <Card key={filing.id} className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <Badge variant="outline" className="mb-2">
                        {filing.filingType}
                      </Badge>
                      <div className="text-sm">
                        <div className="font-medium">{filing.securedParty}</div>
                        <div className="text-muted-foreground">Secured Party</div>
                      </div>
                    </div>
                    {filing.lienAmount && (
                      <div className="text-right">
                        <div className="font-mono text-lg font-semibold">
                          ${(filing.lienAmount / 1000).toFixed(0)}K
                        </div>
                        <div className="text-xs text-muted-foreground">Lien Amount</div>
                      </div>
                    )}
                  </div>
                  <Separator className="my-3" />
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Filing Date</div>
                      <div className="font-mono">{filing.filingDate}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">State</div>
                      <div className="font-mono">{filing.state}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Status</div>
                      <Badge variant="secondary" className="capitalize">
                        {filing.status}
                      </Badge>
                    </div>
                  </div>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="briefing" className="mt-4">
              {/* key remounts on prospect change so briefing state never leaks across prospects */}
              <PreCallBriefing key={prospect.id} prospectId={prospect.id} />
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <NotesAndReminders
                prospectId={prospect.id}
                prospectName={prospect.companyName}
                notes={prospectNotes}
                reminders={prospectReminders}
                onAddNote={onAddNote}
                onDeleteNote={onDeleteNote}
                onAddReminder={onAddReminder}
                onCompleteReminder={onCompleteReminder}
                onDeleteReminder={onDeleteReminder}
              />
            </TabsContent>
          </Tabs>

          <Separator />

          <div className="flex items-center gap-3">
            <Button
              size="lg"
              className="flex-1"
              disabled={isClaimed}
              onClick={() => onClaim(prospect)}
            >
              <Buildings size={20} weight="fill" className="mr-2" />
              {isClaimed ? `Claimed by ${prospect.claimedBy}` : 'Claim Lead'}
            </Button>
            {isClaimed && (
              <Button size="lg" variant="outline" onClick={() => onUnclaim(prospect)}>
                Unclaim
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={() => setEmailComposerOpen(true)}>
              <Envelope size={20} weight="bold" className="mr-2" />
              Send Email
            </Button>
            <Button size="lg" variant="outline" onClick={() => onExport(prospect)}>
              <Export size={20} weight="bold" className="mr-2" />
              Export
            </Button>
          </div>
        </div>

        <EmailComposer
          prospect={prospect}
          open={emailComposerOpen}
          onOpenChange={setEmailComposerOpen}
          onSendEmail={onSendEmail}
        />
      </DialogContent>
    </Dialog>
  )
}
