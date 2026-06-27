/**
 * Generative Intelligence Hub - Central integration point for all AI-powered features
 * Coordinates: LLM, Vector Search, Recursive Enrichment, Personalization, and Generative Content
 */

import LLMService, { createLLMService, defaultLLMConfig } from './integration/LLMService'
import VectorStore, { createVectorStoreWithLLM } from './integration/VectorStore'
import { RecursiveEnrichmentEngine } from './recursive/RecursiveEnrichmentEngine'
import { OutreachTemplateGenerator } from './generative/OutreachTemplateGenerator'
import { ConversationAI } from './generative/ConversationAI'
import { PersonalizationEngine } from './personalization/PersonalizationEngine'

import type { Prospect } from '@public-records/core'
import type { GenerativeConfig, OutreachTemplate, Message } from '@/types/generative'
import type {
  RecursiveEnrichmentConfig,
  EnrichmentTree,
  EnrichmentNode
} from '@/types/recursive'
import type {
  PersonalizedProspect,
  PersonalizedDashboard
} from '@/types/personalization'

/**
 * Main hub for all generative, recursive, and personalized intelligence features
 */
export class GenerativeIntelligenceHub {
  // Core services
  public llm: LLMService
  public vectorStore: VectorStore | null = null
  public recursiveEnrichment: RecursiveEnrichmentEngine
  public outreachGenerator: OutreachTemplateGenerator
  public conversation: ConversationAI
  public personalization: PersonalizationEngine

  // Configuration
  private config: GenerativeConfig
  private initialized: boolean = false

  constructor(config?: Partial<GenerativeConfig>) {
    this.config = { ...defaultLLMConfig, ...config }

    // Initialize core services
    this.llm = createLLMService(this.config)
    this.recursiveEnrichment = new RecursiveEnrichmentEngine()
    this.outreachGenerator = new OutreachTemplateGenerator(this.llm)
    this.conversation = new ConversationAI(this.llm)
    this.personalization = new PersonalizationEngine()
  }

  /**
   * Initialize all services (async initialization)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('🚀 Initializing Generative Intelligence Hub...')

    // Initialize vector store
    this.vectorStore = await createVectorStoreWithLLM(this.llm)

    // Create default indices
    await this.vectorStore.createIndex('prospects')
    await this.vectorStore.createIndex('templates')
    await this.vectorStore.createIndex('insights')
    await this.vectorStore.createIndex('companies')

    this.initialized = true
    console.log('✅ Generative Intelligence Hub initialized successfully')
  }

  /**
   * Ensure initialization before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  // ==================== PROSPECT INTELLIGENCE ====================

  /**
   * Enrich prospect with recursive multi-level discovery
   */
  async enrichProspect(
    prospectId: string,
    depth: number = 3
  ): Promise<{
    enrichmentTree: EnrichmentTree
    insights: string[]
    newDataPoints: number
  }> {
    await this.ensureInitialized()

    const config: RecursiveEnrichmentConfig = {
      maxDepth: depth,
      confidenceThreshold: 0.6,
      expansionStrategies: [
        'contact_discovery',
        'network_expansion',
        'signal_amplification',
        'relationship_mapping',
        'historical_analysis'
      ],
      learningEnabled: true,
      costLimit: 100,
      timeLimit: 60000,
      parallelization: 3
    }

    console.log(`🔍 Starting recursive enrichment for prospect ${prospectId}...`)
    const tree = await this.recursiveEnrichment.enrichProspect(prospectId, config)

    // Count new data points
    const newDataPoints = this.countNodes(tree.rootNode)

    // Generate insights from enrichment
    const insights = await this.generateEnrichmentInsights(tree)

    console.log(`✅ Enriched prospect with ${newDataPoints} new data points`)

    return {
      enrichmentTree: tree,
      insights,
      newDataPoints
    }
  }

  /**
   * Find similar prospects using semantic search
   */
  async findSimilarProspects(prospectId: string, limit: number = 10): Promise<Prospect[]> {
    await this.ensureInitialized()

    if (!this.vectorStore) throw new Error('Vector store not initialized')

    const results = await this.vectorStore.findSimilar('prospects', prospectId, limit)

    return results.map((r) => r.document.metadata as unknown as Prospect)
  }

  /**
   * Semantic search across prospects
   */
  async searchProspects(query: string, limit: number = 20): Promise<Prospect[]> {
    await this.ensureInitialized()

    if (!this.vectorStore) throw new Error('Vector store not initialized')

    const results = await this.vectorStore.search('prospects', query, limit)

    return results.map((r) => r.document.metadata as unknown as Prospect)
  }

  // ==================== PERSONALIZATION ====================

  /**
   * Get personalized prospect recommendations for user
   */
  async getPersonalizedRecommendations(
    userId: string,
    prospects: Prospect[]
  ): Promise<PersonalizedProspect[]> {
    await this.ensureInitialized()

    const personalized = await this.personalization.personalizeProspects(userId, prospects)

    // Sort by personalized score
    return personalized.sort((a, b) => b.personalizedScore - a.personalizedScore)
  }

  /**
   * Get personalized dashboard for user
   */
  async getPersonalizedDashboard(userId: string): Promise<PersonalizedDashboard> {
    await this.ensureInitialized()

    return await this.personalization.getPersonalizedDashboard(userId)
  }

  /**
   * Track user interaction for learning
   */
  async trackUserInteraction(userId: string, actionType: string, data: unknown): Promise<void> {
    await this.personalization.trackUserAction(userId, {
      actionType,
      timestamp: new Date(),
      data
    })
  }

  // ==================== GENERATIVE CONTENT ====================

  /**
   * Generate personalized outreach for prospect
   */
  async generateOutreach(prospectId: string, userId: string): Promise<OutreachTemplate> {
    await this.ensureInitialized()

    const userProfile = await this.personalization.getUserProfile(userId)

    const template = await this.outreachGenerator.generateTemplate({
      prospectId,
      channel: userProfile.preferences.preferredOutreachChannel,
      context: {
        urgency: 'medium',
        previousInteractions: [],
        userPreferences: userProfile.preferences
      },
      tonality: userProfile.preferences.templateTonality,
      lengthPreference: 'moderate',
      includeAlternatives: true
    })

    // Store in vector store for future similarity search
    if (this.vectorStore) {
      await this.vectorStore.addDocument('templates', template.templateId, template.body, {
        prospectId,
        userId,
        channel: template.channel
      })
    }

    return template
  }

  /**
   * Chat with AI assistant
   */
  async chat(sessionId: string, message: string): Promise<Message> {
    await this.ensureInitialized()

    return await this.conversation.sendMessage(sessionId, message)
  }

  /**
   * Generate insights from data
   */
  async generateInsights(data: unknown, context: string): Promise<string[]> {
    await this.ensureInitialized()

    const prompt = `Analyze this data and generate actionable insights:

Data: ${JSON.stringify(data, null, 2)}

Context: ${context}

Provide 3-5 key insights in bullet points. Focus on:
- Trends and patterns
- Opportunities and risks
- Actionable recommendations`

    const response = await this.llm.complete({
      prompt,
      systemPrompt: 'You are a business intelligence analyst generating insights.',
      temperature: 0.7,
      maxTokens: 500
    })

    return response.text
      .split('\n')
      .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('•'))
      .map((line) => line.replace(/^[-•]\s*/, '').trim())
  }

  // ==================== ANALYTICS ====================

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      llm: this.llm.getUsageStats(),
      vectorStore: this.vectorStore
        ? {
            indices: this.vectorStore.listIndices().map((indexName) => ({
              ...this.vectorStore!.getIndexStats(indexName),
              name: indexName
            }))
          }
        : null,
      initialized: this.initialized
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down'
    services: Record<string, boolean>
  }> {
    const services: Record<string, boolean> = {
      llm: true,
      vectorStore: this.vectorStore !== null,
      recursiveEnrichment: true,
      outreachGenerator: true,
      conversation: true,
      personalization: true
    }

    const allHealthy = Object.values(services).every((v) => v)

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      services
    }
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Count nodes in enrichment tree
   */
  private countNodes(node: EnrichmentNode): number {
    let count = 1
    for (const child of node.childNodes || []) {
      count += this.countNodes(child)
    }
    return count
  }

  /**
   * Generate insights from enrichment tree
   */
  private async generateEnrichmentInsights(tree: EnrichmentTree): Promise<string[]> {
    const insights: string[] = []

    // Analyze tree depth
    if (tree.maxDepth >= 3) {
      insights.push(`Deep enrichment achieved: ${tree.maxDepth} levels of data discovery`)
    }

    // Analyze cost efficiency
    const costPerNode = tree.totalCost / tree.totalNodes
    if (costPerNode < 5) {
      insights.push(`Efficient enrichment: $${costPerNode.toFixed(2)} per data point`)
    }

    // Analyze data types discovered
    insights.push(`Discovered ${tree.totalNodes} new data points across multiple dimensions`)

    return insights
  }
}

// Export singleton instance
let hubInstance: GenerativeIntelligenceHub | null = null

export const getIntelligenceHub = (
  config?: Partial<GenerativeConfig>
): GenerativeIntelligenceHub => {
  if (!hubInstance) {
    hubInstance = new GenerativeIntelligenceHub(config)
  }
  return hubInstance
}

export default GenerativeIntelligenceHub
