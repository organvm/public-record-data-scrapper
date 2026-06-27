import { useCallback, useEffect, useState } from 'react'
import { Contact } from '@public-records/core'
import { ContactList } from '@/components/contacts'
import { useContactActions } from '@/hooks/useContactActions'
import type { Contact as ApiContact } from '@/lib/api/contacts'

// ContactList consumes the canonical camelCase `Contact` from
// `@public-records/core`; the REST client returns snake_case rows. This mapper
// bridges the two without fabricating data.
function mapContact(row: ApiContact): Contact {
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

export function ContactsTab() {
  const [contacts, setContacts] = useState<Contact[]>([])

  // orgId is intentionally empty: the server derives the tenant from the
  // authenticated token and the client omits a blank org_id.
  const contactActions = useContactActions({ orgId: '' })
  const { handleFetchContacts } = contactActions

  const load = useCallback(async () => {
    const result = await handleFetchContacts()
    if (result) setContacts(result.contacts.map(mapContact))
  }, [handleFetchContacts])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ContactList
      contacts={contacts}
      onContactSelect={() => {}}
      onContactCreate={() => {}}
      onContactEdit={() => {}}
      onContactDelete={() => {}}
    />
  )
}
