import { useState, useMemo } from 'react'
import { ConsentRecord, Contact, ConsentType, CollectionMethod } from '@public-records/core'
import { Card, CardHeader, CardTitle, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Badge } from '@public-records/ui/badge'
import { ScrollArea } from '@public-records/ui/scroll-area'
import { Label } from '@public-records/ui/label'
import { Textarea } from '@public-records/ui/textarea'
import { Separator } from '@public-records/ui/separator'
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
  DialogDescription,
  DialogFooter
} from '@public-records/ui/dialog'
import { Avatar, AvatarFallback } from '@public-records/ui/avatar'
import {
  MagnifyingGlass,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  Envelope,
  ChatText,
  Phone,
  Prohibit,
  Eye
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface ConsentDashboardProps {
  consents: ConsentRecord[]
  contacts: Contact[]
  onRecordConsent: (data: {
    contactId: string
    consentType: ConsentType
    channel?: string
    consentText?: string
    collectionMethod: CollectionMethod
  }) => void
  onRevokeConsent: (consentId: string, reason: string) => void
  className?: string
}

type ConsentStatusFilter = 'all' | 'active' | 'revoked' | 'expired'

// Radix Select forbids empty-string item values; use a sentinel for "unspecified".
const UNSPECIFIED_CHANNEL_VALUE = '__none__'

const consentTypeLabels: Record<ConsentType, string> = {
  express_written: 'Express Written',
  prior_express: 'Prior Express',
  transactional: 'Transactional',
  marketing_email: 'Marketing Email',
  marketing_sms: 'Marketing SMS',
  marketing_call: 'Marketing Call',
  data_sharing: 'Data Sharing',
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy'
}

const collectionMethodLabels: Record<CollectionMethod, string> = {
  web_form: 'Web Form',
  phone_recording: 'Phone Recording',
  signed_document: 'Signed Document',
  email_opt_in: 'Email Opt-in',
  sms_opt_in: 'SMS Opt-in',
  verbal: 'Verbal',
  imported: 'Imported'
}

const channelIcons: Record<string, typeof Envelope> = {
  email: Envelope,
  sms: ChatText,
  call: Phone,
  mail: Envelope,
  all: CheckCircle
}

function formatDate(dateString?: string): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatDateTime(dateString?: string): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getContactName(contactId: string, contacts: Contact[]): string {
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

function getConsentStatus(consent: ConsentRecord): {
  status: ConsentStatusFilter
  label: string
  color: string
} {
  if (consent.revokedAt) {
    return { status: 'revoked', label: 'Revoked', color: 'text-red-500' }
  }
  if (consent.expiresAt && new Date(consent.expiresAt) < new Date()) {
    return { status: 'expired', label: 'Expired', color: 'text-amber-500' }
  }
  return { status: 'active', label: 'Active', color: 'text-green-500' }
}

export function ConsentDashboard({
  consents,
  contacts,
  onRecordConsent,
  onRevokeConsent,
  className
}: ConsentDashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ConsentStatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<ConsentType | 'all'>('all')
  const [selectedConsent, setSelectedConsent] = useState<ConsentRecord | null>(null)
  const [showRecordDialog, setShowRecordDialog] = useState(false)
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')

  // New consent form state
  const [newConsentContactId, setNewConsentContactId] = useState('')
  const [newConsentType, setNewConsentType] = useState<ConsentType | ''>('')
  const [newConsentChannel, setNewConsentChannel] = useState('')
  const [newConsentMethod, setNewConsentMethod] = useState<CollectionMethod | ''>('')
  const [newConsentText, setNewConsentText] = useState('')

  // Filter consents
  const filteredConsents = useMemo(() => {
    return consents
      .filter((consent) => {
        // Status filter
        const consentStatus = getConsentStatus(consent)
        if (statusFilter !== 'all' && consentStatus.status !== statusFilter) return false

        // Type filter
        if (typeFilter !== 'all' && consent.consentType !== typeFilter) return false

        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          const contactName = getContactName(consent.contactId, contacts).toLowerCase()
          return (
            contactName.includes(query) ||
            consent.consentType.toLowerCase().includes(query) ||
            (consent.channel && consent.channel.toLowerCase().includes(query))
          )
        }
        return true
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [consents, statusFilter, typeFilter, searchQuery, contacts])

  // Calculate summary stats
  const stats = useMemo(() => {
    let active = 0
    let revoked = 0
    let expired = 0

    consents.forEach((consent) => {
      const status = getConsentStatus(consent)
      if (status.status === 'active') active++
      else if (status.status === 'revoked') revoked++
      else if (status.status === 'expired') expired++
    })

    return { active, revoked, expired, total: consents.length }
  }, [consents])

  // Contacts with opt-outs
  const optedOutContacts = useMemo(() => {
    const contactsWithOptOut = new Set<string>()
    consents.forEach((consent) => {
      if (consent.revokedAt && consent.consentType.startsWith('marketing_')) {
        contactsWithOptOut.add(consent.contactId)
      }
    })
    return contactsWithOptOut
  }, [consents])

  const handleRecordConsent = () => {
    if (newConsentContactId && newConsentType && newConsentMethod) {
      onRecordConsent({
        contactId: newConsentContactId,
        consentType: newConsentType,
        channel: newConsentChannel || undefined,
        consentText: newConsentText || undefined,
        collectionMethod: newConsentMethod
      })
      setShowRecordDialog(false)
      resetNewConsentForm()
    }
  }

  const handleRevokeConsent = () => {
    if (selectedConsent && revokeReason) {
      onRevokeConsent(selectedConsent.id, revokeReason)
      setShowRevokeDialog(false)
      setSelectedConsent(null)
      setRevokeReason('')
    }
  }

  const resetNewConsentForm = () => {
    setNewConsentContactId('')
    setNewConsentType('')
    setNewConsentChannel('')
    setNewConsentMethod('')
    setNewConsentText('')
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader className="border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck size={20} weight="fill" className="text-primary" />
            Consent Management
            <Badge variant="secondary">{filteredConsents.length}</Badge>
          </CardTitle>
          <Button onClick={() => setShowRecordDialog(true)}>
            <Plus size={14} weight="bold" className="mr-2" />
            Record Consent
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle size={20} weight="fill" className="text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{stats.active}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <XCircle size={20} weight="fill" className="text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{stats.revoked}</p>
                <p className="text-xs text-muted-foreground">Revoked</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Clock size={20} weight="fill" className="text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{stats.expired}</p>
                <p className="text-xs text-muted-foreground">Expired</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Prohibit size={20} weight="fill" className="text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{optedOutContacts.size}</p>
                <p className="text-xs text-muted-foreground">Opt-outs</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={14}
              weight="bold"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search by contact or consent type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as ConsentStatusFilter)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ConsentType | 'all')}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {(Object.keys(consentTypeLabels) as ConsentType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {consentTypeLabels[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Consents Table */}
        <div className="rounded-lg border">
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Consent Type</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConsents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No consent records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredConsents.map((consent) => {
                    const contactName = getContactName(consent.contactId, contacts)
                    const status = getConsentStatus(consent)
                    const ChannelIcon = consent.channel
                      ? channelIcons[consent.channel] || CheckCircle
                      : CheckCircle

                    return (
                      <TableRow key={consent.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="w-7 h-7">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {getInitials(contactName)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm">{contactName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {consentTypeLabels[consent.consentType]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {consent.channel ? (
                            <div className="flex items-center gap-1">
                              <ChannelIcon size={14} className="text-muted-foreground" />
                              <span className="text-sm capitalize">{consent.channel}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {collectionMethodLabels[consent.collectionMethod]}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={status.status === 'active' ? 'default' : 'secondary'}
                            className={cn('text-xs', status.color)}
                          >
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(consent.grantedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => setSelectedConsent(consent)}
                            >
                              <Eye size={14} weight="bold" />
                            </Button>
                            {status.status === 'active' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-500"
                                onClick={() => {
                                  setSelectedConsent(consent)
                                  setShowRevokeDialog(true)
                                }}
                              >
                                <XCircle size={14} weight="bold" />
                              </Button>
                            )}
                          </div>
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
      <Dialog
        open={!!selectedConsent && !showRevokeDialog}
        onOpenChange={() => setSelectedConsent(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck size={20} weight="fill" className="text-primary" />
              Consent Details
            </DialogTitle>
          </DialogHeader>

          {selectedConsent && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Contact</p>
                  <p className="font-medium">
                    {getContactName(selectedConsent.contactId, contacts)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Status</p>
                  {(() => {
                    const status = getConsentStatus(selectedConsent)
                    return (
                      <Badge variant="outline" className={status.color}>
                        {status.label}
                      </Badge>
                    )
                  })()}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Consent Type</p>
                  <p className="font-medium">{consentTypeLabels[selectedConsent.consentType]}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Channel</p>
                  <p className="capitalize">{selectedConsent.channel || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Collection Method</p>
                  <p>{collectionMethodLabels[selectedConsent.collectionMethod]}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Granted At</p>
                  <p>{formatDateTime(selectedConsent.grantedAt)}</p>
                </div>
              </div>

              {selectedConsent.consentText && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Consent Text</p>
                  <Card className="p-3 bg-muted/30 text-sm">{selectedConsent.consentText}</Card>
                </div>
              )}

              {selectedConsent.revokedAt && (
                <div className="bg-red-500/10 p-3 rounded-lg">
                  <p className="text-sm font-medium text-red-500 mb-1">Revoked</p>
                  <p className="text-sm">Date: {formatDateTime(selectedConsent.revokedAt)}</p>
                  {selectedConsent.revokedReason && (
                    <p className="text-sm">Reason: {selectedConsent.revokedReason}</p>
                  )}
                </div>
              )}

              <Separator />

              <div className="text-xs text-muted-foreground space-y-1">
                {selectedConsent.ipAddress && <p>IP Address: {selectedConsent.ipAddress}</p>}
                {selectedConsent.collectionUrl && (
                  <p>Collection URL: {selectedConsent.collectionUrl}</p>
                )}
                {selectedConsent.collectedBy && <p>Collected By: {selectedConsent.collectedBy}</p>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke Dialog */}
      <Dialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <XCircle size={20} weight="fill" />
              Revoke Consent
            </DialogTitle>
            <DialogDescription>
              This action will revoke the consent record. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Label className="mb-2 block">Reason for Revocation *</Label>
            <Textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Enter the reason for revoking this consent..."
              className="min-h-[100px]"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevokeDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevokeConsent}
              disabled={!revokeReason.trim()}
            >
              Revoke Consent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Consent Dialog */}
      <Dialog open={showRecordDialog} onOpenChange={setShowRecordDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record New Consent</DialogTitle>
            <DialogDescription>
              Document a new consent record for compliance tracking.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label className="mb-2 block">Contact *</Label>
              <Select value={newConsentContactId} onValueChange={setNewConsentContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a contact" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.firstName} {contact.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Consent Type *</Label>
              <Select
                value={newConsentType}
                onValueChange={(v) => setNewConsentType(v as ConsentType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select consent type" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(consentTypeLabels) as ConsentType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {consentTypeLabels[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Channel (Optional)</Label>
              <Select
                value={newConsentChannel || UNSPECIFIED_CHANNEL_VALUE}
                onValueChange={(v) =>
                  setNewConsentChannel(v === UNSPECIFIED_CHANNEL_VALUE ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSPECIFIED_CHANNEL_VALUE}>Not specified</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="call">Phone Call</SelectItem>
                  <SelectItem value="mail">Mail</SelectItem>
                  <SelectItem value="all">All Channels</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Collection Method *</Label>
              <Select
                value={newConsentMethod}
                onValueChange={(v) => setNewConsentMethod(v as CollectionMethod)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="How was consent collected?" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(collectionMethodLabels) as CollectionMethod[]).map((method) => (
                    <SelectItem key={method} value={method}>
                      {collectionMethodLabels[method]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Consent Text (Optional)</Label>
              <Textarea
                value={newConsentText}
                onChange={(e) => setNewConsentText(e.target.value)}
                placeholder="Enter the exact consent language shown to the contact..."
                className="min-h-[80px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRecordDialog(false)
                resetNewConsentForm()
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRecordConsent}
              disabled={!newConsentContactId || !newConsentType || !newConsentMethod}
            >
              <CheckCircle size={14} weight="bold" className="mr-2" />
              Record Consent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
