/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// Experimental generative features - disabled strict linting for AI service integration
/**
 * Generative Outreach Template Generator
 * Creates personalized outreach templates using AI based on prospect data
 */

import type {
  OutreachTemplate,
  TemplateGenerationRequest,
  OutreachContext,
  Message,
  ABTestResult,
  TemplatePerformance
} from '@/types/generative'
import type { Prospect } from '@public-records/core'
import type LLMService from '../integration/LLMService'

export class OutreachTemplateGenerator {
  private llmService: LLMService
  private templateHistory: Map<string, OutreachTemplate[]> = new Map()
  private performanceData: Map<string, TemplatePerformance> = new Map()

  constructor(llmService: LLMService) {
    this.llmService = llmService
  }

  /**
   * Generate personalized outreach template
   */
  async generateTemplate(request: TemplateGenerationRequest): Promise<OutreachTemplate> {
    const { prospectId, channel, context, tonality, lengthPreference, includeAlternatives } =
      request

    // Build comprehensive prompt
    const prompt = this.buildTemplatePrompt(
      prospectId,
      channel,
      context,
      tonality,
      lengthPreference
    )

    // Generate using LLM
    const response = await this.llmService.complete({
      prompt,
      systemPrompt: this.getSystemPrompt(channel),
      temperature: 0.7,
      maxTokens: 1000
    })

    // Parse response
    const { subject, body, callToAction, personalizationTokens } = this.parseTemplateResponse(
      response.text,
      channel
    )

    const template: OutreachTemplate = {
      templateId: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      prospectId,
      channel,
      subject,
      body,
      callToAction,
      personalizationTokens,
      tonality: tonality || 'professional',
      lengthPreference: lengthPreference || 'moderate',
      generatedAt: new Date(),
      generationModel: 'gpt-4-turbo'
    }

    // Store in history
    const history = this.templateHistory.get(prospectId) || []
    history.push(template)
    this.templateHistory.set(prospectId, history)

    // Generate alternatives if requested
    if (includeAlternatives) {
      // Store this as variant 'A'
      template.variantId = 'A'

      // Generate B and C variants with different tonalities
      const variantB = await this.generateTemplate({
        ...request,
        tonality: this.getAlternativeTonality(tonality || 'professional'),
        includeAlternatives: false
      })
      variantB.variantId = 'B'

      const variantC = await this.generateTemplate({
        ...request,
        lengthPreference: this.getAlternativeLength(lengthPreference || 'moderate'),
        includeAlternatives: false
      })
      variantC.variantId = 'C'
    }

    return template
  }

  /**
   * Generate follow-up message based on previous conversation
   */
  async generateFollowUp(previousMessages: Message[], outcome: string): Promise<OutreachTemplate> {
    const conversationContext = previousMessages
      .map((msg) => `${msg.role === 'user' ? 'Them' : 'You'}: ${msg.content}`)
      .join('\n\n')

    const prompt = `Based on this conversation:

${conversationContext}

The outcome was: ${outcome}

Generate an appropriate follow-up message that:
1. Acknowledges the previous conversation
2. Addresses the outcome
3. Moves the conversation forward productively
4. Maintains professional but warm tone

Format the response as:
SUBJECT: [subject line]
BODY: [message body]
CTA: [call to action]`

    const response = await this.llmService.complete({
      prompt,
      systemPrompt: 'You are an expert sales professional creating follow-up communications.',
      temperature: 0.7,
      maxTokens: 800
    })

    const { subject, body, callToAction, personalizationTokens } = this.parseTemplateResponse(
      response.text,
      'email'
    )

    return {
      templateId: `followup_${Date.now()}`,
      prospectId: 'unknown', // Will be set by caller
      channel: 'email',
      subject,
      body,
      callToAction,
      personalizationTokens,
      tonality: 'professional',
      lengthPreference: 'moderate',
      generatedAt: new Date(),
      generationModel: 'gpt-4-turbo'
    }
  }

  /**
   * Generate objection handler
   */
  async generateObjectionHandler(objection: string, _prospectId: string): Promise<string> {
    const prompt = `A prospect raised this objection: "${objection}"

Generate a thoughtful, empathetic response that:
1. Acknowledges their concern
2. Provides a compelling counter-argument with specific value
3. Offers proof or examples
4. Ends with a soft close

Keep it concise (2-3 short paragraphs) and conversational.`

    const response = await this.llmService.complete({
      prompt,
      systemPrompt:
        'You are an expert sales professional skilled at handling objections with empathy and value-focused responses.',
      temperature: 0.7,
      maxTokens: 500
    })

    return response.text
  }

  /**
   * Optimize template based on feedback
   */
  async optimizeTemplate(template: OutreachTemplate, feedback: string): Promise<OutreachTemplate> {
    const prompt = `Here's an outreach ${template.channel} template:

SUBJECT: ${template.subject || 'N/A'}
BODY: ${template.body}
CTA: ${template.callToAction}

Feedback: ${feedback}

Rewrite the template incorporating the feedback while maintaining the core message and improving effectiveness.

Format the response as:
SUBJECT: [improved subject]
BODY: [improved body]
CTA: [improved call to action]`

    const response = await this.llmService.complete({
      prompt,
      systemPrompt: 'You are an expert copywriter optimizing sales communications.',
      temperature: 0.7,
      maxTokens: 1000
    })

    const {
      subject,
      body,
      callToAction,
      personalizationTokens: _unused
    } = this.parseTemplateResponse(response.text, template.channel)

    return {
      ...template,
      templateId: `optimized_${template.templateId}`,
      subject,
      body,
      callToAction,
      generatedAt: new Date()
    }
  }

  /**
   * A/B test templates
   */
  async abTestTemplates(templates: OutreachTemplate[]): Promise<ABTestResult> {
    const testId = `abtest_${Date.now()}`
    const results: Record<string, TemplatePerformance> = {}

    for (const template of templates) {
      const performance = this.performanceData.get(template.templateId)
      if (!performance || performance.totalSent === 0) {
        throw new Error(
          `A/B testing requires recorded performance for template ${template.templateId}`
        )
      }

      results[template.templateId] = performance
    }

    // Find winner
    const winner = templates.reduce((best, current) => {
      const currentScore =
        results[current.templateId].responseRate * 0.4 +
        results[current.templateId].conversionRate * 0.6
      const bestScore =
        results[best.templateId].responseRate * 0.4 + results[best.templateId].conversionRate * 0.6
      return currentScore > bestScore ? current : best
    })

    const totalObservations = Object.values(results).reduce((sum, item) => sum + item.totalSent, 0)
    const statisticalSignificance = Math.min(totalObservations / 500, 0.99)

    return {
      testId,
      variants: templates,
      winningVariant: winner.templateId,
      results,
      statisticalSignificance,
      recommendation: `Use variant ${winner.variantId || winner.templateId} - it shows ${(
        results[winner.templateId].conversionRate * 100
      ).toFixed(1)}% conversion rate with ${statisticalSignificance * 100}% confidence.`
    }
  }

  /**
   * Get template performance metrics
   */
  getTemplatePerformance(templateId: string): TemplatePerformance | undefined {
    return this.performanceData.get(templateId)
  }

  /**
   * Record template performance
   */
  recordPerformance(templateId: string, performance: Partial<TemplatePerformance>): void {
    const existing = this.performanceData.get(templateId) || {
      responseRate: 0,
      conversionRate: 0,
      averageResponseTime: 0,
      sentimentScore: 0,
      totalSent: 0,
      totalResponses: 0,
      totalConversions: 0
    }

    this.performanceData.set(templateId, { ...existing, ...performance })
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Build template generation prompt
   */
  private buildTemplatePrompt(
    prospectId: string,
    channel: string,
    context: OutreachContext,
    tonality?: string,
    lengthPreference?: string
  ): string {
    const prospectData = this.getProspectData(prospectId)

    const prompt = `Generate a ${channel} outreach template for this prospect:

Company: ${prospectData.companyName}
Industry: ${prospectData.industry}
Location: ${prospectData.state}
Health Grade: ${prospectData.healthScore?.grade || 'N/A'}
Revenue Estimate: $${prospectData.estimatedRevenue?.toLocaleString()}

Growth Signals:
${prospectData.growthSignals?.map((s: any) => `- ${s.type}: ${s.description}`).join('\n') || '- None'}

Context:
- Urgency: ${context.urgency}
- ${context.specificGoal ? `Goal: ${context.specificGoal}` : ''}
- ${context.competitiveSituation ? `Competitive situation: ${context.competitiveSituation}` : ''}

Previous interactions: ${context.previousInteractions?.length || 0}

Requirements:
- Tonality: ${tonality || 'professional'}
- Length: ${lengthPreference || 'moderate'}
- Personalize based on growth signals and company data
- Focus on value proposition specific to their situation
- Include clear call to action

Format the response as:
${channel === 'email' ? 'SUBJECT: [compelling subject line]\n' : ''}BODY: [personalized message body]
CTA: [clear call to action]
TOKENS: [list personalization tokens used, e.g., {companyName}, {industry}]`

    return prompt
  }

  /**
   * Get system prompt for channel
   */
  private getSystemPrompt(channel: string): string {
    const basePrompt =
      'You are an expert sales copywriter creating high-converting outreach communications.'

    const channelPrompts: Record<string, string> = {
      email: `${basePrompt} You specialize in email that gets opened and responded to. Use compelling subject lines and concise, value-focused body copy.`,
      sms: `${basePrompt} You specialize in SMS that respects character limits (160 chars) while being compelling and personal.`,
      phone_script: `${basePrompt} You specialize in phone scripts that sound natural, build rapport quickly, and handle objections smoothly.`,
      linkedin: `${basePrompt} You specialize in LinkedIn InMail that cuts through noise with authentic, value-driven messaging.`,
      direct_mail: `${basePrompt} You specialize in direct mail that combines traditional copywriting with modern personalization.`
    }

    return channelPrompts[channel] || basePrompt
  }

  /**
   * Parse LLM response into template components
   */
  private parseTemplateResponse(
    text: string,
    _channel: string
  ): {
    subject?: string
    body: string
    callToAction: string
    personalizationTokens: Record<string, string>
  } {
    const lines = text.split('\n')

    let subject: string | undefined
    let body: string = ''
    let callToAction: string = ''
    let tokens: string[] = []

    let currentSection: 'subject' | 'body' | 'cta' | 'tokens' | null = null

    for (const line of lines) {
      if (line.startsWith('SUBJECT:')) {
        currentSection = 'subject'
        subject = line.replace('SUBJECT:', '').trim()
      } else if (line.startsWith('BODY:')) {
        currentSection = 'body'
        body = line.replace('BODY:', '').trim()
      } else if (line.startsWith('CTA:')) {
        currentSection = 'cta'
        callToAction = line.replace('CTA:', '').trim()
      } else if (line.startsWith('TOKENS:')) {
        currentSection = 'tokens'
        const tokenStr = line.replace('TOKENS:', '').trim()
        tokens = tokenStr.split(',').map((t) => t.trim())
      } else if (line.trim() && currentSection) {
        if (currentSection === 'body') {
          body += '\n' + line
        } else if (currentSection === 'cta') {
          callToAction += ' ' + line
        }
      }
    }

    // Extract personalization tokens
    const personalizationTokens: Record<string, string> = {}
    tokens.forEach((token) => {
      const match = token.match(/\{(\w+)\}/)
      if (match) {
        personalizationTokens[match[1]] = `{${match[1]}}`
      }
    })

    return {
      subject,
      body: body.trim(),
      callToAction: callToAction.trim(),
      personalizationTokens
    }
  }

  /**
   * Get prospect data.
   */
  private getProspectData(prospectId: string): Partial<Prospect> {
    throw new Error(
      `OutreachTemplateGenerator is not wired to a prospect repository for ${prospectId}`
    )
  }

  /**
   * Get alternative tonality for A/B testing
   */
  private getAlternativeTonality(
    current: string
  ): 'professional' | 'casual' | 'urgent' | 'consultative' {
    const alternatives: Record<string, ('professional' | 'casual' | 'urgent' | 'consultative')[]> =
      {
        professional: ['consultative', 'casual'],
        casual: ['professional', 'consultative'],
        urgent: ['professional', 'consultative'],
        consultative: ['professional', 'casual']
      }

    const options = alternatives[current] || ['professional']
    return options[Math.floor(Math.random() * options.length)]
  }

  /**
   * Get alternative length for A/B testing
   */
  private getAlternativeLength(current: string): 'brief' | 'moderate' | 'detailed' {
    const alternatives: Record<string, ('brief' | 'moderate' | 'detailed')[]> = {
      brief: ['moderate'],
      moderate: ['brief', 'detailed'],
      detailed: ['moderate']
    }

    const options = alternatives[current] || ['moderate']
    return options[Math.floor(Math.random() * options.length)]
  }
}

export default OutreachTemplateGenerator
