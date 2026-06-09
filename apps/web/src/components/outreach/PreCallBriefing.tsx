import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@public-records/ui/button'
import { Card } from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { Separator } from '@public-records/ui/separator'
import { Skeleton } from '@public-records/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@public-records/ui/alert'
import { Phone, Sparkle, Warning, ArrowClockwise } from '@phosphor-icons/react'
import { ApiError, TimeoutError } from '@/lib/api/client'
import {
  fetchBriefing,
  fetchNarrative,
  type PreCallBriefing as PreCallBriefingData,
  type ProspectNarrative
} from '@/lib/api/outreach'

interface PreCallBriefingProps {
  prospectId: string
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Extract a human-facing, verbatim reason from a failed request.
 * The outreach routes return `{ error: string }` bodies; surface that text
 * exactly. Never substitute invented copy — fail closed with the real reason.
 */
function describeError(err: unknown): string {
  if (err instanceof TimeoutError) {
    return err.message
  }
  if (err instanceof ApiError) {
    const body = err.body
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>
      if (typeof record.error === 'string' && record.error.length > 0) {
        return record.error
      }
      if (typeof record.message === 'string' && record.message.length > 0) {
        return record.message
      }
    }
    if (typeof body === 'string' && body.length > 0) {
      return body
    }
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'Unknown error'
}

const CATEGORY_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  strength: 'default',
  opportunity: 'secondary',
  caution: 'destructive',
  question: 'outline'
}

const APPROACH_LABEL: Record<ProspectNarrative['approachRecommendation'], string> = {
  aggressive: 'Aggressive',
  standard: 'Standard',
  cautious: 'Cautious',
  pass: 'Pass'
}

export function PreCallBriefing({ prospectId }: PreCallBriefingProps) {
  const [state, setState] = useState<LoadState>('idle')
  const [briefing, setBriefing] = useState<PreCallBriefingData | null>(null)
  const [narrative, setNarrative] = useState<ProspectNarrative | null>(null)
  // Narrative is best-effort: its server route may be unmounted. We surface its
  // reason separately so a working briefing still renders.
  const [narrativeError, setNarrativeError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Abort any in-flight request on unmount. State is reset across prospects by
  // remounting via a `key={prospect.id}` on the caller (see ProspectDetailDialog),
  // so no prop-driven reset effect is needed here.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const generate = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState('loading')
    setError(null)
    setNarrativeError(null)
    setNarrative(null)

    // The briefing is the required artifact; if it fails the whole section
    // fails closed with the server's verbatim reason.
    let briefingData: PreCallBriefingData
    try {
      briefingData = await fetchBriefing(prospectId, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      setBriefing(null)
      setError(describeError(err))
      setState('error')
      return
    }

    if (controller.signal.aborted) return
    setBriefing(briefingData)

    // The narrative is supplementary — its route may not be mounted yet. A
    // failure here surfaces the reason but does NOT block the briefing.
    try {
      const narrativeData = await fetchNarrative(prospectId, controller.signal)
      if (controller.signal.aborted) return
      setNarrative(narrativeData)
    } catch (err) {
      if (controller.signal.aborted) return
      setNarrative(null)
      setNarrativeError(describeError(err))
    }

    if (controller.signal.aborted) return
    setState('ready')
  }, [prospectId])

  if (state === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Sparkle size={28} weight="fill" className="text-primary" />
        <div>
          <div className="font-medium">Pre-call briefing</div>
          <p className="text-sm text-muted-foreground max-w-md">
            Generate a stack analysis, fresh-capacity read, talking points, and the full sales
            narrative for this prospect.
          </p>
        </div>
        <Button onClick={generate}>
          <Phone size={18} weight="fill" className="mr-2" />
          Generate briefing
        </Button>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div className="space-y-4 py-2" data-testid="briefing-loading">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="space-y-4 py-2">
        <Alert variant="destructive" data-testid="briefing-error">
          <Warning size={18} weight="fill" />
          <AlertTitle>Briefing unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={generate}>
          <ArrowClockwise size={16} weight="bold" className="mr-2" />
          Try again
        </Button>
      </div>
    )
  }

  // state === 'ready' (briefing is guaranteed present here)
  if (!briefing) return null

  return (
    <div className="space-y-5 py-2" data-testid="briefing-ready">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Pre-Call Briefing</h3>
        <Button variant="ghost" size="sm" onClick={generate}>
          <ArrowClockwise size={14} weight="bold" className="mr-1" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Active / Total Filings
          </div>
          <div className="font-mono text-2xl font-semibold">
            {briefing.stackAnalysis.activeFilings}
            <span className="text-muted-foreground text-base">
              {' / '}
              {briefing.stackAnalysis.totalFilings}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {briefing.stackAnalysis.terminatedFilings} terminated
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Fresh Capacity
          </div>
          <div className="font-mono text-2xl font-semibold text-primary">
            {briefing.freshCapacity.score}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {briefing.freshCapacity.recentTerminations} recent payoff
            {briefing.freshCapacity.recentTerminations === 1 ? '' : 's'}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Velocity (30d)
          </div>
          <div className="font-mono text-2xl font-semibold capitalize">
            {briefing.velocity.trend30d ?? '—'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {briefing.velocity.filings30d} filing
            {briefing.velocity.filings30d === 1 ? '' : 's'} in window
          </div>
        </Card>
      </div>

      {briefing.stackAnalysis.knownCompetitors.length > 0 && (
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-2">Known Competitors</div>
          <div className="flex flex-wrap gap-2">
            {briefing.stackAnalysis.knownCompetitors.map((competitor) => (
              <Badge key={competitor} variant="outline">
                {competitor}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-2">Talking Points</div>
        {briefing.talkingPoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">No talking points returned.</p>
        ) : (
          <ul className="space-y-2">
            {briefing.talkingPoints.map((point) => (
              <li key={point} className="text-sm flex gap-2">
                <span className="text-primary">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {briefing.riskFactors.length > 0 && (
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-2">Risk Factors</div>
          <ul className="space-y-2">
            {briefing.riskFactors.map((risk) => (
              <li key={risk} className="text-sm flex gap-2">
                <Warning size={16} weight="fill" className="text-destructive shrink-0 mt-0.5" />
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Separator />

      {/* Narrative section — supplementary; fails closed independently. */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sparkle size={18} weight="fill" className="text-primary" />
          <h4 className="font-semibold">Sales Narrative</h4>
        </div>

        {narrativeError && (
          <Alert variant="destructive" data-testid="narrative-error">
            <Warning size={18} weight="fill" />
            <AlertTitle>Narrative unavailable</AlertTitle>
            <AlertDescription>{narrativeError}</AlertDescription>
          </Alert>
        )}

        {narrative && (
          <div className="space-y-4" data-testid="narrative-ready">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                Approach: {APPROACH_LABEL[narrative.approachRecommendation]}
              </Badge>
              <Badge
                variant={
                  narrative.riskLevel === 'high'
                    ? 'destructive'
                    : narrative.riskLevel === 'medium'
                      ? 'outline'
                      : 'secondary'
                }
              >
                Risk: {narrative.riskLevel}
              </Badge>
              {narrative.isWhaleOpportunity && (
                <Badge variant="default">
                  Whale
                  {typeof narrative.whaleScore === 'number' ? ` · ${narrative.whaleScore}` : ''}
                </Badge>
              )}
            </div>

            <Card className="p-4 bg-muted/50">
              <p className="text-sm leading-relaxed">{narrative.summary}</p>
            </Card>

            {narrative.detailedNarrative && (
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {narrative.detailedNarrative}
              </p>
            )}

            {narrative.talkingPoints.length > 0 && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">
                  Narrative Talking Points
                </div>
                <ul className="space-y-2">
                  {narrative.talkingPoints.map((tp, idx) => (
                    <li key={`${tp.category}-${idx}`} className="text-sm flex items-start gap-2">
                      <Badge
                        variant={CATEGORY_VARIANT[tp.category] ?? 'outline'}
                        className="capitalize shrink-0"
                      >
                        {tp.category}
                      </Badge>
                      <span>{tp.point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {narrative.callOpeners.length > 0 && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">Call Openers</div>
                <ul className="space-y-2">
                  {narrative.callOpeners.map((opener, idx) => (
                    <li key={idx} className="text-sm italic flex gap-2">
                      <span className="text-primary">“</span>
                      <span>{opener}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {narrative.potentialObjections.length > 0 && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">
                  Objection Handlers
                </div>
                <div className="space-y-3">
                  {narrative.potentialObjections.map((obj, idx) => (
                    <Card key={idx} className="p-3">
                      <div className="text-sm font-medium">{obj.objection}</div>
                      <div className="text-sm text-muted-foreground mt-1">{obj.response}</div>
                      {obj.supportingData && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {obj.supportingData}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
