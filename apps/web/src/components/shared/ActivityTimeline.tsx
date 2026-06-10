import { useState, useMemo } from 'react'
import { ContactActivity, ActivityType } from '@public-records/core'
import { Card } from '@public-records/ui/card'
import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import { ScrollArea } from '@public-records/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  Phone,
  PhoneIncoming,
  PhoneX,
  Envelope,
  EnvelopeOpen,
  ChatText,
  CalendarCheck,
  CalendarX,
  Note,
  CheckCircle,
  ArrowsClockwise,
  FileText,
  PencilSimple,
  Funnel
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface ActivityTimelineProps {
  activities: ContactActivity[]
  className?: string
  maxHeight?: string
  showFilters?: boolean
  emptyMessage?: string
}

const activityConfig: Record<
  ActivityType,
  { icon: typeof Phone; color: string; label: string; bgColor: string }
> = {
  call_outbound: {
    icon: Phone,
    color: 'text-blue-500',
    label: 'Outbound Call',
    bgColor: 'bg-blue-500/10'
  },
  call_inbound: {
    icon: PhoneIncoming,
    color: 'text-green-500',
    label: 'Inbound Call',
    bgColor: 'bg-green-500/10'
  },
  call_missed: {
    icon: PhoneX,
    color: 'text-red-500',
    label: 'Missed Call',
    bgColor: 'bg-red-500/10'
  },
  email_sent: {
    icon: Envelope,
    color: 'text-primary',
    label: 'Email Sent',
    bgColor: 'bg-primary/10'
  },
  email_received: {
    icon: EnvelopeOpen,
    color: 'text-secondary',
    label: 'Email Received',
    bgColor: 'bg-secondary/10'
  },
  email_opened: {
    icon: EnvelopeOpen,
    color: 'text-emerald-500',
    label: 'Email Opened',
    bgColor: 'bg-emerald-500/10'
  },
  email_clicked: {
    icon: EnvelopeOpen,
    color: 'text-emerald-600',
    label: 'Email Clicked',
    bgColor: 'bg-emerald-600/10'
  },
  sms_sent: {
    icon: ChatText,
    color: 'text-violet-500',
    label: 'SMS Sent',
    bgColor: 'bg-violet-500/10'
  },
  sms_received: {
    icon: ChatText,
    color: 'text-violet-600',
    label: 'SMS Received',
    bgColor: 'bg-violet-600/10'
  },
  meeting_scheduled: {
    icon: CalendarCheck,
    color: 'text-amber-500',
    label: 'Meeting Scheduled',
    bgColor: 'bg-amber-500/10'
  },
  meeting_completed: {
    icon: CalendarCheck,
    color: 'text-green-600',
    label: 'Meeting Completed',
    bgColor: 'bg-green-600/10'
  },
  meeting_cancelled: {
    icon: CalendarX,
    color: 'text-red-400',
    label: 'Meeting Cancelled',
    bgColor: 'bg-red-400/10'
  },
  note: { icon: Note, color: 'text-slate-500', label: 'Note', bgColor: 'bg-slate-500/10' },
  task_created: {
    icon: PencilSimple,
    color: 'text-orange-500',
    label: 'Task Created',
    bgColor: 'bg-orange-500/10'
  },
  task_completed: {
    icon: CheckCircle,
    color: 'text-green-500',
    label: 'Task Completed',
    bgColor: 'bg-green-500/10'
  },
  status_change: {
    icon: ArrowsClockwise,
    color: 'text-indigo-500',
    label: 'Status Change',
    bgColor: 'bg-indigo-500/10'
  },
  document_sent: {
    icon: FileText,
    color: 'text-cyan-500',
    label: 'Document Sent',
    bgColor: 'bg-cyan-500/10'
  },
  document_signed: {
    icon: FileText,
    color: 'text-green-600',
    label: 'Document Signed',
    bgColor: 'bg-green-600/10'
  }
}

type ActivityCategory = 'all' | 'calls' | 'emails' | 'sms' | 'meetings' | 'notes' | 'other'

const categoryFilters: Record<ActivityCategory, ActivityType[]> = {
  all: Object.keys(activityConfig) as ActivityType[],
  calls: ['call_outbound', 'call_inbound', 'call_missed'],
  emails: ['email_sent', 'email_received', 'email_opened', 'email_clicked'],
  sms: ['sms_sent', 'sms_received'],
  meetings: ['meeting_scheduled', 'meeting_completed', 'meeting_cancelled'],
  notes: ['note', 'task_created', 'task_completed'],
  other: ['status_change', 'document_sent', 'document_signed']
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
}

export function ActivityTimeline({
  activities,
  className,
  maxHeight = '400px',
  showFilters = true,
  emptyMessage = 'No activity recorded yet'
}: ActivityTimelineProps) {
  const [categoryFilter, setCategoryFilter] = useState<ActivityCategory>('all')

  const filteredActivities = useMemo(() => {
    const allowedTypes = categoryFilters[categoryFilter]
    return activities
      .filter((activity) => allowedTypes.includes(activity.activityType))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [activities, categoryFilter])

  if (activities.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground text-center">{emptyMessage}</p>
      </Card>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {showFilters && (
        <div className="flex items-center gap-2">
          <Funnel size={16} weight="bold" className="text-muted-foreground" />
          <Select
            value={categoryFilter}
            onValueChange={(value) => setCategoryFilter(value as ActivityCategory)}
          >
            <SelectTrigger className="w-[160px]" size="sm">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Activity</SelectItem>
              <SelectItem value="calls">Calls</SelectItem>
              <SelectItem value="emails">Emails</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="meetings">Meetings</SelectItem>
              <SelectItem value="notes">Notes & Tasks</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="ml-auto">
            {filteredActivities.length} activities
          </Badge>
        </div>
      )}

      <ScrollArea className="pr-4" style={{ maxHeight }}>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-4">
            {filteredActivities.map((activity) => {
              const config = activityConfig[activity.activityType]
              const Icon = config.icon

              return (
                <div key={activity.id} className="relative pl-10">
                  {/* Timeline dot */}
                  <div
                    className={cn(
                      'absolute left-0 w-8 h-8 rounded-full flex items-center justify-center',
                      config.bgColor
                    )}
                  >
                    <Icon size={16} weight="fill" className={config.color} />
                  </div>

                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {config.label}
                        </Badge>
                        {activity.outcome && (
                          <Badge variant="secondary" className="text-xs">
                            {activity.outcome}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(activity.createdAt)}
                      </span>
                    </div>

                    {activity.subject && (
                      <h4 className="font-medium text-sm mb-1">{activity.subject}</h4>
                    )}

                    {activity.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {activity.description}
                      </p>
                    )}

                    {activity.durationSeconds && activity.durationSeconds > 0 && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <Phone size={12} weight="bold" />
                        <span>Duration: {formatDuration(activity.durationSeconds)}</span>
                      </div>
                    )}
                  </Card>
                </div>
              )
            })}
          </div>
        </div>
      </ScrollArea>

      {filteredActivities.length === 0 && activities.length > 0 && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground text-center">
            No activities match the selected filter
          </p>
          <div className="flex justify-center mt-2">
            <Button variant="outline" size="sm" onClick={() => setCategoryFilter('all')}>
              Show All
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
