import { beforeEach, describe, expect, it } from 'vitest'
import { authConfig, getTexasCredentials, hasTexasAuth } from './auth-config'

describe('auth-config', () => {
  beforeEach(() => {
    authConfig.clearAll()
  })

  it('stores, reports, and clears Texas credentials', () => {
    expect(hasTexasAuth()).toBe(false)

    authConfig.setCredentials('TX', {
      username: 'test-user',
      password: 'test-password',
      mfaSecret: 'totp-secret'
    })

    expect(hasTexasAuth()).toBe(true)
    expect(getTexasCredentials()).toEqual({
      username: 'test-user',
      password: 'test-password',
      mfaSecret: 'totp-secret'
    })
    expect(authConfig.getConfiguredStates()).toEqual(['TX'])

    authConfig.clearCredentials('TX')

    expect(hasTexasAuth()).toBe(false)
    expect(getTexasCredentials()).toBeUndefined()
  })

  it('does not treat partial credentials as configured', () => {
    authConfig.setCredentials('TX', {
      username: 'test-user',
      password: ''
    })
    authConfig.setCredentials('FL', {
      username: '',
      password: 'test-password'
    })

    expect(authConfig.hasCredentials('TX')).toBe(false)
    expect(authConfig.hasCredentials('FL')).toBe(false)
    expect(authConfig.getConfiguredStates()).toEqual([])
  })
})
