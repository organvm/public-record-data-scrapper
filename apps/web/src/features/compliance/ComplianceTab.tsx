import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Deal, Contact, Disclosure, ConsentRecord, AuditLog } from '@public-records/core'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@public-records/ui/tabs'
import { DisclosureManager, ConsentDashboard, AuditLogViewer } from '@/components/compliance'
import {
  fetchDisclosures,
  generateDisclosure,
  markDisclosureSent,
  recordConsent,
  revokeConsent,
  fetchAuditLogs,
  buildAuditExportUrl
} from '@/lib/api/compliance'
import { fetchDeals, type Deal as ApiDeal } from '@/lib/api/deals'
import { fetchContacts, type Contact as ApiContact } from '@/lib/api/contacts'
import { fetchProspect } from '@/lib/api/prospects'

// The compliance REST client returns canonical camelCase types from
// @public-records/core for disclosures / consents / audit logs, so those need
// no remapping. Deals and contacts come from their own snake_case clients and
// are mapped to the core shapes the components expect. We only map the fields
// the compliance components actually read — no fabricated values.

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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapContact(row: ApiContact): Contact {
  return {
    id: row.id,
    orgId: row.org_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    phoneExt: row.phone_ext,
    mobile: row.mobile,
    title: row.title,
    role: row.role,
    preferredContactMethod: row.preferred_contact_method,
    timezone: row.timezone,
    notes: row.notes,
    tags: row.tags,
    source: row.source,
    isActive: row.is_active,
    lastContactedAt: row.last_contacted_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function ComplianceTab() {
  const [disclosures, setDisclosures] = useState<Disclosure[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [consents, setConsents] = useState<ConsentRecord[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])

  // Disclosure regulation is selected by the deal's *prospect* state, which the
  // deal row does not carry. We resolve it lazily via the prospects client and
  // cache the result per prospectId so a second disclosure generation for the
  // same prospect does not refetch. The cache lives for the tab's lifetime.
  const prospectStateCache = useRef(new Map<string, string>())

  // org_id is intentionally omitted on every call: the server derives the
  // tenant from the authenticated token. Failures surface as named toasts and
  // leave the surface in its genuine empty state — never invented data.

  const loadDisclosures = useCallback(async () => {
    try {
      const result = await fetchDisclosures()
      setDisclosures(result.disclosures)
    } catch (err) {
      toast.error('Failed to load disclosures', {
        description: err instanceof Error ? err.message : undefined
      })
    }
  }, [])

  const loadDeals = useCallback(async () => {
    try {
      // org_id is required by the deals list param type but derived server-side;
      // an empty value is omitted by the client.
      const result = await fetchDeals({ org_id: '' })
      setDeals(result.deals.map(mapDeal))
    } catch (err) {
      toast.error('Failed to load deals', {
        description: err instanceof Error ? err.message : undefined
      })
    }
  }, [])

  const loadContacts = useCallback(async () => {
    try {
      const result = await fetchContacts({ org_id: '' })
      setContacts(result.contacts.map(mapContact))
    } catch (err) {
      toast.error('Failed to load contacts', {
        description: err instanceof Error ? err.message : undefined
      })
    }
  }, [])

  const loadAuditLogs = useCallback(async () => {
    try {
      const result = await fetchAuditLogs({ limit: 100 })
      setAuditLogs(result.logs)
    } catch (err) {
      toast.error('Failed to load audit log', {
        description: err instanceof Error ? err.message : undefined
      })
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDisclosures()
    void loadDeals()
    void loadContacts()
    void loadAuditLogs()
  }, [loadDisclosures, loadDeals, loadContacts, loadAuditLogs])

  // --- Disclosure mutations ---

  const handleGenerateDisclosure = useCallback(
    async (dealId: string) => {
      const deal = deals.find((d) => d.id === dealId)
      if (!deal) {
        toast.error('Cannot generate disclosure', {
          description: 'Deal not found in the current view.'
        })
        return
      }
      const prospectId = deal.prospectId
      if (!prospectId) {
        toast.error('Cannot generate disclosure', {
          description:
            'This deal is not linked to a prospect, so its state cannot be resolved to select a disclosure regulation.'
        })
        return
      }
      // Disclosure regulation is selected by the prospect's state. The deal row
      // does not carry it, so resolve it from the deal's prospect (cached per
      // prospectId). We only fail closed once the prospect genuinely has no
      // state — never by guessing one. amountRequested/factorRate are validated
      // server-side.
      let state = prospectStateCache.current.get(prospectId)
      if (!state) {
        try {
          const prospect = await fetchProspect(prospectId)
          if (prospect.state) {
            state = prospect.state
            prospectStateCache.current.set(prospectId, prospect.state)
          }
        } catch (err) {
          toast.error('Cannot generate disclosure', {
            description:
              err instanceof Error
                ? `Could not resolve the prospect's state: ${err.message}`
                : "Could not resolve the prospect's state."
          })
          return
        }
      }
      if (!state) {
        toast.error('Cannot generate disclosure', {
          description:
            "This deal's prospect has no associated state. A state is required to select the disclosure regulation."
        })
        return
      }
      try {
        await generateDisclosure({ deal_id: dealId, state })
        toast.success('Disclosure generated')
        await loadDisclosures()
      } catch (err) {
        toast.error('Failed to generate disclosure', {
          description: err instanceof Error ? err.message : undefined
        })
      }
    },
    [deals, loadDisclosures]
  )

  const handleSendDisclosure = useCallback(
    async (disclosureId: string) => {
      try {
        await markDisclosureSent(disclosureId)
        toast.success('Disclosure marked as sent')
        await loadDisclosures()
      } catch (err) {
        toast.error('Failed to send disclosure', {
          description: err instanceof Error ? err.message : undefined
        })
      }
    },
    [loadDisclosures]
  )

  const handleDownloadDisclosure = useCallback((disclosure: Disclosure) => {
    if (disclosure.documentUrl) {
      window.open(disclosure.documentUrl, '_blank', 'noopener,noreferrer')
    } else {
      toast.info('No document available', {
        description: 'This disclosure has not had a document generated yet.'
      })
    }
  }, [])

  const handlePreviewDisclosure = useCallback((disclosure: Disclosure) => {
    if (disclosure.documentUrl) {
      window.open(disclosure.documentUrl, '_blank', 'noopener,noreferrer')
    } else {
      toast.info('No preview available', {
        description: 'This disclosure has not had a document generated yet.'
      })
    }
  }, [])

  // --- Consent mutations ---

  const handleRecordConsent = useCallback(
    async (data: {
      contactId: string
      consentType: ConsentRecord['consentType']
      channel?: string
      consentText?: string
      collectionMethod: ConsentRecord['collectionMethod']
    }) => {
      try {
        const created = await recordConsent({
          contact_id: data.contactId,
          consent_type: data.consentType,
          channel: data.channel as 'email' | 'sms' | 'call' | 'mail' | 'all' | undefined,
          consent_text: data.consentText,
          collection_method: data.collectionMethod
        })
        toast.success('Consent recorded')
        // Surface the newly created record immediately — consent has no
        // org-wide listing endpoint, so we accumulate created records locally.
        setConsents((prev) => [created, ...prev])
      } catch (err) {
        toast.error('Failed to record consent', {
          description: err instanceof Error ? err.message : undefined
        })
      }
    },
    []
  )

  const handleRevokeConsent = useCallback(
    async (consentId: string, reason: string) => {
      const target = consents.find((c) => c.id === consentId)
      if (!target) {
        toast.error('Cannot revoke consent', {
          description: 'Consent record not found in the current view.'
        })
        return
      }
      try {
        await revokeConsent({
          contact_id: target.contactId,
          channel:
            (target.channel as 'email' | 'sms' | 'call' | 'mail' | 'all' | undefined) ?? 'all',
          reason
        })
        toast.success('Consent revoked')
        // Reflect the revocation in the local view.
        setConsents((prev) =>
          prev.map((c) =>
            c.id === consentId
              ? { ...c, revokedAt: new Date().toISOString(), revokedReason: reason }
              : c
          )
        )
      } catch (err) {
        toast.error('Failed to revoke consent', {
          description: err instanceof Error ? err.message : undefined
        })
      }
    },
    [consents]
  )

  // --- Audit export ---

  const handleExportAudit = useCallback((logs: AuditLog[]) => {
    if (logs.length === 0) {
      toast.info('Nothing to export', { description: 'No audit logs match the current filters.' })
      return
    }
    // Derive the export window from the visible logs and trigger a CSV download
    // against the server export endpoint (which streams a text/csv buffer).
    const times = logs.map((l) => new Date(l.createdAt).getTime()).filter((t) => !Number.isNaN(t))
    if (times.length === 0) {
      // Every visible log has an unparseable createdAt — Math.min(...[]) would be
      // Infinity and produce an invalid date range. Fail closed with a reason.
      toast.error('Cannot export audit log', {
        description: 'The visible logs have no parseable timestamps to build an export window.'
      })
      return
    }
    const start = new Date(Math.min(...times)).toISOString()
    const end = new Date(Math.max(...times) + 1000).toISOString()
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'
    const url = `${base.replace(/\/$/, '')}${buildAuditExportUrl({
      start_date: start,
      end_date: end,
      format: 'csv'
    })}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <Tabs defaultValue="disclosures" className="w-full">
      <TabsList className="glass-effect mb-4 sm:mb-6">
        <TabsTrigger value="disclosures">Disclosures</TabsTrigger>
        <TabsTrigger value="consent">Consent</TabsTrigger>
        <TabsTrigger value="audit">Audit Log</TabsTrigger>
      </TabsList>

      <TabsContent value="disclosures">
        <DisclosureManager
          disclosures={disclosures}
          deals={deals}
          onGenerateDisclosure={handleGenerateDisclosure}
          onSendDisclosure={handleSendDisclosure}
          onDownloadDisclosure={handleDownloadDisclosure}
          onPreviewDisclosure={handlePreviewDisclosure}
        />
      </TabsContent>

      <TabsContent value="consent">
        <ConsentDashboard
          consents={consents}
          contacts={contacts}
          onRecordConsent={handleRecordConsent}
          onRevokeConsent={handleRevokeConsent}
        />
      </TabsContent>

      <TabsContent value="audit">
        <AuditLogViewer auditLogs={auditLogs} onExport={handleExportAudit} />
      </TabsContent>
    </Tabs>
  )
}
