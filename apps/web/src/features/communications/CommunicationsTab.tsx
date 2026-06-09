import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  Communication as CoreCommunication,
  CommunicationChannel,
  CommunicationTemplate as CoreCommunicationTemplate,
  Contact as CoreContact
} from '@public-records/core'
import { UnifiedInbox, Composer } from '@/components/communications'
import {
  fetchCommunications,
  fetchCommunicationTemplates,
  sendEmail,
  sendSms,
  type Communication as ApiCommunication,
  type CommunicationTemplate as ApiCommunicationTemplate
} from '@/lib/api/communications'
import { fetchContacts, type Contact as ApiContact } from '@/lib/api/contacts'

// Contacts come from the snake_case contacts client; the components consume the
// canonical camelCase `Contact`. This mapper bridges the two without
// fabricating data (mirrors features/contacts/ContactsTab.tsx#mapContact).
function mapContact(row: ApiContact): CoreContact {
  return {
    id: row.id,
    orgId: row.org_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    phoneExt: row.phone_ext,
    mobile: row.mobile,
    title: row.title,
    role: row.role,
    preferredContactMethod: row.preferred_contact_method,
    timezone: row.timezone,
    notes: row.notes,
    tags: row.tags,
    source: row.source,
    isActive: row.is_active,
    lastContactedAt: row.last_contacted_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// The communications client already returns the service's camelCase shapes, so
// these are structural pass-throughs (no snake→camel conversion). They exist to
// pin the client types to the canonical core types the components expect.
function toCoreCommunication(row: ApiCommunication): CoreCommunication {
  return row as CoreCommunication
}

function toCoreTemplate(row: ApiCommunicationTemplate): CoreCommunicationTemplate {
  return row as CoreCommunicationTemplate
}

export function CommunicationsTab() {
  const [communications, setCommunications] = useState<CoreCommunication[]>([])
  const [contacts, setContacts] = useState<CoreContact[]>([])
  const [templates, setTemplates] = useState<CoreCommunicationTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)

  // Composer dialog state.
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerChannel, setComposerChannel] = useState<CommunicationChannel>('email')
  const [composerContactId, setComposerContactId] = useState<string | undefined>(undefined)

  // orgId is intentionally omitted: the server derives the tenant from the
  // authenticated token and the client omits a blank org_id.
  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    try {
      const [commResult, contactsResult, templatesResult] = await Promise.all([
        fetchCommunications({}, signal),
        fetchContacts({ org_id: '' }, signal),
        fetchCommunicationTemplates({}, signal)
      ])
      setCommunications(commResult.communications.map(toCoreCommunication))
      setContacts(contactsResult.contacts.map(mapContact))
      setTemplates(templatesResult.templates.map(toCoreTemplate))
    } catch (err) {
      // An aborted in-flight request on unmount is not a user-facing error.
      if (signal?.aborted) return
      const error = err instanceof Error ? err : new Error('Failed to load communications')
      toast.error('Failed to load communications', { description: error.message })
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const handleCompose = useCallback((channel?: CommunicationChannel) => {
    setComposerChannel(channel ?? 'email')
    setComposerContactId(undefined)
    setComposerOpen(true)
  }, [])

  const handleReply = useCallback((communication: CoreCommunication) => {
    // Replies open the composer pre-targeted at the original contact + channel.
    // Calls have no composer channel, so fall back to email.
    setComposerChannel(communication.channel === 'call' ? 'email' : communication.channel)
    setComposerContactId(communication.contactId)
    setComposerOpen(true)
  }, [])

  // Composer's onSend rendered the body/subject already; we resolve the
  // destination (email/phone) from the selected contact and call the gated send
  // endpoint. A compliance block (403) or unconfigured/unreachable provider
  // (502) surfaces its named reason via toast — never a fabricated success.
  const handleSend = useCallback(
    async (data: {
      channel: CommunicationChannel
      contactId: string
      subject?: string
      body: string
      templateId?: string
      scheduledFor?: string
    }) => {
      const contact = contacts.find((c) => c.id === data.contactId)
      if (!contact) {
        toast.error('Cannot send', { description: 'Selected contact could not be resolved.' })
        return
      }

      setIsSending(true)
      try {
        let created: ApiCommunication
        if (data.channel === 'email') {
          const toAddress = contact.email
          if (!toAddress) {
            toast.error('Cannot send email', {
              description: `${contact.firstName} ${contact.lastName} has no email address on file.`
            })
            return
          }
          created = await sendEmail({
            contact_id: data.contactId,
            template_id: data.templateId,
            to_address: toAddress,
            subject: data.subject ?? '',
            body: data.body,
            scheduled_for: data.scheduledFor
          })
        } else {
          const toPhone = contact.phone || contact.mobile
          if (!toPhone) {
            toast.error('Cannot send SMS', {
              description: `${contact.firstName} ${contact.lastName} has no phone number on file.`
            })
            return
          }
          created = await sendSms({
            contact_id: data.contactId,
            template_id: data.templateId,
            to_phone: toPhone,
            body: data.body,
            scheduled_for: data.scheduledFor
          })
        }

        // Surface the persisted record immediately (optimistic prepend).
        setCommunications((prev) => [toCoreCommunication(created), ...prev])
        toast.success(data.scheduledFor ? 'Message scheduled' : 'Message sent')
        setComposerOpen(false)
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to send message')
        // The server's named failure reason (e.g. COMPLIANCE_BLOCK / provider
        // unconfigured) is carried on the ApiError message.
        toast.error('Failed to send message', { description: error.message })
      } finally {
        setIsSending(false)
      }
    },
    [contacts]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)] text-muted-foreground">
        <p className="text-sm">Loading communications...</p>
      </div>
    )
  }

  return (
    <>
      <UnifiedInbox
        communications={communications}
        contacts={contacts}
        onCommunicationSelect={() => {}}
        onCompose={handleCompose}
        onReply={handleReply}
      />
      <Composer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        contacts={contacts}
        templates={templates}
        defaultChannel={composerChannel}
        defaultContactId={composerContactId}
        onSend={handleSend}
        isSending={isSending}
      />
    </>
  )
}
