import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PlaidTransactionsManager, PlaidTransaction, TransactionsWebhook } from '../../../../server/integrations/plaid/transactions'
import { PlaidClient } from '../../../../server/integrations/plaid/client'

describe('PlaidTransactionsManager', () => {
  let mockClient: PlaidClient
  let manager: PlaidTransactionsManager

  beforeEach(() => {
    mockClient = {
      makeRequest: vi.fn()
    } as unknown as PlaidClient

    manager = new PlaidTransactionsManager(mockClient)
  })

  describe('parseTransactionCategory', () => {
    it('identifies NSF/Overdraft fees', () => {
      const tx = {
        name: 'OVERDRAFT FEE',
        amount: 35,
        category: ['Bank Fees'],
      } as PlaidTransaction

      const result = manager.parseTransactionCategory(tx)
      
      expect(result.isNsfFee).toBe(true)
      expect(result.isExpense).toBe(false) // NSF fee logic overrides standard expense
      expect(result.isRevenue).toBe(false)
      expect(result.isLenderPayment).toBe(false)
    })

    it('identifies MCA lender payments', () => {
      const tx = {
        name: 'KAPITUS PAYMENT',
        amount: 500,
        category: ['Payment'],
      } as PlaidTransaction

      const result = manager.parseTransactionCategory(tx)
      
      expect(result.isLenderPayment).toBe(true)
      expect(result.isNsfFee).toBe(false)
      expect(result.isRevenue).toBe(false)
      expect(result.isExpense).toBe(false)
    })

    it('identifies revenue deposits', () => {
      const tx = {
        name: 'STRIPE PAYOUT',
        amount: -1500.50, // Plaid uses negative for inflows
        category: ['Deposit'],
      } as PlaidTransaction

      const result = manager.parseTransactionCategory(tx)
      
      expect(result.isRevenue).toBe(true)
      expect(result.isExpense).toBe(false)
      expect(result.isTransfer).toBe(false)
    })

    it('identifies transfers', () => {
      const tx = {
        name: 'ONLINE TRANSFER TO CHK',
        amount: 200,
        personalFinanceCategory: {
          primary: 'TRANSFER_OUT',
          detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER'
        }
      } as PlaidTransaction

      const result = manager.parseTransactionCategory(tx)
      
      expect(result.isTransfer).toBe(true)
      expect(result.isRevenue).toBe(false)
      expect(result.isExpense).toBe(false)
    })

    it('identifies standard expenses', () => {
      const tx = {
        name: 'AMAZON WEB SERVICES',
        amount: 150.00,
        category: ['Service', 'Technology']
      } as PlaidTransaction

      const result = manager.parseTransactionCategory(tx)
      
      expect(result.isExpense).toBe(true)
      expect(result.isRevenue).toBe(false)
      expect(result.isLenderPayment).toBe(false)
      expect(result.isNsfFee).toBe(false)
    })
  })

  describe('handleWebhook', () => {
    it('handles DEFAULT_UPDATE correctly', async () => {
      const webhook: TransactionsWebhook = {
        webhookType: 'TRANSACTIONS',
        webhookCode: 'DEFAULT_UPDATE',
        itemId: 'item-123',
        newTransactions: 5
      }

      const result = await manager.handleWebhook(webhook)
      
      expect(result.shouldSync).toBe(true)
      expect(result.message).toContain('5 new transactions')
    })

    it('handles unknown webhook codes gracefully', async () => {
      const webhook = {
        webhookType: 'TRANSACTIONS',
        webhookCode: 'UNKNOWN_CODE',
        itemId: 'item-123'
      } as TransactionsWebhook

      const result = await manager.handleWebhook(webhook)
      
      expect(result.shouldSync).toBe(false)
      expect(result.message).toContain('Unknown webhook code: UNKNOWN_CODE')
    })
  })

  describe('fetchTransactions', () => {
    it('makes correct request to Plaid API', async () => {
      const mockResponse = {
        data: {
          accounts: [{
            account_id: 'acc-1',
            name: 'Checking',
            type: 'depository',
            subtype: 'checking',
            balances: { current: 1000 }
          }],
          transactions: [{
            transaction_id: 'tx-1',
            account_id: 'acc-1',
            amount: 50,
            date: '2024-01-01',
            name: 'Target',
            pending: false,
            payment_channel: 'in store'
          }],
          total_transactions: 1,
          request_id: 'req-1'
        }
      }

      vi.mocked(mockClient.makeRequest).mockResolvedValueOnce(mockResponse)

      const result = await manager.fetchTransactions({
        accessToken: 'access-token',
        startDate: '2024-01-01',
        endDate: '2024-01-31'
      })

      expect(mockClient.makeRequest).toHaveBeenCalledWith('/transactions/get', {
        access_token: 'access-token',
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        options: {
          count: 500,
          offset: 0,
          include_personal_finance_category: true
        }
      })

      expect(result.accounts).toHaveLength(1)
      expect(result.accounts[0].accountId).toBe('acc-1')
      expect(result.transactions).toHaveLength(1)
      expect(result.transactions[0].transactionId).toBe('tx-1')
    })
  })
})
