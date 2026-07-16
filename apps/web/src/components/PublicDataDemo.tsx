import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, ArrowSquareOut, Buildings, Database } from '@phosphor-icons/react'
import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import { Card } from '@public-records/ui/card'
import {
  loadPublicDemoData,
  type PublicDemoData,
  resolvePublicDemoReceiptUrl
} from '@/lib/publicDemo'

interface PublicDataDemoProps {
  receiptPath: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

export function PublicDataDemo({ receiptPath }: PublicDataDemoProps) {
  const receiptUrl = resolvePublicDemoReceiptUrl(
    receiptPath,
    import.meta.env.BASE_URL,
    window.location.origin
  )
  const [data, setData] = useState<PublicDemoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        setData(await loadPublicDemoData(receiptUrl, signal))
      } catch (reason) {
        if (signal?.aborted) return
        setError(reason instanceof Error ? reason.message : 'Unable to load public data')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [receiptUrl]
  )

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mica-effect border-b-2 border-primary/20">
        <div className="container mx-auto px-4 py-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold">Austin Issued Construction Permits</h1>
              <Badge className="bg-emerald-500/20 text-emerald-200 border border-emerald-500/30">
                PUBLIC DATA DEMO
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Receipt-bound, read-only records from the City of Austin open-data API.
            </p>
          </div>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <ArrowClockwise size={16} className="mr-2" />
            Refresh source
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        <Card className="glass-effect p-5 border-primary/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <Database size={20} weight="fill" />
                Source contract
              </div>
              <p className="text-sm text-muted-foreground max-w-3xl">
                This Pages build does not call a same-origin <code>/api</code> that does not exist.
                It loads only permit number, contractor company, issue date, and permit type. No
                scores, defaults, outreach claims, addresses, contacts, or owners are inferred.
              </p>
              {data ? (
                <p className="text-xs text-muted-foreground" data-testid="source-receipt-id">
                  Receipt: {data.receipt.receipt_id}
                  {data.sourceLastModified ? ` · Source modified ${data.sourceLastModified}` : ''}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {data ? (
                <a
                  href={data.receipt.source.dataset_page_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  City dataset <ArrowSquareOut size={14} className="ml-2" />
                </a>
              ) : null}
              <a
                href={receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                Source receipt <ArrowSquareOut size={14} className="ml-2" />
              </a>
            </div>
          </div>
        </Card>

        {loading ? (
          <Card className="p-6 text-sm text-muted-foreground">Loading current permit records…</Card>
        ) : null}

        {error ? (
          <Card className="p-6 border-red-500/40" role="alert">
            <p className="font-semibold text-red-300">Public source unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </Card>
        ) : null}

        {!loading && !error && data ? (
          <section aria-labelledby="permit-records-heading">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="permit-records-heading" className="text-lg font-semibold">
                Latest issued permits
              </h2>
              <span className="text-sm text-muted-foreground">{data.permits.length} records</span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.permits.map((permit) => (
                <Card key={`${permit.id}-${permit.companyName}`} className="p-5 glass-effect">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      <Buildings size={22} weight="fill" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold break-words">{permit.companyName}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{permit.permitType}</p>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Permit</dt>
                    <dd className="font-mono break-all">{permit.id}</dd>
                    <dt className="text-muted-foreground">Issued</dt>
                    <dd>{formatDate(permit.issueDate)}</dd>
                  </dl>
                </Card>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
