import type { Prospect } from '@public-records/core'

export interface DeliveryConfig {
  integration: 'zapier' | 'sfdc' | 'airtable'
  webhookUrl: string
}

export interface DeliveryResult {
  success: boolean
  providerId?: string
  error?: string
}

export class DeliveryService {
  async deliverLead(prospect: Prospect, config: DeliveryConfig): Promise<DeliveryResult> {
    if (!config.webhookUrl) {
      return { success: false, error: 'Webhook URL is required' }
    }

    try {
      let payload: unknown
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (config.integration === 'zapier') {
        payload = {
          lead_id: prospect.id,
          company_name: prospect.companyName,
          state: prospect.state,
          industry: prospect.industry,
          priority_score: prospect.priorityScore,
          status: prospect.status,
          delivered_at: new Date().toISOString()
        }
      } else if (config.integration === 'sfdc') {
        payload = {
          Company: prospect.companyName,
          State: prospect.state,
          Industry: prospect.industry,
          LeadSource: 'Public Record Data Scraper',
          Rating: prospect.priorityScore ? prospect.priorityScore.toString() : 'Hot'
        }
      } else if (config.integration === 'airtable') {
        payload = {
          records: [
            {
              fields: {
                'Company Name': prospect.companyName,
                'State': prospect.state,
                'Industry': prospect.industry,
                'Priority Score': prospect.priorityScore,
                'Status': prospect.status
              }
            }
          ]
        }
      }

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`Delivery failed with status ${response.status}`)
      }

      return {
        success: true,
        providerId: `delivered-${config.integration}-${Date.now()}`
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown delivery error'
      }
    }
  }
}
