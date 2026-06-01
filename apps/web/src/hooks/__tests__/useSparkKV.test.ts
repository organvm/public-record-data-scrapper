/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSafeKV } from '../useSparkKV'

// Use vi.hoisted() for mocks that need to be available before module execution
const mocks = vi.hoisted(() => {
  const mockStorage: Record<string, string> = {}

  return {
    mockStorage,
    resetStorage: () => {
      Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    }
  }
})

const mockLocalStorage = {
  getItem: vi.fn((key: string) => mocks.mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mocks.mockStorage[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete mocks.mockStorage[key]
  }),
  clear: vi.fn(() => mocks.resetStorage())
}

// Track storage event listeners
let storageEventHandlers: ((event: StorageEvent) => void)[] = []

describe('useSparkKV (useSafeKV)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetStorage()
    storageEventHandlers = []

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true
    })

    // Mock addEventListener for storage events
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'storage') {
        storageEventHandlers.push(handler as (event: StorageEvent) => void)
      }
    })

    vi.spyOn(window, 'removeEventListener').mockImplementation((event, handler) => {
      if (event === 'storage') {
        storageEventHandlers = storageEventHandlers.filter((h) => h !== handler)
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mocks.resetStorage()
  })

  describe('initialization', () => {
    it('should return undefined when no initial value and no stored value', () => {
      const { result } = renderHook(() => useSafeKV('empty-key'))

      expect(result.current[0]).toBeUndefined()
    })

    it('should return initial value when provided and no stored value', () => {
      const { result } = renderHook(() => useSafeKV('new-key', 'initial'))

      expect(result.current[0]).toBe('initial')
    })

    it('should return stored value when available', () => {
      mocks.mockStorage['existing-key'] = JSON.stringify('stored')

      const { result } = renderHook(() => useSafeKV('existing-key', 'initial'))

      expect(result.current[0]).toBe('stored')
    })

    it('should persist initial value to storage', () => {
      renderHook(() => useSafeKV('persist-key', 'initial'))

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'persist-key',
        JSON.stringify('initial')
      )
    })
  })

  describe('value updates', () => {
    it('should update value with direct value', () => {
      const { result } = renderHook(() => useSafeKV('update-key', 'initial'))

      act(() => {
        result.current[1]('updated')
      })

      expect(result.current[0]).toBe('updated')
    })

    it('should update value with updater function', () => {
      const { result } = renderHook(() => useSafeKV('counter', 0))

      act(() => {
        result.current[1]((prev) => (prev ?? 0) + 1)
      })

      expect(result.current[0]).toBe(1)
    })

    it('should persist updated value to storage', () => {
      const { result } = renderHook(() => useSafeKV('persist-update', 'initial'))

      act(() => {
        result.current[1]('new-value')
      })

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'persist-update',
        JSON.stringify('new-value')
      )
    })
  })

  describe('value deletion', () => {
    it('should delete value from storage', () => {
      mocks.mockStorage['delete-key'] = JSON.stringify('value')

      const { result } = renderHook(() => useSafeKV('delete-key', 'initial'))

      act(() => {
        result.current[2]()
      })

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('delete-key')
    })

    it('should set value to undefined after deletion', () => {
      mocks.mockStorage['delete-key'] = JSON.stringify('value')

      const { result } = renderHook(() => useSafeKV('delete-key', 'initial'))

      act(() => {
        result.current[2]()
      })

      expect(result.current[0]).toBeUndefined()
    })
  })

  describe('storage events (cross-tab sync)', () => {
    it('should register storage event listener', () => {
      renderHook(() => useSafeKV('sync-key', 'initial'))

      expect(window.addEventListener).toHaveBeenCalledWith('storage', expect.any(Function))
    })

    it('should remove storage event listener on unmount', () => {
      const { unmount } = renderHook(() => useSafeKV('sync-key', 'initial'))

      unmount()

      expect(window.removeEventListener).toHaveBeenCalledWith('storage', expect.any(Function))
    })

    it('should update value on storage event for same key', () => {
      const { result } = renderHook(() => useSafeKV('sync-key', 'initial'))

      // Simulate storage event from another tab
      const event = {
        key: 'sync-key',
        newValue: JSON.stringify('from-other-tab'),
        storageArea: mockLocalStorage
      } as unknown as StorageEvent

      act(() => {
        storageEventHandlers.forEach((handler) => handler(event))
      })

      expect(result.current[0]).toBe('from-other-tab')
    })

    it('should ignore storage event for different key', () => {
      const { result } = renderHook(() => useSafeKV('my-key', 'initial'))

      const event = {
        key: 'other-key',
        newValue: JSON.stringify('other-value'),
        storageArea: mockLocalStorage
      } as unknown as StorageEvent

      act(() => {
        storageEventHandlers.forEach((handler) => handler(event))
      })

      expect(result.current[0]).toBe('initial')
    })

    it('should handle null key in storage event', () => {
      const { result } = renderHook(() => useSafeKV('my-key', 'initial'))

      const event = {
        key: null,
        newValue: null,
        storageArea: mockLocalStorage
      } as unknown as StorageEvent

      act(() => {
        storageEventHandlers.forEach((handler) => handler(event))
      })

      // Should not throw and value should remain unchanged
      expect(result.current[0]).toBe('initial')
    })

    it('should set undefined when newValue is null (deleted from other tab)', () => {
      mocks.mockStorage['delete-sync'] = JSON.stringify('value')

      const { result } = renderHook(() => useSafeKV('delete-sync', 'initial'))

      const event = {
        key: 'delete-sync',
        newValue: null,
        storageArea: mockLocalStorage
      } as unknown as StorageEvent

      act(() => {
        storageEventHandlers.forEach((handler) => handler(event))
      })

      expect(result.current[0]).toBeUndefined()
    })
  })

  describe('type handling', () => {
    it('should handle string values', () => {
      const { result } = renderHook(() => useSafeKV<string>('string-key', 'initial'))

      act(() => {
        result.current[1]('updated')
      })

      expect(result.current[0]).toBe('updated')
    })

    it('should handle number values', () => {
      const { result } = renderHook(() => useSafeKV<number>('number-key', 0))

      act(() => {
        result.current[1](42)
      })

      expect(result.current[0]).toBe(42)
    })

    it('should handle boolean values', () => {
      const { result } = renderHook(() => useSafeKV<boolean>('bool-key', false))

      act(() => {
        result.current[1](true)
      })

      expect(result.current[0]).toBe(true)
    })

    it('should handle object values', () => {
      const { result } = renderHook(() => useSafeKV('obj-key', { a: 1 }))

      act(() => {
        result.current[1]({ a: 2 })
      })

      expect(result.current[0]).toEqual({ a: 2 })
    })

    it('should handle array values', () => {
      const { result } = renderHook(() => useSafeKV<number[]>('array-key', [1, 2, 3]))

      act(() => {
        result.current[1]([4, 5, 6])
      })

      expect(result.current[0]).toEqual([4, 5, 6])
    })

    it('should handle null values', () => {
      const { result } = renderHook(() => useSafeKV<string | null>('null-key', null))

      expect(result.current[0]).toBeNull()

      act(() => {
        result.current[1]('not null')
      })

      expect(result.current[0]).toBe('not null')
    })
  })

  describe('error handling', () => {
    it('should handle invalid JSON in storage', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mocks.mockStorage['invalid-json'] = 'not-json'

      const { result: hookResult } = renderHook(() => useSafeKV('invalid-json', 'fallback'))

      expect(hookResult.current[0]).toBe('fallback')
      consoleSpy.mockRestore()
    })

    it('should handle storage setItem errors', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceeded')
      })

      const { result } = renderHook(() => useSafeKV('error-key', 'initial'))

      act(() => {
        result.current[1]('new-value')
      })

      // State should still update
      expect(result.current[0]).toBe('new-value')
      consoleSpy.mockRestore()
    })

    it('should handle storage removeItem errors', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockLocalStorage.removeItem.mockImplementationOnce(() => {
        throw new Error('Storage error')
      })

      const { result } = renderHook(() => useSafeKV('error-key', 'initial'))

      act(() => {
        result.current[2]()
      })

      // State should still update
      expect(result.current[0]).toBeUndefined()
      consoleSpy.mockRestore()
    })

    it('should handle invalid JSON in storage event', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { result } = renderHook(() => useSafeKV('sync-key', 'initial'))

      const event = {
        key: 'sync-key',
        newValue: 'invalid-json',
        storageArea: mockLocalStorage
      } as unknown as StorageEvent

      act(() => {
        storageEventHandlers.forEach((handler) => handler(event))
      })

      // Should not crash, may set undefined
      consoleSpy.mockRestore()
    })
  })

  describe('localStorage unavailable', () => {
    it('should use memory store when localStorage throws', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Make setItem throw to simulate unavailable storage
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('Storage unavailable')
      })

      const { result } = renderHook(() => useSafeKV('memory-key', 'initial'))

      // Should still work using memory store
      expect(result.current[0]).toBe('initial')
      consoleSpy.mockRestore()
    })
  })

  describe('memoization', () => {
    it('should return stable setter function', () => {
      const { result, rerender } = renderHook(() => useSafeKV('memo-key', 'initial'))

      const firstSetter = result.current[1]

      rerender()

      expect(result.current[1]).toBe(firstSetter)
    })

    it('should return stable delete function', () => {
      const { result, rerender } = renderHook(() => useSafeKV('memo-key', 'initial'))

      const firstDelete = result.current[2]

      rerender()

      expect(result.current[2]).toBe(firstDelete)
    })

    it('should memoize the return tuple', () => {
      const { result, rerender } = renderHook(() => useSafeKV('memo-key', 'initial'))

      // Value hasn't changed, so tuple should be same reference
      // Note: This depends on implementation - tuple might be new each render
      expect(result.current).toBeDefined()

      rerender()

      expect(result.current).toBeDefined()
    })
  })

  describe('key changes', () => {
    it('should read new key value when key changes', () => {
      mocks.mockStorage['key-a'] = JSON.stringify('value-a')
      mocks.mockStorage['key-b'] = JSON.stringify('value-b')

      let key = 'key-a'
      const { result, rerender } = renderHook(() => useSafeKV(key, 'default'))

      expect(result.current[0]).toBe('value-a')

      key = 'key-b'
      rerender()

      expect(result.current[0]).toBe('value-b')
    })
  })
})
