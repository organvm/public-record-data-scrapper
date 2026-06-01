/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock crypto.randomUUID
const mockUUID = vi.fn(() => 'mock-uuid-123')
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: mockUUID }
})

// Mock useSafeKV
const mockNotes: Array<{
  id: string
  prospectId: string
  content: string
  createdBy: string
  createdAt: string
}> = []
const mockReminders: Array<{
  id: string
  prospectId: string
  reminderDate: string
  message: string
  createdBy: string
  createdAt: string
  completed: boolean
  completedAt?: string
}> = []

const mockSetNotes = vi.fn((updater) => {
  if (typeof updater === 'function') {
    const result = updater(mockNotes)
    mockNotes.length = 0
    mockNotes.push(...result)
  }
})

const mockSetReminders = vi.fn((updater) => {
  if (typeof updater === 'function') {
    const result = updater(mockReminders)
    mockReminders.length = 0
    mockReminders.push(...result)
  }
})

vi.mock('@/hooks/useSparkKV', async () => {
  const React = await import('react')

  const useSafeKV = (key: string, defaultValue: unknown) => {
    const [value, setValue] = React.useState(() => {
      if (key === 'prospect-notes') {
        return mockNotes
      }
      if (key === 'prospect-reminders') {
        return mockReminders
      }
      return defaultValue
    })

    const setPersistedValue = React.useCallback(
      (updater: unknown) => {
        if (key === 'prospect-notes') {
          mockSetNotes(updater)
          const nextValue =
            typeof updater === 'function'
              ? (updater as (current: typeof mockNotes) => typeof mockNotes)(mockNotes)
              : updater
          const nextNotes = Array.isArray(nextValue) ? [...nextValue] : []
          mockNotes.length = 0
          mockNotes.push(...nextNotes)
          setValue(nextNotes)
          return
        }

        if (key === 'prospect-reminders') {
          mockSetReminders(updater)
          const nextValue =
            typeof updater === 'function'
              ? (updater as (current: typeof mockReminders) => typeof mockReminders)(mockReminders)
              : updater
          const nextReminders = Array.isArray(nextValue) ? [...nextValue] : []
          mockReminders.length = 0
          mockReminders.push(...nextReminders)
          setValue(nextReminders)
          return
        }

        setValue((current: unknown) =>
          typeof updater === 'function'
            ? (updater as (current: unknown) => unknown)(current)
            : updater
        )
      },
      [key, setValue]
    )

    const deleteValue = React.useCallback(() => {
      if (key === 'prospect-notes') {
        mockNotes.length = 0
        setValue([])
        return
      }
      if (key === 'prospect-reminders') {
        mockReminders.length = 0
        setValue([])
        return
      }
      setValue(undefined)
    }, [key, setValue])

    return React.useMemo(
      () => [value, setPersistedValue, deleteValue] as const,
      [value, setPersistedValue, deleteValue]
    )
  }

  return { useSafeKV, useKV: useSafeKV }
})

import { useNotesAndReminders } from '../useNotesAndReminders'

describe('useNotesAndReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNotes.length = 0
    mockReminders.length = 0
    mockUUID.mockReturnValue('mock-uuid-123')
  })

  describe('initial state', () => {
    it('should return empty notes array', () => {
      const { result } = renderHook(() => useNotesAndReminders())

      expect(result.current.notes).toEqual([])
    })

    it('should return empty reminders array', () => {
      const { result } = renderHook(() => useNotesAndReminders())

      expect(result.current.reminders).toEqual([])
    })

    it('should return all handler functions', () => {
      const { result } = renderHook(() => useNotesAndReminders())

      expect(typeof result.current.handleAddNote).toBe('function')
      expect(typeof result.current.handleDeleteNote).toBe('function')
      expect(typeof result.current.handleAddReminder).toBe('function')
      expect(typeof result.current.handleCompleteReminder).toBe('function')
      expect(typeof result.current.handleDeleteReminder).toBe('function')
      expect(typeof result.current.handleSendEmail).toBe('function')
    })
  })

  describe('handleAddNote', () => {
    it('should add a note with generated id and timestamp', () => {
      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleAddNote({
          prospectId: 'prospect-1',
          content: 'Test note content'
        })
      })

      expect(mockSetNotes).toHaveBeenCalled()
      const setterFn = mockSetNotes.mock.calls[0][0]
      const newNotes = setterFn([])

      expect(newNotes).toHaveLength(1)
      expect(newNotes[0]).toMatchObject({
        id: 'mock-uuid-123',
        prospectId: 'prospect-1',
        content: 'Test note content',
        createdBy: 'Current User'
      })
      expect(newNotes[0].createdAt).toBeDefined()
    })

    it('should append to existing notes', () => {
      const existingNotes = [
        {
          id: 'note-1',
          prospectId: 'p1',
          content: 'Existing',
          createdBy: 'User',
          createdAt: '2024-01-01'
        }
      ]

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleAddNote({
          prospectId: 'prospect-2',
          content: 'New note'
        })
      })

      const setterFn = mockSetNotes.mock.calls[0][0]
      const newNotes = setterFn(existingNotes)

      expect(newNotes).toHaveLength(2)
      expect(newNotes[0].id).toBe('note-1')
      expect(newNotes[1].prospectId).toBe('prospect-2')
    })
  })

  describe('handleDeleteNote', () => {
    it('should remove note by id', () => {
      const existingNotes = [
        {
          id: 'note-1',
          prospectId: 'p1',
          content: 'Note 1',
          createdBy: 'User',
          createdAt: '2024-01-01'
        },
        {
          id: 'note-2',
          prospectId: 'p2',
          content: 'Note 2',
          createdBy: 'User',
          createdAt: '2024-01-01'
        }
      ]

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleDeleteNote('note-1')
      })

      const setterFn = mockSetNotes.mock.calls[0][0]
      const remainingNotes = setterFn(existingNotes)

      expect(remainingNotes).toHaveLength(1)
      expect(remainingNotes[0].id).toBe('note-2')
    })

    it('should handle deletion of non-existent note', () => {
      const existingNotes = [
        {
          id: 'note-1',
          prospectId: 'p1',
          content: 'Note 1',
          createdBy: 'User',
          createdAt: '2024-01-01'
        }
      ]

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleDeleteNote('non-existent')
      })

      const setterFn = mockSetNotes.mock.calls[0][0]
      const remainingNotes = setterFn(existingNotes)

      expect(remainingNotes).toHaveLength(1)
    })

    it('should handle deletion from empty list', () => {
      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleDeleteNote('any-id')
      })

      const setterFn = mockSetNotes.mock.calls[0][0]
      const remainingNotes = setterFn([])

      expect(remainingNotes).toHaveLength(0)
    })
  })

  describe('handleAddReminder', () => {
    it('should add a reminder with generated id and defaults', () => {
      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleAddReminder({
          prospectId: 'prospect-1',
          dueDate: '2024-12-01',
          message: 'Follow up call'
        } as any)
      })

      expect(mockSetReminders).toHaveBeenCalled()
      const setterFn = mockSetReminders.mock.calls[0][0]
      const newReminders = setterFn([])

      expect(newReminders).toHaveLength(1)
      expect(newReminders[0]).toMatchObject({
        id: 'mock-uuid-123',
        prospectId: 'prospect-1',
        reminderDate: '2024-12-01',
        message: 'Follow up call',
        createdBy: 'Current User',
        completed: false
      })
    })
  })

  describe('handleCompleteReminder', () => {
    it('should toggle reminder to completed', () => {
      const existingReminders = [
        {
          id: 'reminder-1',
          prospectId: 'p1',
          reminderDate: '2024-12-01',
          message: 'Call',
          createdBy: 'User',
          createdAt: '2024-01-01',
          completed: false
        }
      ]

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleCompleteReminder('reminder-1')
      })

      const setterFn = mockSetReminders.mock.calls[0][0]
      const updatedReminders = setterFn(existingReminders)

      expect(updatedReminders[0].completed).toBe(true)
      expect(updatedReminders[0].completedAt).toBeDefined()
    })

    it('should toggle completed reminder back to incomplete', () => {
      const existingReminders = [
        {
          id: 'reminder-1',
          prospectId: 'p1',
          reminderDate: '2024-12-01',
          message: 'Call',
          createdBy: 'User',
          createdAt: '2024-01-01',
          completed: true,
          completedAt: '2024-01-15'
        }
      ]

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleCompleteReminder('reminder-1')
      })

      const setterFn = mockSetReminders.mock.calls[0][0]
      const updatedReminders = setterFn(existingReminders)

      expect(updatedReminders[0].completed).toBe(false)
      expect(updatedReminders[0].completedAt).toBeUndefined()
    })

    it('should not affect other reminders', () => {
      const existingReminders = [
        {
          id: 'reminder-1',
          prospectId: 'p1',
          reminderDate: '2024-12-01',
          message: 'Call 1',
          createdBy: 'User',
          createdAt: '2024-01-01',
          completed: false
        },
        {
          id: 'reminder-2',
          prospectId: 'p2',
          reminderDate: '2024-12-02',
          message: 'Call 2',
          createdBy: 'User',
          createdAt: '2024-01-01',
          completed: false
        }
      ]

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleCompleteReminder('reminder-1')
      })

      const setterFn = mockSetReminders.mock.calls[0][0]
      const updatedReminders = setterFn(existingReminders)

      expect(updatedReminders[0].completed).toBe(true)
      expect(updatedReminders[1].completed).toBe(false)
    })
  })

  describe('handleDeleteReminder', () => {
    it('should remove reminder by id', () => {
      const existingReminders = [
        {
          id: 'reminder-1',
          prospectId: 'p1',
          reminderDate: '2024-12-01',
          message: 'Call 1',
          createdBy: 'User',
          createdAt: '2024-01-01',
          completed: false
        },
        {
          id: 'reminder-2',
          prospectId: 'p2',
          reminderDate: '2024-12-02',
          message: 'Call 2',
          createdBy: 'User',
          createdAt: '2024-01-01',
          completed: false
        }
      ]

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleDeleteReminder('reminder-1')
      })

      const setterFn = mockSetReminders.mock.calls[0][0]
      const remainingReminders = setterFn(existingReminders)

      expect(remainingReminders).toHaveLength(1)
      expect(remainingReminders[0].id).toBe('reminder-2')
    })
  })

  describe('handleSendEmail', () => {
    it('should call trackAction with email details', async () => {
      const mockTrackAction = vi.fn().mockResolvedValue(undefined)

      const { result } = renderHook(() => useNotesAndReminders())

      act(() => {
        result.current.handleSendEmail(
          {
            prospectId: 'prospect-1',
            templateId: 'template-1',
            subject: 'Test Subject',
            body: 'Test body content'
          } as any,
          mockTrackAction
        )
      })

      expect(mockTrackAction).toHaveBeenCalledWith('send-email', {
        prospectId: 'prospect-1',
        templateId: 'template-1'
      })
    })
  })

  describe('callback stability', () => {
    it('should maintain stable callback references', () => {
      const { result, rerender } = renderHook(() => useNotesAndReminders())

      const firstHandleAddNote = result.current.handleAddNote
      const firstHandleDeleteNote = result.current.handleDeleteNote
      const firstHandleAddReminder = result.current.handleAddReminder
      const firstHandleCompleteReminder = result.current.handleCompleteReminder
      const firstHandleDeleteReminder = result.current.handleDeleteReminder
      const firstHandleSendEmail = result.current.handleSendEmail

      rerender()

      expect(result.current.handleAddNote).toBe(firstHandleAddNote)
      expect(result.current.handleDeleteNote).toBe(firstHandleDeleteNote)
      expect(result.current.handleAddReminder).toBe(firstHandleAddReminder)
      expect(result.current.handleCompleteReminder).toBe(firstHandleCompleteReminder)
      expect(result.current.handleDeleteReminder).toBe(firstHandleDeleteReminder)
      expect(result.current.handleSendEmail).toBe(firstHandleSendEmail)
    })
  })
})
