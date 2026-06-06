import { TabsList, TabsTrigger } from '@public-records/ui/tabs'
import {
  Target,
  ChartBar,
  Heart,
  ArrowClockwise,
  Robot,
  ChartLineUp,
  Broadcast,
  Lightning
} from '@phosphor-icons/react'

/**
 * Command Deck navigation rail — the command-center shell's primary nav.
 * Renders the same Radix Tabs triggers as the legacy horizontal TabNavigation,
 * so all existing tab logic/content keeps working; only the layout changes.
 */
const NAV_ITEMS: Array<{
  value: string
  label: string
  icon: typeof Target
  tour?: string
}> = [
  { value: 'prospects', label: 'Prospects', icon: Target, tour: 'prospects-tab' },
  { value: 'intelligence', label: 'Intelligence', icon: ChartBar, tour: 'intelligence-tab' },
  { value: 'analytics', label: 'Analytics', icon: ChartLineUp, tour: 'analytics-tab' },
  { value: 'portfolio', label: 'Portfolio', icon: Heart },
  { value: 'coverage', label: 'Coverage', icon: Broadcast },
  { value: 'requalification', label: 'Re-qualify', icon: ArrowClockwise },
  { value: 'agentic', label: 'AI Council', icon: Robot, tour: 'agentic-tab' }
]

export function CommandRail() {
  return (
    <aside className="bg-sidebar/80 border-sidebar-border sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r px-3 py-5 backdrop-blur-xl md:flex lg:w-64">
      {/* Brand lockup */}
      <div className="flex items-center gap-2.5 px-2">
        <div className="bg-signal/15 text-signal ring-signal/30 grid h-9 w-9 place-items-center rounded-xl ring-1">
          <Lightning size={20} weight="fill" />
        </div>
        <div className="min-w-0">
          <div className="text-sidebar-foreground text-sm font-semibold leading-tight">
            Command Deck
          </div>
          <div className="text-muted-foreground truncate text-[11px]">MCA Prediction Agency</div>
        </div>
      </div>

      {/* Primary nav (Radix Tabs triggers, vertical) */}
      <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 bg-transparent p-0">
        {NAV_ITEMS.map(({ value, label, icon: Icon, tour }) => (
          <TabsTrigger
            key={value}
            value={value}
            data-tour={tour}
            className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] data-[state=active]:bg-signal/12 data-[state=active]:text-signal w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors data-[state=active]:shadow-none"
          >
            <Icon size={18} weight="duotone" />
            <span>{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="text-muted-foreground/70 mt-auto px-2 text-[11px] leading-relaxed">
        Signal Command Deck
        <br />
        <span className="text-muted-foreground/50">v0.1 · real public-record data</span>
      </div>
    </aside>
  )
}
