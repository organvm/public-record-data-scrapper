import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

async function loadConfig(env: NodeJS.ProcessEnv = {}) {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    ...env
  }
  return import('../../config')
}

describe('server config', () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  describe('parseTrustProxy', () => {
    it('parses numeric values as Express hop counts', async () => {
      const { parseTrustProxy } = await loadConfig()

      expect(parseTrustProxy('1')).toBe(1)
      expect(parseTrustProxy('2')).toBe(2)
      expect(parseTrustProxy(' 3 ')).toBe(3)
    })

    it('keeps explicit booleans and invalid values fail-safe', async () => {
      const { parseTrustProxy } = await loadConfig()

      expect(parseTrustProxy('true')).toBe(true)
      expect(parseTrustProxy('false')).toBe(false)
      expect(parseTrustProxy('0')).toBe(false)
      expect(parseTrustProxy('1abc')).toBe(false)
      expect(parseTrustProxy(undefined)).toBe(false)
    })
  })

  describe('validateConfig', () => {
    const productionEnv = {
      NODE_ENV: 'production',
      JWT_SECRET: 'example-test-jwt-secret-do-not-use',
      DATABASE_URL: 'postgresql://app_user:secret@db.example.com:5432/app',
      CORS_ORIGIN: 'https://app.example.com',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      SENDGRID_WEBHOOK_VERIFICATION_KEY: 'sendgrid-verification-key',
      PLAID_CLIENT_ID: 'plaid-client-id',
      PLAID_SECRET: 'plaid-secret',
      PLAID_ENV: 'production'
    }

    it('accepts the current Plaid ES256/JWK prerequisite without PLAID_WEBHOOK_SECRET', async () => {
      const { validateConfig } = await loadConfig(productionEnv)

      expect(() => validateConfig()).not.toThrow()
    })

    it('requires Plaid API credentials in production because webhook verification fetches JWKs', async () => {
      const { validateConfig } = await loadConfig({
        ...productionEnv,
        PLAID_CLIENT_ID: '',
        PLAID_SECRET: ''
      })

      expect(() => validateConfig()).toThrow(/PLAID_CLIENT_ID is required/)
      expect(() => validateConfig()).toThrow(/PLAID_SECRET is required/)
    })

    it('rejects an invalid PLAID_ENV value in production', async () => {
      const { validateConfig } = await loadConfig({
        ...productionEnv,
        PLAID_ENV: 'prod'
      })

      expect(() => validateConfig()).toThrow(/PLAID_ENV must be one of/)
    })
  })
})
