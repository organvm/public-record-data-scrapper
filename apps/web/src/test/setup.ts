/**
 * Test setup file for Vitest
 * Configures the testing environment with necessary globals and utilities
 */

import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

// jsdom 27 + vitest 4 no longer expose window.localStorage / sessionStorage
// when the document runs under an opaque origin (the default). Code under test
// (e.g. the agentic-engine hook) relies on the Web Storage API, so provide a
// spec-compliant in-memory implementation when the real one is unavailable.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

for (const area of ['localStorage', 'sessionStorage'] as const) {
  const existing = (() => {
    try {
      return window[area]
    } catch {
      return undefined
    }
  })()
  if (!existing || typeof existing.clear !== 'function') {
    Object.defineProperty(window, area, {
      configurable: true,
      writable: true,
      value: new MemoryStorage()
    })
  }
}

// Mock window.matchMedia for useIsMobile hook
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// Cleanup after each test case
afterEach(() => {
  cleanup()
})
