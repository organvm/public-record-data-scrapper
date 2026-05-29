import { Button } from '@public-records/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SettingsMenu } from '@/components/SettingsMenu'
import { ArrowClockwise, Info } from '@phosphor-icons/react'

interface HeaderProps {
  onRefresh: () => void
  dataSource?: 'live' | 'preview' | 'api'
  dataSourceName?: string
}

export function Header({ onRefresh, dataSource = 'preview', dataSourceName }: HeaderProps) {
  const isLive = dataSource === 'live' || dataSource === 'api'
  const sourceLabel =
    dataSource === 'live'
      ? `Live · ${dataSourceName ?? 'real public-record data'}`
      : dataSource === 'api'
        ? 'Live · connected intelligence backend'
        : 'Preview · synthetic sample data'

  return (
    <header className="mica-effect border-b-2 border-primary/20 sticky top-0 z-50 shadow-xl shadow-primary/10">
      <div className="container mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 sm:gap-3">
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight text-white truncate bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                UCC-MCA Intelligence Platform
              </h1>
              {isLive ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-signal/15 text-signal border border-signal/30">
                  <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-signal" />
                  LIVE
                </span>
              ) : (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  <Info size={10} weight="fill" />
                  PREVIEW
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-white/80 hidden sm:block font-medium">
              {sourceLabel}
            </p>
          </div>
          {/* Header Actions */}
          <div className="flex gap-2 flex-shrink-0">
            <ThemeToggle />
            <SettingsMenu />
            <Button
              variant="outline"
              onClick={onRefresh}
              size="sm"
              className="glass-effect border-white/30 text-white hover:bg-white/10 hover:border-white/50"
            >
              <ArrowClockwise size={16} weight="bold" className="sm:mr-2" />
              <span className="sr-only sm:not-sr-only">Refresh Data</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
