import { Button } from '@public-records/ui/button'

interface LoadingAndErrorStateProps {
  isLoading: boolean
  loadError: string | null
  /** When true, the live API was unreachable but demo data is being rendered. */
  isDemoFallback?: boolean
  onRetry: () => void
}

export function LoadingAndErrorState({
  isLoading,
  loadError,
  isDemoFallback = false,
  onRetry
}: LoadingAndErrorStateProps) {
  return (
    <>
      {isDemoFallback && (
        <div className="glass-effect border border-blue-400/30 rounded-lg p-3 text-blue-100/90 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
          <p>
            <span className="font-medium">Demo data</span> — connect a live data source to see real
            prospects.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0 border-blue-400/40 text-blue-100 hover:bg-blue-500/20"
          >
            Connect live data
          </Button>
        </div>
      )}

      {loadError && !isDemoFallback && (
        <div className="glass-effect border border-red-500/40 rounded-lg p-4 text-red-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="font-semibold">Failed to load live data</p>
            <p className="text-sm text-red-100/80">{loadError}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="border-red-500/60 text-red-100 hover:bg-red-500/20"
          >
            Retry
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="glass-effect border border-white/20 rounded-lg p-4 text-sm text-white/80">
          Loading live data from ingestion services...
        </div>
      )}
    </>
  )
}
