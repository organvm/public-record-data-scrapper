/**
 * Plaid Link Token Management
 *
 * Handles Plaid Link token generation for merchant bank connection
 * and public token exchange for access tokens.
 *
 * @see https://plaid.com/docs/link/
 * @module server/integrations/plaid/link
 */

import { plaidClient, PlaidClient } from './client'

/**
 * Link token creation request parameters
 */
export interface LinkTokenCreateRequest {
  /** Unique identifier for the end user */
  clientUserId: string
  /** Display name shown in Plaid Link */
  clientName?: string
  /** Plaid products to enable */
  products?: PlaidProduct[]
  /** Country codes for supported institutions */
  countryCodes?: string[]
  /** Language for Plaid Link UI */
  language?: string
  /** Webhook URL for status updates */
  webhook?: string
  /** Redirect URI for OAuth flows */
  redirectUri?: string
  /** Account subtypes to filter */
  accountFilters?: AccountFilter[]
  /** Access token for Link update mode */
  accessToken?: string
  /** Link customization name */
  linkCustomizationName?: string
}

/**
 * Available Plaid products
 */
export type PlaidProduct =
  | 'transactions'
  | 'auth'
  | 'identity'
  | 'assets'
  | 'investments'
  | 'liabilities'
  | 'payment_initiation'
  | 'income_verification'

/**
 * Account filter configuration
 */
export interface AccountFilter {
  depository?: {
    account_subtypes: string[]
  }
  credit?: {
    account_subtypes: string[]
  }
  investment?: {
    account_subtypes: string[]
  }
  loan?: {
    account_subtypes: string[]
  }
}

/**
 * Link token response from Plaid
 */
export interface LinkTokenResponse {
  linkToken: string
  expiration: string
  requestId: string
}

/**
 * Public token exchange response
 */
export interface TokenExchangeResponse {
  accessToken: string
  itemId: string
  requestId: string
}

/**
 * Stored access token with metadata
 */
export interface PlaidAccessToken {
  accessToken: string
  itemId: string
  prospectId?: string
  dealId?: string
  institutionId?: string
  institutionName?: string
  createdAt: string
  lastSyncedAt?: string
}

/**
 * Plaid Link Token Manager
 *
 * Manages the Plaid Link flow for connecting merchant bank accounts.
 * Handles link token generation and public token exchange.
 *
 * @example
 * ```typescript
 * const linkManager = new PlaidLinkManager()
 *
 * // Generate link token for user
 * const { linkToken } = await linkManager.createLinkToken({
 *   clientUserId: 'user-123',
 *   products: ['transactions']
 * })
 *
 * // After user completes Link flow, exchange public token
 * const { accessToken, itemId } = await linkManager.exchangePublicToken(publicToken)
 * ```
 */
export class PlaidLinkManager {
  private client: PlaidClient

  constructor(client?: PlaidClient) {
    this.client = client || plaidClient
  }

  /**
   * Create a Link token for initializing Plaid Link.
   *
   * The Link token is used to initialize Plaid Link in the client-side
   * application. It includes configuration for which products to enable,
   * supported institutions, and UI customization.
   *
   * @param request - Link token creation parameters
   * @returns Link token and expiration
   */
  async createLinkToken(request: LinkTokenCreateRequest): Promise<LinkTokenResponse> {
    const body = {
      user: {
        client_user_id: request.clientUserId
      },
      client_name: request.clientName || 'MCA Platform',
      products: request.products || ['transactions'],
      country_codes: request.countryCodes || ['US'],
      language: request.language || 'en',
      ...(request.webhook && { webhook: request.webhook }),
      ...(request.redirectUri && { redirect_uri: request.redirectUri }),
      ...(request.accountFilters && { account_filters: request.accountFilters }),
      ...(request.accessToken && { access_token: request.accessToken }),
      ...(request.linkCustomizationName && {
        link_customization_name: request.linkCustomizationName
      })
    }

    const response = await this.client.makeRequest<{
      link_token: string
      expiration: string
      request_id: string
    }>('/link/token/create', body)

    return {
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
      requestId: response.data.request_id
    }
  }

  /**
   * Create a Link token specifically for bank statement analysis.
   *
   * Configures Plaid Link with transactions product and appropriate
   * account filters for MCA underwriting purposes.
   *
   * @param clientUserId - Unique identifier for the merchant
   * @param prospectId - Optional prospect ID for tracking
   * @param dealId - Optional deal ID for tracking
   * @returns Link token and expiration
   */
  async createUnderwritingLinkToken(
    clientUserId: string,
    options: {
      prospectId?: string
      dealId?: string
      webhook?: string
    } = {}
  ): Promise<LinkTokenResponse> {
    return this.createLinkToken({
      clientUserId,
      clientName: 'MCA Platform - Bank Verification',
      products: ['transactions', 'auth'],
      countryCodes: ['US'],
      language: 'en',
      webhook: options.webhook,
      // Filter to only show checking accounts (most relevant for MCA underwriting)
      accountFilters: [
        {
          depository: {
            account_subtypes: ['checking', 'savings']
          }
        }
      ]
    })
  }

  /**
   * Exchange a public token for an access token.
   *
   * After a user successfully connects their bank through Plaid Link,
   * the client receives a public token. This method exchanges that
   * public token for a permanent access token that can be used to
   * fetch transaction data.
   *
   * @param publicToken - The public token from Plaid Link
   * @returns Access token and item ID
   */
  async exchangePublicToken(publicToken: string): Promise<TokenExchangeResponse> {
    const response = await this.client.makeRequest<{
      access_token: string
      item_id: string
      request_id: string
    }>('/item/public_token/exchange', {
      public_token: publicToken
    })

    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
      requestId: response.data.request_id
    }
  }

  /**
   * Create a Link token for updating an existing connection.
   *
   * Used when a bank connection needs to be re-authenticated,
   * such as when credentials have changed or the connection has expired.
   *
   * @param accessToken - Existing access token for the item
   * @param clientUserId - User ID for the session
   * @returns Link token for update mode
   */
  async createUpdateLinkToken(
    accessToken: string,
    clientUserId: string
  ): Promise<LinkTokenResponse> {
    return this.createLinkToken({
      clientUserId,
      accessToken,
      products: ['transactions']
    })
  }

  /**
   * Get item information for an access token.
   *
   * Retrieves metadata about the connected bank item, including
   * institution information and connection status.
   *
   * @param accessToken - The access token for the item
   * @returns Item information
   */
  async getItemInfo(accessToken: string): Promise<{
    itemId: string
    institutionId?: string
    availableProducts: PlaidProduct[]
    billedProducts: PlaidProduct[]
    consentExpirationTime?: string
    error?: {
      errorType: string
      errorCode: string
      errorMessage: string
    }
  }> {
    const response = await this.client.makeRequest<{
      item: {
        item_id: string
        institution_id?: string
        available_products: PlaidProduct[]
        billed_products: PlaidProduct[]
        consent_expiration_time?: string
        error?: {
          error_type: string
          error_code: string
          error_message: string
        }
      }
      request_id: string
    }>('/item/get', {
      access_token: accessToken
    })

    const item = response.data.item
    return {
      itemId: item.item_id,
      institutionId: item.institution_id,
      availableProducts: item.available_products,
      billedProducts: item.billed_products,
      consentExpirationTime: item.consent_expiration_time,
      error: item.error
        ? {
            errorType: item.error.error_type,
            errorCode: item.error.error_code,
            errorMessage: item.error.error_message
          }
        : undefined
    }
  }

  /**
   * Remove a Plaid Item (disconnect bank account).
   *
   * Permanently removes the connection to a bank account.
   * The access token becomes invalid after this call.
   *
   * @param accessToken - The access token for the item to remove
   * @returns Success status
   */
  async removeItem(accessToken: string): Promise<{ removed: boolean; requestId: string }> {
    const response = await this.client.makeRequest<{
      removed: boolean
      request_id: string
    }>('/item/remove', {
      access_token: accessToken
    })

    return {
      removed: response.data.removed ?? true,
      requestId: response.data.request_id
    }
  }
}

/**
 * Default Plaid Link manager instance
 */
export const plaidLinkManager = new PlaidLinkManager()

/**
 * Create a new Plaid Link manager with custom client
 */
export function createPlaidLinkManager(client: PlaidClient): PlaidLinkManager {
  return new PlaidLinkManager(client)
}
