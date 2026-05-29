import { useState, useMemo, useEffect } from 'react'
import {
  Contact,
  CommunicationChannel,
  CommunicationTemplate,
  TemplateCategory
} from '@public-records/core'
import { Card } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Textarea } from '@public-records/ui/textarea'
import { Label } from '@public-records/ui/label'
import { Separator } from '@public-records/ui/separator'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@public-records/ui/tabs'
import {
  Envelope,
  ChatText,
  PaperPlaneRight,
  Clock,
  Eye,
  PencilSimple,
  MagnifyingGlass,
  User
} from '@phosphor-icons/react'

interface ComposerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contacts: Contact[]
  templates: CommunicationTemplate[]
  defaultChannel?: CommunicationChannel
  defaultContactId?: string
  onSend: (data: {
    channel: CommunicationChannel
    contactId: string
    subject?: string
    body: string
    templateId?: string
    scheduledFor?: string
  }) => void
  isSending?: boolean
}

// Radix Select forbids empty-string item values; use a sentinel for "blank".
const BLANK_TEMPLATE_VALUE = '__blank__'

const channelOptions: { value: CommunicationChannel; label: string; icon: typeof Envelope }[] = [
  { value: 'email', label: 'Email', icon: Envelope },
  { value: 'sms', label: 'SMS', icon: ChatText }
]

const templateCategoryLabels: Record<TemplateCategory, string> = {
  initial_outreach: 'Initial Outreach',
  follow_up: 'Follow Up',
  application_request: 'Application Request',
  document_request: 'Document Request',
  approval_notification: 'Approval',
  funding_notification: 'Funding',
  check_in: 'Check In',
  renewal: 'Renewal',
  other: 'Other'
}

function extractVariables(text: string): string[] {
  const regex = /\{\{(\w+(?:\.\w+)?)\}\}/g
  const matches: string[] = []
  let match
  while ((match = regex.exec(text)) !== null) {
    if (!matches.includes(match[1])) {
      matches.push(match[1])
    }
  }
  return matches
}

function replaceVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, key) => variables[key] || `{{${key}}}`)
}

export function Composer({
  open,
  onOpenChange,
  contacts,
  templates,
  defaultChannel = 'email',
  defaultContactId,
  onSend,
  isSending = false
}: ComposerProps) {
  const [channel, setChannel] = useState<CommunicationChannel>(defaultChannel)
  const [contactId, setContactId] = useState<string>(defaultContactId || '')
  const [templateId, setTemplateId] = useState<string>('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [isPreview, setIsPreview] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [variables, setVariables] = useState<Record<string, string>>({})

  // Get selected contact
  const selectedContact = useMemo(() => {
    return contacts.find((c) => c.id === contactId)
  }, [contacts, contactId])

  // Filter contacts by search
  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts
    const query = contactSearch.toLowerCase()
    return contacts.filter(
      (c) =>
        c.firstName.toLowerCase().includes(query) ||
        c.lastName.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query) ||
        c.phone?.includes(query)
    )
  }, [contacts, contactSearch])

  // Filter templates by channel
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => t.channel === channel || t.channel === 'call_script')
  }, [templates, channel])

  // Group templates by category
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, CommunicationTemplate[]> = {}
    filteredTemplates.forEach((template) => {
      const category = template.category || 'other'
      if (!groups[category]) groups[category] = []
      groups[category].push(template)
    })
    return groups
  }, [filteredTemplates])

  // Extract variables from current body
  const bodyVariables = useMemo(() => {
    return extractVariables(body)
  }, [body])

  // Get preview text with variables replaced
  const previewBody = useMemo(() => {
    const contactVars: Record<string, string> = {}
    if (selectedContact) {
      contactVars['contact.firstName'] = selectedContact.firstName
      contactVars['contact.lastName'] = selectedContact.lastName
      contactVars['contact.email'] = selectedContact.email || ''
      contactVars['contact.phone'] = selectedContact.phone || ''
      contactVars['contact.name'] = `${selectedContact.firstName} ${selectedContact.lastName}`
    }
    return replaceVariables(body, { ...contactVars, ...variables })
  }, [body, variables, selectedContact])

  const previewSubject = useMemo(() => {
    const contactVars: Record<string, string> = {}
    if (selectedContact) {
      contactVars['contact.firstName'] = selectedContact.firstName
      contactVars['contact.lastName'] = selectedContact.lastName
      contactVars['contact.name'] = `${selectedContact.firstName} ${selectedContact.lastName}`
    }
    return replaceVariables(subject, { ...contactVars, ...variables })
  }, [subject, variables, selectedContact])

  // Handle template selection
  const handleTemplateSelect = (id: string) => {
    // Normalize the "blank" sentinel back to '' for internal state.
    const normalizedId = id === BLANK_TEMPLATE_VALUE ? '' : id
    setTemplateId(normalizedId)
    const template = templates.find((t) => t.id === normalizedId)
    if (template) {
      setSubject(template.subject || '')
      setBody(template.body)
    }
  }

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset of this prop-controlled dialog's form state when it closes
      setChannel(defaultChannel)
      setContactId(defaultContactId || '')
      setTemplateId('')
      setSubject('')
      setBody('')
      setScheduledFor('')
      setIsPreview(false)
      setVariables({})
    }
  }, [open, defaultChannel, defaultContactId])

  // Handle send
  const handleSend = () => {
    if (!contactId || !body.trim()) return

    onSend({
      channel,
      contactId,
      subject: channel === 'email' ? previewSubject : undefined,
      body: previewBody,
      templateId: templateId || undefined,
      scheduledFor: scheduledFor || undefined
    })
  }

  const ChannelIcon = channelOptions.find((c) => c.value === channel)?.icon || Envelope

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ChannelIcon size={24} weight="fill" className="text-primary" />
            <div>
              <DialogTitle>Compose Message</DialogTitle>
              <DialogDescription>
                Send a {channel === 'email' ? 'email' : 'SMS'} message to your contact
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Channel Selection */}
          <div className="flex gap-2">
            {channelOptions.map((option) => {
              const Icon = option.icon
              const isSelected = channel === option.value
              return (
                <Button
                  key={option.value}
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setChannel(option.value)}
                >
                  <Icon size={14} weight="fill" className="mr-2" />
                  {option.label}
                </Button>
              )
            })}
          </div>

          <Separator />

          {/* Contact Selection */}
          <div>
            <Label className="mb-2 block">To</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a contact" />
              </SelectTrigger>
              <SelectContent>
                <div className="p-2">
                  <div className="relative">
                    <MagnifyingGlass
                      size={14}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      placeholder="Search contacts..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="pl-7 h-8"
                    />
                  </div>
                </div>
                {filteredContacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-muted-foreground" />
                      <span>
                        {contact.firstName} {contact.lastName}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {channel === 'email' ? contact.email : contact.phone}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Template Selection */}
          <div>
            <Label className="mb-2 block">Template (Optional)</Label>
            <Select value={templateId || BLANK_TEMPLATE_VALUE} onValueChange={handleTemplateSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template or start from scratch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BLANK_TEMPLATE_VALUE}>Blank Message</SelectItem>
                {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                  <div key={category}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      {templateCategoryLabels[category as TemplateCategory] || category}
                    </div>
                    {categoryTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Message Content */}
          <Tabs value={isPreview ? 'preview' : 'edit'} className="w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Message Content</h3>
              <TabsList>
                <TabsTrigger value="edit" onClick={() => setIsPreview(false)}>
                  <PencilSimple size={14} className="mr-1" />
                  Edit
                </TabsTrigger>
                <TabsTrigger value="preview" onClick={() => setIsPreview(true)}>
                  <Eye size={14} className="mr-1" />
                  Preview
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="edit" className="mt-0 space-y-4">
              {/* Subject (Email only) */}
              {channel === 'email' && (
                <div>
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Enter email subject"
                    className="mt-1"
                  />
                </div>
              )}

              {/* Body */}
              <div>
                <Label htmlFor="body">Message</Label>
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={`Enter your ${channel === 'email' ? 'email' : 'SMS'} message...`}
                  className="mt-1 min-h-[200px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Use {'{{variable}}'} syntax for dynamic content (e.g., {'{{contact.firstName}}'})
                </p>
              </div>

              {/* Variable Inputs */}
              {bodyVariables.length > 0 && (
                <div>
                  <Label className="mb-2 block">Variables</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {bodyVariables
                      .filter((v) => !v.startsWith('contact.'))
                      .map((variable) => (
                        <div key={variable}>
                          <Label htmlFor={variable} className="text-xs text-muted-foreground">
                            {variable}
                          </Label>
                          <Input
                            id={variable}
                            value={variables[variable] || ''}
                            onChange={(e) =>
                              setVariables((prev) => ({ ...prev, [variable]: e.target.value }))
                            }
                            placeholder={`Enter ${variable}`}
                            className="mt-1 h-8"
                          />
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="preview" className="mt-0">
              {channel === 'email' && previewSubject && (
                <div className="mb-4">
                  <Label className="text-muted-foreground text-xs">Subject</Label>
                  <p className="font-medium">{previewSubject}</p>
                </div>
              )}
              <Card className="p-4 bg-muted/30 min-h-[200px]">
                <div className="whitespace-pre-wrap text-sm">{previewBody || 'No content'}</div>
              </Card>
              {selectedContact && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <User size={14} />
                  <span>
                    Sending to {selectedContact.firstName} {selectedContact.lastName}
                  </span>
                  <span>
                    ({channel === 'email' ? selectedContact.email : selectedContact.phone})
                  </span>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <Separator />

          {/* Schedule */}
          <div>
            <Label htmlFor="schedule">Schedule Send (Optional)</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="schedule"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="flex-1"
              />
              {scheduledFor && (
                <Button variant="outline" onClick={() => setScheduledFor('')}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSending || !contactId || !body.trim()}>
            {isSending ? (
              'Sending...'
            ) : scheduledFor ? (
              <>
                <Clock size={14} weight="bold" className="mr-2" />
                Schedule
              </>
            ) : (
              <>
                <PaperPlaneRight size={14} weight="bold" className="mr-2" />
                Send
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
