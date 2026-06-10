import { useState, useMemo } from 'react'
import { AuditLog, User } from '@public-records/core'
import { Card, CardHeader, CardTitle, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Badge } from '@public-records/ui/badge'
import { ScrollArea } from '@public-records/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@public-records/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@public-records/ui/dialog'
import {
  MagnifyingGlass,
  Funnel,
  Export,
  ClockCounterClockwise,
  User as UserIcon,
  ArrowRight,
  Eye,
  Calendar
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface AuditLogViewerProps {
  auditLogs: AuditLog[]
  users?: User[]
  onExport: (logs: AuditLog[]) => void
  className?: string
}

type EntityTypeFilter =
  | 'all'
  | 'prospect'
  | 'contact'
  | 'deal'
  | 'communication'
  | 'disclosure'
  | 'other'
type ActionFilter = 'all' | 'create' | 'update' | 'delete' | 'view' | 'send' | 'sign'

const actionColors: Record<string, string> = {
  create: 'bg-green-500',
  insert: 'bg-green-500',
  update: 'bg-blue-500',
  delete: 'bg-red-500',
  view: 'bg-slate-400',
  read: 'bg-slate-400',
  send: 'bg-purple-500',
  sign: 'bg-emerald-500',
  login: 'bg-amber-500',
  logout: 'bg-amber-500'
}

const entityTypeLabels: Record<string, string> = {
  prospect: 'Prospect',
  contact: 'Contact',
  deal: 'Deal',
  communication: 'Communication',
  disclosure: 'Disclosure',
  consent: 'Consent',
  document: 'Document',
  user: 'User',
  organization: 'Organization'
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function getUserName(userId: string | undefined, users: User[]): string {
  if (!userId) return 'System'
  const user = users.find((u) => u.id === userId)
  return user ? `${user.firstName} ${user.lastName}` : userId.slice(0, 8)
}

function renderChanges(changes?: Record<string, { old: unknown; new: unknown }>): React.ReactNode {
  if (!changes || Object.keys(changes).length === 0) {
    return <span className="text-muted-foreground text-xs">No changes recorded</span>
  }

  return (
    <div className="space-y-2">
      {Object.entries(changes).map(([field, change]) => (
        <div key={field} className="text-xs">
          <span className="font-medium">{field}:</span>
          <div className="flex items-center gap-2 mt-0.5 pl-2">
            <span className="text-red-500 line-through bg-red-500/10 px-1 rounded">
              {JSON.stringify(change.old)}
            </span>
            <ArrowRight size={12} className="text-muted-foreground" />
            <span className="text-green-500 bg-green-500/10 px-1 rounded">
              {JSON.stringify(change.new)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function AuditLogViewer({
  auditLogs,
  users = [],
  onExport,
  className
}: AuditLogViewerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityTypeFilter>('all')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)

  // Filter audit logs
  const filteredLogs = useMemo(() => {
    return auditLogs
      .filter((log) => {
        // Entity type filter
        if (entityTypeFilter !== 'all') {
          if (entityTypeFilter === 'other') {
            const knownTypes = ['prospect', 'contact', 'deal', 'communication', 'disclosure']
            if (knownTypes.includes(log.entityType)) return false
          } else if (log.entityType !== entityTypeFilter) {
            return false
          }
        }

        // Action filter
        if (actionFilter !== 'all') {
          const action = log.action.toLowerCase()
          if (!action.includes(actionFilter)) return false
        }

        // User filter
        if (userFilter !== 'all' && log.userId !== userFilter) return false

        // Date range filter
        if (dateFrom) {
          const logDate = new Date(log.createdAt)
          const fromDate = new Date(dateFrom)
          if (logDate < fromDate) return false
        }
        if (dateTo) {
          const logDate = new Date(log.createdAt)
          const toDate = new Date(dateTo)
          toDate.setHours(23, 59, 59, 999)
          if (logDate > toDate) return false
        }

        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          const userName = getUserName(log.userId, users).toLowerCase()
          return (
            log.action.toLowerCase().includes(query) ||
            log.entityType.toLowerCase().includes(query) ||
            (log.entityId && log.entityId.toLowerCase().includes(query)) ||
            userName.includes(query)
          )
        }

        return true
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [auditLogs, entityTypeFilter, actionFilter, userFilter, dateFrom, dateTo, searchQuery, users])

  // Get unique users for filter
  const uniqueUsers = useMemo(() => {
    const userIds = new Set(auditLogs.map((log) => log.userId).filter(Boolean))
    return Array.from(userIds)
      .map((id) => {
        const user = users.find((u) => u.id === id)
        return { id: id!, name: user ? `${user.firstName} ${user.lastName}` : id!.slice(0, 8) }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [auditLogs, users])

  const handleExport = () => {
    onExport(filteredLogs)
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader className="border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <ClockCounterClockwise size={20} weight="fill" className="text-primary" />
            Audit Log
            <Badge variant="secondary">{filteredLogs.length}</Badge>
          </CardTitle>
          <Button variant="outline" onClick={handleExport}>
            <Export size={14} weight="bold" className="mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Filters */}
        <div className="space-y-3 mb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlass
                size={14}
                weight="bold"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search by action, entity, user..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={entityTypeFilter}
              onValueChange={(v) => setEntityTypeFilter(v as EntityTypeFilter)}
            >
              <SelectTrigger className="w-[140px]">
                <Funnel size={14} className="mr-2" />
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                <SelectItem value="prospect">Prospects</SelectItem>
                <SelectItem value="contact">Contacts</SelectItem>
                <SelectItem value="deal">Deals</SelectItem>
                <SelectItem value="communication">Communications</SelectItem>
                <SelectItem value="disclosure">Disclosures</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as ActionFilter)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="view">View</SelectItem>
                <SelectItem value="send">Send</SelectItem>
                <SelectItem value="sign">Sign</SelectItem>
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-[150px]">
                <UserIcon size={14} className="mr-2" />
                <SelectValue placeholder="User" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {uniqueUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-muted-foreground" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[140px] h-9"
                placeholder="From"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[140px] h-9"
                placeholder="To"
              />
            </div>
          </div>
        </div>

        {/* Audit Log Table */}
        <div className="rounded-lg border">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Entity ID</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No audit logs match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => {
                    const actionKey = log.action.toLowerCase().split('_')[0]
                    const actionColor = actionColors[actionKey] || 'bg-slate-400'

                    return (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-xs">
                          {formatDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <UserIcon size={14} className="text-muted-foreground" />
                            <span className="text-sm">{getUserName(log.userId, users)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={cn('w-2 h-2 rounded-full', actionColor)} />
                            <span className="text-sm capitalize">
                              {log.action.replace('_', ' ')}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {entityTypeLabels[log.entityType] || log.entityType}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.entityId ? log.entityId.slice(0, 12) : '-'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setSelectedLog(log)}
                          >
                            <Eye size={14} weight="bold" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </CardContent>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
            <DialogDescription>Full details of the audit event</DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Timestamp</p>
                  <p className="font-mono text-sm">{formatDateTime(selectedLog.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">User</p>
                  <p className="text-sm">{getUserName(selectedLog.userId, users)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Action</p>
                  <p className="text-sm capitalize">{selectedLog.action.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Entity Type</p>
                  <p className="text-sm capitalize">{selectedLog.entityType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Entity ID</p>
                  <p className="font-mono text-sm">{selectedLog.entityId || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Request ID</p>
                  <p className="font-mono text-sm">{selectedLog.requestId || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IP Address</p>
                  <p className="font-mono text-sm">{selectedLog.ipAddress || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">User Agent</p>
                  <p className="text-xs truncate">{selectedLog.userAgent || '-'}</p>
                </div>
              </div>

              {selectedLog.changes && Object.keys(selectedLog.changes).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Changes</p>
                  <Card className="p-3 bg-muted/30">{renderChanges(selectedLog.changes)}</Card>
                </div>
              )}

              {selectedLog.beforeState && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Before State</p>
                  <Card className="p-3 bg-muted/30">
                    <pre className="text-xs overflow-auto max-h-[150px]">
                      {JSON.stringify(selectedLog.beforeState, null, 2)}
                    </pre>
                  </Card>
                </div>
              )}

              {selectedLog.afterState && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">After State</p>
                  <Card className="p-3 bg-muted/30">
                    <pre className="text-xs overflow-auto max-h-[150px]">
                      {JSON.stringify(selectedLog.afterState, null, 2)}
                    </pre>
                  </Card>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
