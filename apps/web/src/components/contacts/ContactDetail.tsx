import { useState } from 'react'
import { Contact, ContactActivity, Prospect, ProspectContact } from '@public-records/core'
import { Card, CardHeader, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Badge } from '@public-records/ui/badge'
import { Separator } from '@public-records/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@public-records/ui/tabs'
import { Avatar, AvatarFallback } from '@public-records/ui/avatar'
import { ActivityTimeline } from '@/components/shared/ActivityTimeline'
import {
  Phone,
  Envelope,
  ChatText,
  MapPin,
  Buildings,
  Clock,
  PencilSimple,
  Link as LinkIcon,
  CalendarPlus,
  ArrowLeft,
  Tag,
  User,
  Globe
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface ContactDetailProps {
  contact: Contact
  activities: ContactActivity[]
  linkedProspects?: Array<{
    prospect: Prospect
    link: ProspectContact
  }>
  onEdit: () => void
  onBack: () => void
  onCall?: (contact: Contact) => void
  onEmail?: (contact: Contact) => void
  onSms?: (contact: Contact) => void
  onScheduleMeeting?: (contact: Contact) => void
  onLinkProspect?: (contact: Contact) => void
  onProspectSelect?: (prospect: Prospect) => void
  className?: string
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

function formatPhoneDisplay(phone?: string, ext?: string): string {
  if (!phone) return '-'
  return ext ? `${phone} ext. ${ext}` : phone
}

function formatDate(dateString?: string): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  ceo: 'CEO',
  cfo: 'CFO',
  controller: 'Controller',
  manager: 'Manager',
  bookkeeper: 'Bookkeeper',
  other: 'Other'
}

const preferredMethodLabels: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  mobile: 'Mobile',
  sms: 'SMS'
}

export function ContactDetail({
  contact,
  activities,
  linkedProspects = [],
  onEdit,
  onBack,
  onCall,
  onEmail,
  onSms,
  onScheduleMeeting,
  onLinkProspect,
  onProspectSelect,
  className
}: ContactDetailProps) {
  const [activeTab, setActiveTab] = useState('overview')

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} weight="bold" className="mr-2" />
          Back
        </Button>
      </div>

      {/* Profile Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Avatar & Quick Actions */}
            <div className="flex flex-col items-center gap-4">
              <Avatar className="w-24 h-24">
                <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                  {getInitials(contact.firstName, contact.lastName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex gap-2">
                {onCall && (
                  <Button variant="outline" size="sm" onClick={() => onCall(contact)}>
                    <Phone size={14} weight="fill" />
                  </Button>
                )}
                {onEmail && (
                  <Button variant="outline" size="sm" onClick={() => onEmail(contact)}>
                    <Envelope size={14} weight="fill" />
                  </Button>
                )}
                {onSms && (
                  <Button variant="outline" size="sm" onClick={() => onSms(contact)}>
                    <ChatText size={14} weight="fill" />
                  </Button>
                )}
              </div>
            </div>

            {/* Contact Info */}
            <div className="flex-1 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">
                    {contact.firstName} {contact.lastName}
                  </h2>
                  {contact.title && <p className="text-muted-foreground">{contact.title}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    {contact.role && (
                      <Badge variant="default">{roleLabels[contact.role] || contact.role}</Badge>
                    )}
                    <Badge variant={contact.isActive ? 'secondary' : 'outline'}>
                      {contact.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
                <Button variant="outline" onClick={onEdit}>
                  <PencilSimple size={14} weight="bold" className="mr-2" />
                  Edit
                </Button>
              </div>

              <Separator />

              {/* Contact Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Envelope size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm font-medium">{contact.email || '-'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Phone size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="text-sm font-medium">
                      {formatPhoneDisplay(contact.phone, contact.phoneExt)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ChatText size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Mobile</p>
                    <p className="text-sm font-medium">{contact.mobile || '-'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <User size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Preferred Contact</p>
                    <p className="text-sm font-medium">
                      {preferredMethodLabels[contact.preferredContactMethod] ||
                        contact.preferredContactMethod}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Globe size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Timezone</p>
                    <p className="text-sm font-medium">{contact.timezone}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Clock size={16} weight="fill" className="text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Last Contacted</p>
                    <p className="text-sm font-medium">{formatDate(contact.lastContactedAt)}</p>
                  </div>
                </div>
              </div>

              {/* Tags */}
              {contact.tags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag size={14} weight="bold" className="text-muted-foreground" />
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs for Activity, Notes, Linked Prospects */}
      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <CardHeader className="pb-0">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="overview">Activity</TabsTrigger>
              <TabsTrigger value="prospects">
                Linked Prospects
                {linkedProspects.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {linkedProspects.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="pt-4">
            <TabsContent value="overview" className="mt-0">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-medium">Recent Activity</h3>
                {onScheduleMeeting && (
                  <Button variant="outline" size="sm" onClick={() => onScheduleMeeting(contact)}>
                    <CalendarPlus size={14} weight="bold" className="mr-2" />
                    Schedule Meeting
                  </Button>
                )}
              </div>
              <ActivityTimeline
                activities={activities}
                maxHeight="400px"
                emptyMessage="No activity recorded for this contact yet."
              />
            </TabsContent>

            <TabsContent value="prospects" className="mt-0">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-medium">Linked Prospects</h3>
                {onLinkProspect && (
                  <Button variant="outline" size="sm" onClick={() => onLinkProspect(contact)}>
                    <LinkIcon size={14} weight="bold" className="mr-2" />
                    Link Prospect
                  </Button>
                )}
              </div>

              {linkedProspects.length === 0 ? (
                <Card className="p-6 text-center">
                  <Buildings size={32} className="mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No prospects linked to this contact yet.
                  </p>
                  {onLinkProspect && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => onLinkProspect(contact)}
                    >
                      Link a Prospect
                    </Button>
                  )}
                </Card>
              ) : (
                <div className="space-y-3">
                  {linkedProspects.map(({ prospect, link }) => (
                    <Card
                      key={prospect.id}
                      className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => onProspectSelect?.(prospect)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Buildings size={20} weight="fill" className="text-primary" />
                          </div>
                          <div>
                            <h4 className="font-medium">{prospect.companyName}</h4>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <MapPin size={12} weight="fill" />
                              <span>{prospect.state}</span>
                              <span className="capitalize">{prospect.industry}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {link.isPrimary && <Badge variant="default">Primary</Badge>}
                          <Badge variant="outline">{link.relationship}</Badge>
                          <Badge variant="secondary">Score: {prospect.priorityScore}</Badge>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="notes" className="mt-0">
              <h3 className="font-medium mb-4">Notes</h3>
              {contact.notes ? (
                <Card className="p-4 bg-muted/30">
                  <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
                </Card>
              ) : (
                <Card className="p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    No notes added for this contact yet.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={onEdit}>
                    Add Notes
                  </Button>
                </Card>
              )}

              <div className="mt-6 pt-4 border-t">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Contact Info</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Source: </span>
                    <span>{contact.source || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created: </span>
                    <span>{formatDate(contact.createdAt)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Updated: </span>
                    <span>{formatDate(contact.updatedAt)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created By: </span>
                    <span>{contact.createdBy || '-'}</span>
                  </div>
                </div>
              </div>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}
