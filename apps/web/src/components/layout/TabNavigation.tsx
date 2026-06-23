import { TabsList, TabsTrigger } from '@public-records/ui/tabs'
import {
  Pulse,
  Target,
  ChartBar,
  Heart,
  ArrowClockwise,
  Robot,
  ChartLineUp,
  Broadcast,
  Handshake,
  AddressBook,
  ChatCircle,
  ShieldCheck
} from '@phosphor-icons/react'

export function TabNavigation() {
  const triggerClass = 'flex items-center gap-2 text-sm h-9 px-2 xl:px-3'
  const listClass = [
    'glass-effect hidden md:grid w-full grid-cols-6 xl:grid-cols-12',
    'mb-4 sm:mb-6 gap-1 h-auto xl:h-10 p-1'
  ].join(' ')

  return (
    <TabsList className={listClass}>
      <TabsTrigger value="status" className={triggerClass}>
        <Pulse size={18} weight="fill" />
        <span>Status</span>
      </TabsTrigger>
      <TabsTrigger
        value="prospects"
        data-tour="prospects-tab"
        className={triggerClass}
      >
        <Target size={18} weight="fill" />
        <span>Prospects</span>
      </TabsTrigger>
      <TabsTrigger value="portfolio" className={triggerClass}>
        <Heart size={18} weight="fill" />
        <span>Portfolio</span>
      </TabsTrigger>
      <TabsTrigger
        value="intelligence"
        data-tour="intelligence-tab"
        className={triggerClass}
      >
        <ChartBar size={18} weight="fill" />
        <span>Intelligence</span>
      </TabsTrigger>
      <TabsTrigger
        value="analytics"
        data-tour="analytics-tab"
        className={triggerClass}
      >
        <ChartLineUp size={18} weight="fill" />
        <span>Analytics</span>
      </TabsTrigger>
      <TabsTrigger value="coverage" className={triggerClass}>
        <Broadcast size={18} weight="fill" />
        <span>Coverage</span>
      </TabsTrigger>
      <TabsTrigger value="deals" className={triggerClass}>
        <Handshake size={18} weight="fill" />
        <span>Deals</span>
      </TabsTrigger>
      <TabsTrigger value="contacts" className={triggerClass}>
        <AddressBook size={18} weight="fill" />
        <span>Contacts</span>
      </TabsTrigger>
      <TabsTrigger value="communications" className={triggerClass}>
        <ChatCircle size={18} weight="fill" />
        <span>Comms</span>
      </TabsTrigger>
      <TabsTrigger value="compliance" className={triggerClass}>
        <ShieldCheck size={18} weight="fill" />
        <span>Compliance</span>
      </TabsTrigger>
      <TabsTrigger value="requalification" className={triggerClass}>
        <ArrowClockwise size={18} weight="fill" />
        <span>Re-qual</span>
      </TabsTrigger>
      <TabsTrigger value="agentic" data-tour="agentic-tab" className={triggerClass}>
        <Robot size={18} weight="fill" />
        <span>Agentic</span>
      </TabsTrigger>
    </TabsList>
  )
}
