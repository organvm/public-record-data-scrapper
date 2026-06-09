/**
 * Plaid Transactions API
 *
 * Fetches and processes bank transaction data for MCA underwriting.
 * Handles pagination, webhooks, and transaction categorization.
 *
 * @see https://plaid.com/docs/transactions/
 * @module server/integrations/plaid/transactions
 */

import { plaidClient, PlaidClient } from './client'

/**
 * Plaid account types
 */
export type PlaidAccountType = 'depository' | 'credit' | 'loan' | 'investment' | 'other'

/**
 * Plaid account subtypes
 */
export type PlaidAccountSubtype =
  | 'checking'
  | 'savings'
  | 'cd'
  | 'money market'
  | 'paypal'
  | 'prepaid'
  | 'credit card'
  | 'auto'
  | 'business'
  | 'commercial'
  | 'construction'
  | 'consumer'
  | 'home equity'
  | 'line of credit'
  | 'loan'
  | 'mortgage'
  | 'overdraft'
  | 'student'
  | '401a'
  | '401k'
  | '403B'
  | '457b'
  | '529'
  | 'brokerage'
  | 'cash isa'
  | 'crypto exchange'
  | 'education savings account'
  | 'fixed annuity'
  | 'gic'
  | 'health reimbursement arrangement'
  | 'hsa'
  | 'ira'
  | 'isa'
  | 'keogh'
  | 'lif'
  | 'life insurance'
  | 'lira'
  | 'lrif'
  | 'lrsp'
  | 'mutual fund'
  | 'non-custodial wallet'
  | 'non-taxable brokerage account'
  | 'other'
  | 'other annuity'
  | 'other insurance'
  | 'pension'
  | 'prif'
  | 'profit sharing plan'
  | 'qshr'
  | 'rdsp'
  | 'resp'
  | 'retirement'
  | 'rlif'
  | 'roth'
  | 'roth 401k'
  | 'rrif'
  | 'rrsp'
  | 'sarsep'
  | 'sep ira'
  | 'simple ira'
  | 'sipp'
  | 'stock plan'
  | 'tfsa'
  | 'trust'
  | 'ugma'
  | 'utma'
  | 'variable annuity'

/**
 * Bank account information from Plaid
 */
export interface PlaidAccount {
  accountId: string
  name: string
  officialName?: string
  type: PlaidAccountType
  subtype?: PlaidAccountSubtype
  mask?: string
  balances: {
    available?: number
    current?: number
    limit?: number
    isoCurrencyCode?: string
    unofficialCurrencyCode?: string
  }
}

/**
 * Transaction from Plaid
 */
export interface PlaidTransaction {
  transactionId: string
  accountId: string
  amount: number
  date: string
  datetime?: string
  name: string
  merchantName?: string
  category?: string[]
  categoryId?: string
  pendingTransactionId?: string
  pending: boolean
  paymentChannel: 'online' | 'in store' | 'other'
  transactionType?: 'place' | 'digital' | 'special' | 'unresolved'
  transactionCode?: string
  location?: {
    address?: string
    city?: string
    region?: string
    postalCode?: string
    country?: string
    lat?: number
    lon?: number
    storeNumber?: string
  }
  personalFinanceCategory?: {
    primary: string
    detailed: string
  }
  isoCurrencyCode?: string
  unofficialCurrencyCode?: string
}

/**
 * Transaction fetch request options
 */
export interface TransactionsFetchOptions {
  /** Access token for the Plaid item */
  accessToken: string
  /** Start date for transaction history (YYYY-MM-DD) */
  startDate: string
  /** End date for transaction history (YYYY-MM-DD) */
  endDate: string
  /** Account IDs to filter (optional - fetches all if not specified) */
  accountIds?: string[]
  /** Number of transactions to fetch per request */
  count?: number
  /** Offset for pagination */
  offset?: number
  /** Include personal finance categories */
  includePersonalFinanceCategory?: boolean
}

/**
 * Transactions response
 */
export interface TransactionsResponse {
  accounts: PlaidAccount[]
  transactions: PlaidTransaction[]
  totalTransactions: number
  requestId: string
}

/**
 * Transactions sync response
 */
export interface TransactionsSyncResponse {
  added: PlaidTransaction[]
  modified: PlaidTransaction[]
  removed: { transactionId: string }[]
  nextCursor: string
  hasMore: boolean
  accounts: PlaidAccount[]
  requestId: string
}

/**
 * Webhook types for transactions
 */
export type TransactionsWebhookType =
  | 'INITIAL_UPDATE'
  | 'HISTORICAL_UPDATE'
  | 'DEFAULT_UPDATE'
  | 'TRANSACTIONS_REMOVED'
  | 'SYNC_UPDATES_AVAILABLE'

/**
 * Transactions webhook payload
 */
export interface TransactionsWebhook {
  webhookType: 'TRANSACTIONS'
  webhookCode: TransactionsWebhookType
  itemId: string
  error?: {
    errorType: string
    errorCode: string
    errorMessage: string
  }
  newTransactions?: number
  removedTransactions?: string[]
  initialUpdateComplete?: boolean
  historicalUpdateComplete?: boolean
}

/**
 * Parsed transaction category for underwriting
 */
export interface ParsedTransactionCategory {
  /** Is this likely a revenue deposit */
  isRevenue: boolean
  /** Is this an expense */
  isExpense: boolean
  /** Is this a transfer (internal) */
  isTransfer: boolean
  /** Is this likely an MCA/loan payment */
  isLenderPayment: boolean
  /** Is this an NSF/overdraft fee */
  isNsfFee: boolean
  /** Primary category */
  primaryCategory: string
  /** Detailed category */
  detailedCategory?: string
  /** Confidence in category assignment (0-1) */
  confidence: number
}

/**
 * Known MCA lender names for payment detection
 */
const KNOWN_MCA_LENDERS = [
  'KAPITUS',
  'CAN CAPITAL',
  'BLUEVINE',
  'ONDECK',
  'KABBAGE',
  'SQUARE CAPITAL',
  'PAYPAL WORKING CAPITAL',
  'FUNDBOX',
  'CREDIBLY',
  'NATIONAL FUNDING',
  'RAPID FINANCE',
  'FORWARD FINANCING',
  'LIBERTAS FUNDING',
  'ALLIED FUNDING',
  'GREENBOX CAPITAL',
  'PEARL CAPITAL',
  'RELIANT FUNDING',
  'MERCHANT CASH',
  'BUSINESS FUNDING',
  'FUNDING CIRCLE'
]

/**
 * NSF/Overdraft fee indicators
 */
const NSF_INDICATORS = [
  'NSF',
  'OVERDRAFT',
  'OD FEE',
  'INSUFFICIENT FUNDS',
  'RETURNED ITEM',
  'RETURNED CHECK',
  'UNCOLLECTED FUNDS'
]

/**
 * Plaid Transactions Manager
 *
 * Handles fetching and processing transaction data from connected
 * bank accounts for MCA underwriting analysis.
 *
 * @example
 * ```typescript
 * const txManager = new PlaidTransactionsManager()
 *
 * // Fetch 24 months of transactions
 * const { transactions, accounts } = await txManager.fetchTransactions({
 *   accessToken: 'access-sandbox-xxx',
 *   startDate: '2024-01-01',
 *   endDate: '2025-12-31'
 * })
 *
 * // Parse categories for underwriting
 * const parsed = txManager.parseTransactionCategory(transaction)
 * ```
 */
export class PlaidTransactionsManager {
  private client: PlaidClient

  constructor(client?: PlaidClient) {
    this.client = client || plaidClient
  }

  /**
   * Fetch transactions for a connected account.
   *
   * Retrieves transaction history with optional pagination.
   * For large datasets, use fetchAllTransactions() instead.
   *
   * @param options - Fetch options including date range and filters
   * @returns Transactions and account information
   */
  async fetchTransactions(options: TransactionsFetchOptions): Promise<TransactionsResponse> {
    const body: Record<string, unknown> = {
      access_token: options.accessToken,
      start_date: options.startDate,
      end_date: options.endDate,
      options: {
        count: options.count || 500,
        offset: options.offset || 0,
        include_personal_finance_category: options.includePersonalFinanceCategory ?? true
      }
    }

    if (options.accountIds?.length) {
      ;(body.options as Record<string, unknown>).account_ids = options.accountIds
    }

    const response = await this.client.makeRequest<{
      accounts: Array<{
        account_id: string
        name: string
        official_name?: string
        type: PlaidAccountType
        subtype?: PlaidAccountSubtype
        mask?: string
        balances: {
          available?: number
          current?: number
          limit?: number
          iso_currency_code?: string
          unofficial_currency_code?: string
        }
      }>
      transactions: Array<{
        transaction_id: string
        account_id: string
        amount: number
        date: string
        datetime?: string
        name: string
        merchant_name?: string
        category?: string[]
        category_id?: string
        pending_transaction_id?: string
        pending: boolean
        payment_channel: 'online' | 'in store' | 'other'
        transaction_type?: 'place' | 'digital' | 'special' | 'unresolved'
        transaction_code?: string
        location?: {
          address?: string
          city?: string
          region?: string
          postal_code?: string
          country?: string
          lat?: number
          lon?: number
          store_number?: string
        }
        personal_finance_category?: {
          primary: string
          detailed: string
        }
        iso_currency_code?: string
        unofficial_currency_code?: string
      }>
      total_transactions: number
      request_id: string
    }>('/transactions/get', body)

    return {
      accounts: response.data.accounts.map(this.transformAccount),
      transactions: response.data.transactions.map(this.transformTransaction),
      totalTransactions: response.data.total_transactions,
      requestId: response.data.request_id
    }
  }

  /**
   * Fetch all transactions with automatic pagination.
   *
   * Handles pagination automatically to retrieve complete transaction
   * history for the specified date range.
   *
   * @param accessToken - Access token for the Plaid item
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @param accountIds - Optional account IDs to filter
   * @returns All transactions and account information
   */
  async fetchAllTransactions(
    accessToken: string,
    startDate: string,
    endDate: string,
    accountIds?: string[]
  ): Promise<{
    accounts: PlaidAccount[]
    transactions: PlaidTransaction[]
    totalTransactions: number
  }> {
    const allTransactions: PlaidTransaction[] = []
    let accounts: PlaidAccount[] = []
    let offset = 0
    let totalTransactions = 0
    const count = 500 // Maximum per request

    do {
      const response = await this.fetchTransactions({
        accessToken,
        startDate,
        endDate,
        accountIds,
        count,
        offset,
        includePersonalFinanceCategory: true
      })

      allTransactions.push(...response.transactions)
      accounts = response.accounts
      totalTransactions = response.totalTransactions
      offset += count
    } while (offset < totalTransactions)

    return {
      accounts,
      transactions: allTransactions,
      totalTransactions
    }
  }

  /**
   * Fetch 24 months of transaction history for underwriting.
   *
   * Convenience method that fetches the standard 24-month history
   * required for MCA underwriting analysis.
   *
   * @param accessToken - Access token for the Plaid item
   * @param accountIds - Optional account IDs to filter
   * @returns Complete transaction history
   */
  async fetch24MonthHistory(
    accessToken: string,
    accountIds?: string[]
  ): Promise<{
    accounts: PlaidAccount[]
    transactions: PlaidTransaction[]
    totalTransactions: number
  }> {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - 24)

    return this.fetchAllTransactions(
      accessToken,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
      accountIds
    )
  }

  /**
   * Sync transactions using the Transactions Sync API.
   *
   * More efficient than /transactions/get for ongoing updates.
   * Uses a cursor to track sync position.
   *
   * @param accessToken - Access token for the Plaid item
   * @param cursor - Cursor from previous sync (empty for initial sync)
   * @returns Added, modified, and removed transactions
   */
  async syncTransactions(
    accessToken: string,
    cursor: string = ''
  ): Promise<TransactionsSyncResponse> {
    const response = await this.client.makeRequest<{
      added: Array<{
        transaction_id: string
        account_id: string
        amount: number
        date: string
        datetime?: string
        name: string
        merchant_name?: string
        category?: string[]
        category_id?: string
        pending_transaction_id?: string
        pending: boolean
        payment_channel: 'online' | 'in store' | 'other'
        transaction_type?: 'place' | 'digital' | 'special' | 'unresolved'
        personal_finance_category?: {
          primary: string
          detailed: string
        }
        iso_currency_code?: string
      }>
      modified: Array<{
        transaction_id: string
        account_id: string
        amount: number
        date: string
        name: string
        pending: boolean
        payment_channel: 'online' | 'in store' | 'other'
      }>
      removed: Array<{ transaction_id: string }>
      next_cursor: string
      has_more: boolean
      accounts: Array<{
        account_id: string
        name: string
        official_name?: string
        type: PlaidAccountType
        subtype?: PlaidAccountSubtype
        mask?: string
        balances: {
          available?: number
          current?: number
          limit?: number
          iso_currency_code?: string
        }
      }>
      request_id: string
    }>('/transactions/sync', {
      access_token: accessToken,
      cursor
    })

    return {
      added: response.data.added.map(this.transformTransaction),
      modified: response.data.modified.map((t) => this.transformTransaction(t)),
      removed: response.data.removed.map((r) => ({ transactionId: r.transaction_id })),
      nextCursor: response.data.next_cursor,
      hasMore: response.data.has_more,
      accounts: response.data.accounts.map(this.transformAccount),
      requestId: response.data.request_id
    }
  }

  /**
   * Get current account balances.
   *
   * Fetches real-time balance information for connected accounts.
   *
   * @param accessToken - Access token for the Plaid item
   * @param accountIds - Optional specific account IDs
   * @returns Account balances
   */
  async getBalances(
    accessToken: string,
    accountIds?: string[]
  ): Promise<{
    accounts: PlaidAccount[]
    requestId: string
  }> {
    const body: Record<string, unknown> = {
      access_token: accessToken
    }

    if (accountIds?.length) {
      body.options = { account_ids: accountIds }
    }

    const response = await this.client.makeRequest<{
      accounts: Array<{
        account_id: string
        name: string
        official_name?: string
        type: PlaidAccountType
        subtype?: PlaidAccountSubtype
        mask?: string
        balances: {
          available?: number
          current?: number
          limit?: number
          iso_currency_code?: string
        }
      }>
      request_id: string
    }>('/accounts/balance/get', body)

    return {
      accounts: response.data.accounts.map(this.transformAccount),
      requestId: response.data.request_id
    }
  }

  /**
   * Parse transaction category for underwriting purposes.
   *
   * Analyzes a transaction to determine if it's revenue, expense,
   * transfer, lender payment, or NSF fee.
   *
   * @param transaction - The transaction to analyze
   * @returns Parsed category information
   */
  parseTransactionCategory(transaction: PlaidTransaction): ParsedTransactionCategory {
    const name = (transaction.name || '').toUpperCase()
    const merchantName = (transaction.merchantName || '').toUpperCase()
    const category = transaction.category || []
    const primaryCategory = transaction.personalFinanceCategory?.primary || category[0] || 'UNKNOWN'
    const detailedCategory = transaction.personalFinanceCategory?.detailed || category[1]

    // Check for NSF/Overdraft fees
    const isNsfFee = NSF_INDICATORS.some(
      (indicator) => name.includes(indicator) || merchantName.includes(indicator)
    )

    // Check for lender payments (MCA, loans, etc.)
    const isLenderPayment =
      !isNsfFee &&
      (KNOWN_MCA_LENDERS.some((lender) => name.includes(lender) || merchantName.includes(lender)) ||
        category.includes('Loan') ||
        category.includes('Loan Payments') ||
        primaryCategory === 'LOAN_PAYMENTS')

    // Determine if revenue (deposits - positive amounts in Plaid are outflows)
    // In Plaid, negative amounts are deposits/credits, positive are withdrawals/debits
    const isDeposit = transaction.amount < 0
    const isRevenue =
      isDeposit &&
      !isLenderPayment &&
      !this.isTransferTransaction(transaction) &&
      !category.includes('Transfer')

    // Check for transfers
    const isTransfer = this.isTransferTransaction(transaction)

    // Is expense (positive amount, not NSF, not lender payment, not transfer)
    const isExpense = transaction.amount > 0 && !isNsfFee && !isLenderPayment && !isTransfer

    // Calculate confidence based on available data
    let confidence = 0.5
    if (transaction.personalFinanceCategory) {
      confidence = 0.9
    } else if (transaction.merchantName) {
      confidence = 0.7
    } else if (category.length > 0) {
      confidence = 0.6
    }

    return {
      isRevenue,
      isExpense,
      isTransfer,
      isLenderPayment,
      isNsfFee,
      primaryCategory,
      detailedCategory,
      confidence
    }
  }

  /**
   * Check if a transaction is likely a transfer.
   */
  private isTransferTransaction(transaction: PlaidTransaction): boolean {
    const name = (transaction.name || '').toUpperCase()
    const category = transaction.category || []
    const primaryCategory = transaction.personalFinanceCategory?.primary || ''

    return (
      primaryCategory === 'TRANSFER_IN' ||
      primaryCategory === 'TRANSFER_OUT' ||
      category.includes('Transfer') ||
      name.includes('TRANSFER') ||
      name.includes('XFER') ||
      name.includes('ACH CREDIT') ||
      name.includes('ACH DEBIT')
    )
  }

  /**
   * Handle a transactions webhook.
   *
   * Process incoming webhook notifications for transaction updates.
   *
   * @param webhook - The webhook payload
   * @returns Processing result
   */
  async handleWebhook(webhook: TransactionsWebhook): Promise<{
    shouldSync: boolean
    message: string
  }> {
    switch (webhook.webhookCode) {
      case 'INITIAL_UPDATE':
        return {
          shouldSync: true,
          message: `Initial transactions available for item ${webhook.itemId}`
        }

      case 'HISTORICAL_UPDATE':
        return {
          shouldSync: true,
          message: `Historical transactions available for item ${webhook.itemId}`
        }

      case 'DEFAULT_UPDATE':
        return {
          shouldSync: true,
          message: `${webhook.newTransactions || 0} new transactions for item ${webhook.itemId}`
        }

      case 'TRANSACTIONS_REMOVED':
        return {
          shouldSync: true,
          message: `${webhook.removedTransactions?.length || 0} transactions removed for item ${webhook.itemId}`
        }

      case 'SYNC_UPDATES_AVAILABLE':
        return {
          shouldSync: true,
          message: `Sync updates available for item ${webhook.itemId}`
        }

      default:
        return {
          shouldSync: false,
          message: `Unknown webhook code: ${webhook.webhookCode}`
        }
    }
  }

  /**
   * Transform raw Plaid account to typed PlaidAccount
   */
  private transformAccount(raw: {
    account_id: string
    name: string
    official_name?: string
    type: PlaidAccountType
    subtype?: PlaidAccountSubtype
    mask?: string
    balances: {
      available?: number
      current?: number
      limit?: number
      iso_currency_code?: string
      unofficial_currency_code?: string
    }
  }): PlaidAccount {
    return {
      accountId: raw.account_id,
      name: raw.name,
      officialName: raw.official_name,
      type: raw.type,
      subtype: raw.subtype,
      mask: raw.mask,
      balances: {
        available: raw.balances.available,
        current: raw.balances.current,
        limit: raw.balances.limit,
        isoCurrencyCode: raw.balances.iso_currency_code,
        unofficialCurrencyCode: raw.balances.unofficial_currency_code
      }
    }
  }

  /**
   * Transform raw Plaid transaction to typed PlaidTransaction
   */
  private transformTransaction(raw: {
    transaction_id: string
    account_id: string
    amount: number
    date: string
    datetime?: string
    name: string
    merchant_name?: string
    category?: string[]
    category_id?: string
    pending_transaction_id?: string
    pending: boolean
    payment_channel: 'online' | 'in store' | 'other'
    transaction_type?: 'place' | 'digital' | 'special' | 'unresolved'
    transaction_code?: string
    location?: {
      address?: string
      city?: string
      region?: string
      postal_code?: string
      country?: string
      lat?: number
      lon?: number
      store_number?: string
    }
    personal_finance_category?: {
      primary: string
      detailed: string
    }
    iso_currency_code?: string
    unofficial_currency_code?: string
  }): PlaidTransaction {
    return {
      transactionId: raw.transaction_id,
      accountId: raw.account_id,
      amount: raw.amount,
      date: raw.date,
      datetime: raw.datetime,
      name: raw.name,
      merchantName: raw.merchant_name,
      category: raw.category,
      categoryId: raw.category_id,
      pendingTransactionId: raw.pending_transaction_id,
      pending: raw.pending,
      paymentChannel: raw.payment_channel,
      transactionType: raw.transaction_type,
      transactionCode: raw.transaction_code,
      location: raw.location
        ? {
            address: raw.location.address,
            city: raw.location.city,
            region: raw.location.region,
            postalCode: raw.location.postal_code,
            country: raw.location.country,
            lat: raw.location.lat,
            lon: raw.location.lon,
            storeNumber: raw.location.store_number
          }
        : undefined,
      personalFinanceCategory: raw.personal_finance_category,
      isoCurrencyCode: raw.iso_currency_code,
      unofficialCurrencyCode: raw.unofficial_currency_code
    }
  }
}

/**
 * Default Plaid transactions manager instance
 */
export const plaidTransactionsManager = new PlaidTransactionsManager()

/**
 * Create a new Plaid transactions manager with custom client
 */
export function createPlaidTransactionsManager(client: PlaidClient): PlaidTransactionsManager {
  return new PlaidTransactionsManager(client)
}
