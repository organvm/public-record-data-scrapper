import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useContactActions } from '../useContactActions'
import type { Contact, ContactActivity } from '@public-records/core'

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

// Mock API functions
const mockFetchContacts = vi.fn()
const mockFetchContact = vi.fn()
const mockCreateContact = vi.fn()
const mockUpdateContact = vi.fn()
const mockLinkContactToProspect = vi.fn()
const mockUnlinkContactFromProspect = vi.fn()
const mockLogContactActivity = vi.fn()
const mockFetchContactActivities = vi.fn()
const mockFetchContactsForProspect = vi.fn()

vi.mock('@/lib/api/contacts', () => ({
  fetchContacts: (...args: unknown[]) => mockFetchContacts(...args),
  fetchContact: (...args: unknown[]) => mockFetchContact(...args),
  createContact: (...args: unknown[]) => mockCreateContact(...args),
  updateContact: (...args: unknown[]) => mockUpdateContact(...args),
  linkContactToProspect: (...args: unknown[]) => mockLinkContactToProspect(...args),
  unlinkContactFromProspect: (...args: unknown[]) => mockUnlinkContactFromProspect(...args),
  logContactActivity: (...args: unknown[]) => mockLogContactActivity(...args),
  fetchContactActivities: (...args: unknown[]) => mockFetchContactActivities(...args),
  fetchContactsForProspect: (...args: unknown[]) => mockFetchContactsForProspect(...args)
}))

import { toast } from 'sonner'

const createMockContact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 'contact-1',
  orgId: 'org-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '555-1234',
  preferredContactMethod: 'email',
  timezone: 'America/New_York',
  tags: [],
  isActive: true,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  ...overrides
})

const createMockActivity = (overrides: Partial<ContactActivity> = {}): ContactActivity => ({
  id: 'activity-1',
  contactId: 'contact-1',
  activityType: 'call_outbound',
  subject: 'Follow-up call',
  metadata: {},
  createdAt: '2024-01-15',
  ...overrides
})

describe('useContactActions', () => {
  const defaultOptions = {
    orgId: 'org-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderUseContactActions = (
    options: Partial<Parameters<typeof useContactActions>[0]> = {}
  ) => {
    return renderHook(() =>
      useContactActions({
        ...defaultOptions,
        ...options
      })
    )
  }

  describe('initial state', () => {
    it('should have isLoading as false initially', () => {
      const { result } = renderUseContactActions()
      expect(result.current.isLoading).toBe(false)
    })

    it('should have error as null initially', () => {
      const { result } = renderUseContactActions()
      expect(result.current.error).toBeNull()
    })
  })

  describe('handleFetchContacts', () => {
    it('should fetch contacts successfully', async () => {
      const mockResponse = {
        contacts: [createMockContact()],
        total: 1,
        page: 1,
        pageSize: 20
      }
      mockFetchContacts.mockResolvedValueOnce(mockResponse)

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchContacts()
      })

      expect(mockFetchContacts).toHaveBeenCalledWith({ org_id: 'org-1' })
      expect(response).toEqual(mockResponse)
      expect(result.current.isLoading).toBe(false)
    })

    it('should pass additional params', async () => {
      mockFetchContacts.mockResolvedValueOnce({ contacts: [], total: 0 })

      const { result } = renderUseContactActions()

      await act(async () => {
        await result.current.handleFetchContacts({ search: 'john', role: 'ceo' })
      })

      expect(mockFetchContacts).toHaveBeenCalledWith({
        org_id: 'org-1',
        search: 'john',
        role: 'ceo'
      })
    })

    it('should handle fetch error', async () => {
      const error = new Error('Network error')
      mockFetchContacts.mockRejectedValueOnce(error)

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchContacts()
      })

      expect(response).toBeNull()
      expect(result.current.error).toEqual(error)
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch contacts', {
        description: 'Network error'
      })
    })

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: unknown) => void
      const promise = new Promise((resolve) => {
        resolvePromise = resolve
      })
      mockFetchContacts.mockReturnValueOnce(promise)

      const { result } = renderUseContactActions()

      act(() => {
        result.current.handleFetchContacts()
      })

      expect(result.current.isLoading).toBe(true)

      await act(async () => {
        resolvePromise!({ contacts: [] })
      })

      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('handleFetchContact', () => {
    it('should fetch a single contact successfully', async () => {
      const mockContactWithActivities = {
        ...createMockContact(),
        activities: [createMockActivity()],
        first_name: 'John',
        last_name: 'Doe'
      } as Contact
      mockFetchContact.mockResolvedValueOnce(mockContactWithActivities)

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchContact('contact-1')
      })

      expect(mockFetchContact).toHaveBeenCalledWith('contact-1', 'org-1')
      expect(response).toEqual(mockContactWithActivities)
    })

    it('should handle fetch contact error', async () => {
      mockFetchContact.mockRejectedValueOnce(new Error('Contact not found'))

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchContact('unknown')
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch contact', {
        description: 'Contact not found'
      })
    })
  })

  describe('handleCreateContact', () => {
    it('should create contact successfully', async () => {
      const newContact = createMockContact({
        first_name: 'Jane',
        last_name: 'Smith'
      } as unknown as Partial<Contact>)
      mockCreateContact.mockResolvedValueOnce(newContact)

      const onContactCreated = vi.fn()
      const { result } = renderUseContactActions({ onContactCreated })

      let response
      await act(async () => {
        response = await result.current.handleCreateContact({
          first_name: 'Jane',
          last_name: 'Smith',
          email: 'jane@example.com'
        })
      })

      expect(mockCreateContact).toHaveBeenCalledWith({
        org_id: 'org-1',
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@example.com'
      })
      expect(response).toEqual(newContact)
      expect(toast.success).toHaveBeenCalledWith('Contact created', expect.any(Object))
      expect(onContactCreated).toHaveBeenCalledWith(newContact)
    })

    it('should handle create contact error', async () => {
      mockCreateContact.mockRejectedValueOnce(new Error('Validation failed'))

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleCreateContact({
          first_name: 'Jane',
          last_name: 'Smith'
        })
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to create contact', {
        description: 'Validation failed'
      })
    })

    it('should not call onContactCreated on error', async () => {
      mockCreateContact.mockRejectedValueOnce(new Error('Error'))

      const onContactCreated = vi.fn()
      const { result } = renderUseContactActions({ onContactCreated })

      await act(async () => {
        await result.current.handleCreateContact({
          first_name: 'Jane',
          last_name: 'Smith'
        })
      })

      expect(onContactCreated).not.toHaveBeenCalled()
    })
  })

  describe('handleUpdateContact', () => {
    it('should update contact successfully', async () => {
      const updatedContact = createMockContact({
        email: 'updated@example.com',
        first_name: 'John',
        last_name: 'Updated'
      } as unknown as Partial<Contact>)
      mockUpdateContact.mockResolvedValueOnce(updatedContact)

      const onContactUpdated = vi.fn()
      const { result } = renderUseContactActions({ onContactUpdated })

      let response
      await act(async () => {
        response = await result.current.handleUpdateContact('contact-1', {
          email: 'updated@example.com'
        })
      })

      expect(mockUpdateContact).toHaveBeenCalledWith('contact-1', 'org-1', {
        email: 'updated@example.com'
      })
      expect(response).toEqual(updatedContact)
      expect(toast.success).toHaveBeenCalledWith('Contact updated', expect.any(Object))
      expect(onContactUpdated).toHaveBeenCalledWith(updatedContact)
    })

    it('should handle update contact error', async () => {
      mockUpdateContact.mockRejectedValueOnce(new Error('Update failed'))

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleUpdateContact('contact-1', { email: 'test@test.com' })
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to update contact', {
        description: 'Update failed'
      })
    })
  })

  describe('handleLinkToProspect', () => {
    it('should link contact to prospect successfully', async () => {
      mockLinkContactToProspect.mockResolvedValueOnce(undefined)

      const onContactLinked = vi.fn()
      const { result } = renderUseContactActions({ onContactLinked })

      let success
      await act(async () => {
        success = await result.current.handleLinkToProspect('contact-1', 'prospect-1')
      })

      expect(mockLinkContactToProspect).toHaveBeenCalledWith('contact-1', 'prospect-1', {})
      expect(success).toBe(true)
      expect(toast.success).toHaveBeenCalledWith('Contact linked', expect.any(Object))
      expect(onContactLinked).toHaveBeenCalledWith('contact-1', 'prospect-1')
    })

    it('should pass link params', async () => {
      mockLinkContactToProspect.mockResolvedValueOnce(undefined)

      const { result } = renderUseContactActions()

      await act(async () => {
        await result.current.handleLinkToProspect('contact-1', 'prospect-1', {
          is_primary: true,
          relationship: 'owner'
        })
      })

      expect(mockLinkContactToProspect).toHaveBeenCalledWith('contact-1', 'prospect-1', {
        is_primary: true,
        relationship: 'owner'
      })
    })

    it('should handle link error', async () => {
      mockLinkContactToProspect.mockRejectedValueOnce(new Error('Link failed'))

      const { result } = renderUseContactActions()

      let success
      await act(async () => {
        success = await result.current.handleLinkToProspect('contact-1', 'prospect-1')
      })

      expect(success).toBe(false)
      expect(toast.error).toHaveBeenCalledWith('Failed to link contact', {
        description: 'Link failed'
      })
    })
  })

  describe('handleUnlinkFromProspect', () => {
    it('should unlink contact from prospect successfully', async () => {
      mockUnlinkContactFromProspect.mockResolvedValueOnce(undefined)

      const onContactUnlinked = vi.fn()
      const { result } = renderUseContactActions({ onContactUnlinked })

      let success
      await act(async () => {
        success = await result.current.handleUnlinkFromProspect('contact-1', 'prospect-1')
      })

      expect(mockUnlinkContactFromProspect).toHaveBeenCalledWith('contact-1', 'prospect-1')
      expect(success).toBe(true)
      expect(toast.info).toHaveBeenCalledWith('Contact unlinked', expect.any(Object))
      expect(onContactUnlinked).toHaveBeenCalledWith('contact-1', 'prospect-1')
    })

    it('should handle unlink error', async () => {
      mockUnlinkContactFromProspect.mockRejectedValueOnce(new Error('Unlink failed'))

      const { result } = renderUseContactActions()

      let success
      await act(async () => {
        success = await result.current.handleUnlinkFromProspect('contact-1', 'prospect-1')
      })

      expect(success).toBe(false)
      expect(toast.error).toHaveBeenCalledWith('Failed to unlink contact', {
        description: 'Unlink failed'
      })
    })
  })

  describe('handleLogActivity', () => {
    it('should log activity successfully', async () => {
      const mockActivity = createMockActivity()
      mockLogContactActivity.mockResolvedValueOnce(mockActivity)

      const onActivityLogged = vi.fn()
      const { result } = renderUseContactActions({ onActivityLogged })

      let response
      await act(async () => {
        response = await result.current.handleLogActivity('contact-1', {
          activity_type: 'call_outbound',
          subject: 'Follow-up call'
        })
      })

      expect(mockLogContactActivity).toHaveBeenCalledWith('contact-1', {
        activity_type: 'call_outbound',
        subject: 'Follow-up call'
      })
      expect(response).toEqual(mockActivity)
      expect(toast.success).toHaveBeenCalledWith('Activity logged', expect.any(Object))
      expect(onActivityLogged).toHaveBeenCalledWith(mockActivity)
    })

    it('should handle log activity error', async () => {
      mockLogContactActivity.mockRejectedValueOnce(new Error('Log failed'))

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleLogActivity('contact-1', {
          activity_type: 'call_outbound'
        })
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to log activity', {
        description: 'Log failed'
      })
    })
  })

  describe('handleFetchActivities', () => {
    it('should fetch activities successfully', async () => {
      const mockActivities = [createMockActivity(), createMockActivity({ id: 'activity-2' })]
      mockFetchContactActivities.mockResolvedValueOnce({ activities: mockActivities })

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchActivities('contact-1')
      })

      expect(mockFetchContactActivities).toHaveBeenCalledWith('contact-1', {})
      expect(response).toEqual(mockActivities)
    })

    it('should pass options to fetch activities', async () => {
      mockFetchContactActivities.mockResolvedValueOnce({ activities: [] })

      const { result } = renderUseContactActions()

      await act(async () => {
        await result.current.handleFetchActivities('contact-1', { limit: 10, before: 'cursor' })
      })

      expect(mockFetchContactActivities).toHaveBeenCalledWith('contact-1', {
        limit: 10,
        before: 'cursor'
      })
    })

    it('should handle fetch activities error', async () => {
      mockFetchContactActivities.mockRejectedValueOnce(new Error('Fetch failed'))

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchActivities('contact-1')
      })

      expect(response).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch activities', {
        description: 'Fetch failed'
      })
    })
  })

  describe('handleFetchContactsForProspect', () => {
    it('should fetch contacts for prospect successfully', async () => {
      const mockContacts = [createMockContact(), createMockContact({ id: 'contact-2' })]
      mockFetchContactsForProspect.mockResolvedValueOnce({ contacts: mockContacts })

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchContactsForProspect('prospect-1')
      })

      expect(mockFetchContactsForProspect).toHaveBeenCalledWith('prospect-1')
      expect(response).toEqual(mockContacts)
    })

    it('should handle fetch contacts for prospect error', async () => {
      mockFetchContactsForProspect.mockRejectedValueOnce(new Error('Fetch failed'))

      const { result } = renderUseContactActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchContactsForProspect('prospect-1')
      })

      expect(response).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch contacts', {
        description: 'Fetch failed'
      })
    })
  })

  describe('callback stability', () => {
    it('should maintain stable callback references when dependencies unchanged', () => {
      const { result, rerender } = renderUseContactActions()

      const firstHandleFetchContacts = result.current.handleFetchContacts
      const firstHandleCreateContact = result.current.handleCreateContact
      const firstHandleUpdateContact = result.current.handleUpdateContact
      const firstHandleLinkToProspect = result.current.handleLinkToProspect
      const firstHandleUnlinkFromProspect = result.current.handleUnlinkFromProspect
      const firstHandleLogActivity = result.current.handleLogActivity
      const firstHandleFetchActivities = result.current.handleFetchActivities
      const firstHandleFetchContactsForProspect = result.current.handleFetchContactsForProspect

      rerender()

      expect(result.current.handleFetchContacts).toBe(firstHandleFetchContacts)
      expect(result.current.handleCreateContact).toBe(firstHandleCreateContact)
      expect(result.current.handleUpdateContact).toBe(firstHandleUpdateContact)
      expect(result.current.handleLinkToProspect).toBe(firstHandleLinkToProspect)
      expect(result.current.handleUnlinkFromProspect).toBe(firstHandleUnlinkFromProspect)
      expect(result.current.handleLogActivity).toBe(firstHandleLogActivity)
      expect(result.current.handleFetchActivities).toBe(firstHandleFetchActivities)
      expect(result.current.handleFetchContactsForProspect).toBe(
        firstHandleFetchContactsForProspect
      )
    })
  })

  describe('error handling edge cases', () => {
    it('should handle non-Error exceptions', async () => {
      mockFetchContacts.mockRejectedValueOnce('String error')

      const { result } = renderUseContactActions()

      await act(async () => {
        await result.current.handleFetchContacts()
      })

      expect(result.current.error).toEqual(new Error('Failed to fetch contacts'))
    })

    it('should clear error on new request', async () => {
      mockFetchContacts.mockRejectedValueOnce(new Error('First error'))

      const { result } = renderUseContactActions()

      await act(async () => {
        await result.current.handleFetchContacts()
      })

      expect(result.current.error).not.toBeNull()

      mockFetchContacts.mockResolvedValueOnce({ contacts: [] })

      await act(async () => {
        await result.current.handleFetchContacts()
      })

      expect(result.current.error).toBeNull()
    })
  })
})
