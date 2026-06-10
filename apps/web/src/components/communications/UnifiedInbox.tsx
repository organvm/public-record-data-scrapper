import { useState, useMemo } from 'react'
import {
  Communication,
  CommunicationChannel,
  CommunicationDirection,
  Contact
} from '@public-records/core'
import { Card, CardHeader, CardTitle } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Badge } from '@public-records/ui/badge'
import { ScrollArea } from '@public-records/ui/scroll-area'
import { Separator } from '@public-records/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import { Avatar, AvatarFallback } from '@public-records/ui/avatar'
import {
  MagnifyingGlass,
  Envelope,
  ChatText,
  Phone,
  ArrowRight,
  PaperPlaneRight,
  Plus,
  ArrowLeft,
  Clock
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface UnifiedInboxProps {
  communications: Communication[]
  contacts: Contact[]
  onCommunicationSelect: (communication: Communication) => void
  onCompose: (channel?: CommunicationChannel) => void
  onReply: (communication: Communication) => void
  className?: string
}

type FilterChannel = 'all' | CommunicationChannel
type FilterDirection = 'all' | CommunicationDirection

// Only permit safe link schemes; reject javascript:/data:/etc. so attachment
// URLs can't smuggle script-execution URLs into an href.
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
function sanitizeUrl(url?: string): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed, window.location.origin)
    return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? trimmed : undefined
  } catch {
    return undefined
  }
}

const channelConfig: Record<
  CommunicationChannel,
  { icon: typeof Envelope; color: string; label: string }
> = {
  email: { icon: Envelope, color: 'text-blue-500', label: 'Email' },
  sms: { icon: ChatText, color: 'text-violet-500', label: 'SMS' },
  call: { icon: Phone, color: 'text-green-500', label: 'Call' }
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-500',
  queued: 'bg-amber-500',
  sent: 'bg-blue-500',
  delivered: 'bg-green-500',
  opened: 'bg-emerald-500',
  clicked: 'bg-teal-500',
  bounced: 'bg-red-500',
  failed: 'bg-red-500',
  answered: 'bg-green-500',
  no_answer: 'bg-amber-500',
  voicemail: 'bg-purple-500',
  busy: 'bg-orange-500'
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function getContactName(contactId: string | undefined, contacts: Contact[]): string {
  if (!contactId) return 'Unknown'
  const contact = contacts.find((c) => c.id === contactId)
  return contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown'
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function truncate(text: string | undefined, maxLength: number): string {
  if (!text) return ''
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
}

export function UnifiedInbox({
  communications,
  contacts,
  onCommunicationSelect,
  onCompose,
  onReply,
  className
}: UnifiedInboxProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [channelFilter, setChannelFilter] = useState<FilterChannel>('all')
  const [directionFilter, setDirectionFilter] = useState<FilterDirection>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Filter and sort communications
  const filteredCommunications = useMemo(() => {
    return communications
      .filter((comm) => {
        // Channel filter
        if (channelFilter !== 'all' && comm.channel !== channelFilter) return false
        // Direction filter
        if (directionFilter !== 'all' && comm.direction !== directionFilter) return false
        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          const contactName = getContactName(comm.contactId, contacts).toLowerCase()
          const subject = (comm.subject || '').toLowerCase()
          const body = (comm.body || '').toLowerCase()
          return contactName.includes(query) || subject.includes(query) || body.includes(query)
        }
        return true
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [communications, channelFilter, directionFilter, searchQuery, contacts])

  // Selected communication
  const selectedCommunication = useMemo(() => {
    return selectedId ? communications.find((c) => c.id === selectedId) : null
  }, [selectedId, communications])

  // Group by date
  const groupedCommunications = useMemo(() => {
    const groups: Record<string, Communication[]> = {}
    filteredCommunications.forEach((comm) => {
      const date = new Date(comm.createdAt)
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)

      let key: string
      if (date.toDateString() === today.toDateString()) {
        key = 'Today'
      } else if (date.toDateString() === yesterday.toDateString()) {
        key = 'Yesterday'
      } else {
        key = date.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric'
        })
      }

      if (!groups[key]) groups[key] = []
      groups[key].push(comm)
    })
    return groups
  }, [filteredCommunications])

  const handleSelect = (communication: Communication) => {
    setSelectedId(communication.id)
    onCommunicationSelect(communication)
  }

  return (
    <Card className={cn('flex flex-col h-[calc(100vh-200px)]', className)}>
      <CardHeader className="border-b shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Envelope size={20} weight="fill" className="text-primary" />
            Unified Inbox
            <Badge variant="secondary">{filteredCommunications.length}</Badge>
          </CardTitle>
          <Button onClick={() => onCompose()}>
            <Plus size={16} weight="bold" className="mr-2" />
            Compose
          </Button>
        </div>
      </CardHeader>

      <div className="flex flex-1 overflow-hidden">
        {/* Message List */}
        <div className="w-full md:w-1/3 lg:w-2/5 border-r flex flex-col">
          {/* Filters */}
          <div className="p-3 border-b space-y-2">
            <div className="relative">
              <MagnifyingGlass
                size={14}
                weight="bold"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <div className="flex gap-2">
              <Select
                value={channelFilter}
                onValueChange={(v) => setChannelFilter(v as FilterChannel)}
              >
                <SelectTrigger className="h-8 text-xs" size="sm">
                  <SelectValue placeholder="Channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="call">Calls</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={directionFilter}
                onValueChange={(v) => setDirectionFilter(v as FilterDirection)}
              >
                <SelectTrigger className="h-8 text-xs" size="sm">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Message List */}
          <ScrollArea className="flex-1">
            {Object.keys(groupedCommunications).length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Envelope size={32} className="mx-auto mb-2" />
                <p className="text-sm">No messages found</p>
              </div>
            ) : (
              Object.entries(groupedCommunications).map(([date, comms]) => (
                <div key={date}>
                  <div className="px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground sticky top-0">
                    {date}
                  </div>
                  {comms.map((comm) => {
                    const config = channelConfig[comm.channel]
                    const Icon = config.icon
                    const contactName = getContactName(comm.contactId, contacts)
                    const isSelected = selectedId === comm.id
                    const isInbound = comm.direction === 'inbound'

                    return (
                      <div
                        key={comm.id}
                        className={cn(
                          'p-3 border-b cursor-pointer hover:bg-muted/50 transition-colors',
                          isSelected && 'bg-primary/5 border-l-2 border-l-primary'
                        )}
                        onClick={() => handleSelect(comm)}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {getInitials(contactName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-medium text-sm truncate">{contactName}</span>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {formatRelativeTime(comm.createdAt)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <Icon size={12} className={config.color} />
                              {isInbound ? (
                                <ArrowLeft size={10} className="text-muted-foreground" />
                              ) : (
                                <ArrowRight size={10} className="text-muted-foreground" />
                              )}
                              {comm.subject && (
                                <span className="text-sm font-medium truncate">{comm.subject}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {truncate(comm.body, 80)}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <div
                                className={cn(
                                  'w-1.5 h-1.5 rounded-full',
                                  statusColors[comm.status]
                                )}
                              />
                              <span className="text-xs text-muted-foreground capitalize">
                                {comm.status.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </ScrollArea>
        </div>

        {/* Message Detail */}
        <div className="hidden md:flex flex-1 flex-col">
          {selectedCommunication ? (
            <>
              <div className="p-4 border-b">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium">
                      {selectedCommunication.subject ||
                        `${channelConfig[selectedCommunication.channel].label} Message`}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                      <span>{getContactName(selectedCommunication.contactId, contacts)}</span>
                      <span>-</span>
                      <span>{new Date(selectedCommunication.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReply(selectedCommunication)}
                  >
                    <PaperPlaneRight size={14} weight="bold" className="mr-2" />
                    Reply
                  </Button>
                </div>
              </div>

              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {/* Channel and Direction */}
                  <div className="flex items-center gap-2">
                    {(() => {
                      const config = channelConfig[selectedCommunication.channel]
                      const Icon = config.icon
                      return (
                        <Badge variant="outline" className="gap-1">
                          <Icon size={12} className={config.color} />
                          {config.label}
                        </Badge>
                      )
                    })()}
                    <Badge variant="secondary">
                      {selectedCommunication.direction === 'inbound' ? 'Received' : 'Sent'}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {selectedCommunication.status.replace('_', ' ')}
                    </Badge>
                  </div>

                  {/* From/To */}
                  <div className="text-sm space-y-1">
                    {selectedCommunication.channel === 'email' && (
                      <>
                        <p>
                          <span className="text-muted-foreground">From:</span>{' '}
                          {selectedCommunication.fromAddress}
                        </p>
                        <p>
                          <span className="text-muted-foreground">To:</span>{' '}
                          {selectedCommunication.toAddress}
                        </p>
                      </>
                    )}
                    {(selectedCommunication.channel === 'sms' ||
                      selectedCommunication.channel === 'call') && (
                      <>
                        <p>
                          <span className="text-muted-foreground">From:</span>{' '}
                          {selectedCommunication.fromPhone}
                        </p>
                        <p>
                          <span className="text-muted-foreground">To:</span>{' '}
                          {selectedCommunication.toPhone}
                        </p>
                      </>
                    )}
                  </div>

                  <Separator />

                  {/* Body */}
                  {selectedCommunication.body && (
                    <div className="prose prose-sm max-w-none">
                      <div className="whitespace-pre-wrap">{selectedCommunication.body}</div>
                    </div>
                  )}

                  {/* Call-specific info */}
                  {selectedCommunication.channel === 'call' &&
                    selectedCommunication.callDurationSeconds && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock size={14} weight="bold" />
                        <span>
                          Duration: {Math.floor(selectedCommunication.callDurationSeconds / 60)}m{' '}
                          {selectedCommunication.callDurationSeconds % 60}s
                        </span>
                      </div>
                    )}

                  {/* Attachments */}
                  {selectedCommunication.attachments.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Attachments</h4>
                      <div className="space-y-2">
                        {selectedCommunication.attachments.map((attachment, index) => {
                          const safeUrl = sanitizeUrl(attachment.url)
                          const content = (
                            <>
                              <Envelope size={14} className="text-muted-foreground" />
                              <span className="text-sm">{attachment.name}</span>
                              <span className="text-xs text-muted-foreground">
                                ({Math.round(attachment.size / 1024)}KB)
                              </span>
                            </>
                          )
                          return safeUrl ? (
                            <a
                              key={index}
                              href={safeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                            >
                              {content}
                            </a>
                          ) : (
                            <div
                              key={index}
                              className="flex items-center gap-2 p-2 rounded-lg bg-muted opacity-70"
                            >
                              {content}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <Envelope size={48} className="mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-1">Select a message</h3>
                <p className="text-sm text-muted-foreground">
                  Choose a message from the list to view its contents
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
