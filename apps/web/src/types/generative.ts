/**
 * Type definitions for Generative AI features
 * Supports: Template generation, Report generation, Insight generation, Deal proposals, Conversation AI
 */

// ==================== OUTREACH TEMPLATES ====================

export type OutreachChannel = 'email' | 'sms' | 'phone_script' | 'linkedin' | 'direct_mail'
export type Tonality = 'professional' | 'casual' | 'urgent' | 'consultative'
export type LengthPreference = 'brief' | 'moderate' | 'detailed'

export interface OutreachTemplate {
  templateId: string
  prospectId: string
  channel: OutreachChannel
  subject?: string // For email
  body: string
  callToAction: string
  personalizationTokens: Record<string, string>
  tonality: Tonality
  lengthPreference: LengthPreference
  generatedAt: Date
  performanceMetrics?: TemplatePerformance
  variantId?: string // For A/B testing
  generationModel: string // e.g., 'gpt-4', 'claude-3-opus'
}

export interface TemplatePerformance {
  openRate?: number // For email
  responseRate: number
  conversionRate: number
  averageResponseTime: number // milliseconds
  sentimentScore: number // 0-1, how positively recipients responded
  totalSent: number
  totalResponses: number
  totalConversions: number
}

export interface OutreachContext {
  urgency: 'low' | 'medium' | 'high'
  previousInteractions: Message[]
  competitiveSituation?: string
  specificGoal?: string
  userPreferences: Partial<UserPreferences>
}

export interface TemplateGenerationRequest {
  prospectId: string
  channel: OutreachChannel
  context: OutreachContext
  tonality?: Tonality
  lengthPreference?: LengthPreference
  includeAlternatives?: boolean // Generate multiple variants
}

// ==================== REPORTS & INSIGHTS ====================

export type ReportType =
  | 'executive_summary'
  | 'market_analysis'
  | 'portfolio_health'
  | 'competitor_intelligence'
  | 'prospect_deep_dive'
  | 'performance_review'
  | 'trend_analysis'
  | 'risk_assessment'

export type ReportFormat = 'markdown' | 'pdf' | 'powerpoint' | 'html' | 'json'

export interface GenerativeReport {
  reportId: string
  reportType: ReportType
  title: string
  generatedFor: string // User ID
  generatedAt: Date
  format: ReportFormat
  sections: ReportSection[]
  insights: GeneratedInsight[]
  recommendations: Recommendation[]
  visualizations: Visualization[]
  executiveSummary: string
  metadata: ReportMetadata
}

export interface ReportSection {
  sectionId: string
  title: string
  content: string // Generated narrative in markdown
  dataPoints: unknown[]
  visualizations: string[] // Visualization IDs
  keyTakeaways: string[]
  order: number
}

export interface ReportMetadata {
  dataSourcesUsed: string[]
  dateRange: [Date, Date]
  confidenceScore: number // Overall report confidence
  generationTimeMs: number
  tokenUsage: number
  model: string
}

export type InsightType = 'trend' | 'anomaly' | 'opportunity' | 'risk' | 'pattern' | 'prediction'
export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical'

export interface GeneratedInsight {
  insightId: string
  type: InsightType
  title: string
  description: string
  confidence: number // 0-1
  impact: ImpactLevel
  supportingData: unknown[]
  actionable: boolean
  suggestedActions?: string[]
  relatedInsights: string[] // IDs of related insights
  detectedAt: Date
  expiresAt?: Date // Time-sensitive insights
}

export interface Recommendation {
  recommendationId: string
  type: 'prospect' | 'action' | 'strategy' | 'timing' | 'pricing' | 'resource_allocation'
  title: string
  description: string
  confidence: number // 0-1
  expectedValue: number // Estimated impact in dollars
  priority: 'low' | 'medium' | 'high' | 'urgent'
  reasoning: string[]
  data: unknown
  expiresAt?: Date
  prerequisites?: string[]
  estimatedEffort?: string // e.g., '2 hours', '1 day'
}

export type VisualizationType =
  | 'line_chart'
  | 'bar_chart'
  | 'pie_chart'
  | 'scatter_plot'
  | 'heatmap'
  | 'network_graph'
  | 'funnel'
  | 'gauge'

export interface Visualization {
  visualizationId: string
  type: VisualizationType
  title: string
  description?: string
  data: unknown
  config: Record<string, unknown> // Recharts config
  generatedSvg?: string // Pre-rendered SVG
}

// ==================== DEAL PROPOSALS ====================

export type DealStructureType =
  | 'merchant_cash_advance'
  | 'revenue_based'
  | 'term_loan'
  | 'line_of_credit'
export type PaymentFrequency = 'daily' | 'weekly' | 'monthly'
export type CompetitivePosition = 'aggressive' | 'market' | 'premium'

export interface GeneratedDealProposal {
  proposalId: string
  prospectId: string
  generatedAt: Date
  dealStructure: DealStructure
  rationale: string // AI explanation of why this structure
  alternatives: DealStructure[] // Alternative structures
  riskAssessment: RiskAssessment
  expectedOutcome: OutcomePrediction
  presentationFormat: 'term_sheet' | 'full_proposal' | 'verbal_script'
  confidence: number // 0-1, how confident the AI is in this proposal
  competitiveIntelligence?: CompetitiveIntelligence
}

export interface DealStructure {
  type: DealStructureType
  advanceAmount: number
  factorRate: number
  paybackAmount: number
  term: number // days
  paymentFrequency: PaymentFrequency
  percentageOfRevenue?: number // For revenue-based deals
  dailyPayment?: number
  weeklyPayment?: number
  monthlyPayment?: number
  collateralRequired: boolean
  personalGuarantee: boolean
  covenants: string[]
  fees: Fee[]
  pricing: PricingBreakdown
}

export interface Fee {
  name: string
  amount: number
  type: 'flat' | 'percentage'
  description: string
}

export interface PricingBreakdown {
  competitivePosition: CompetitivePosition
  profitMargin: number
  riskAdjustment: number
  volumeDiscount?: number
  rationale: string
  marketComparison: {
    lowEnd: number
    average: number
    highEnd: number
  }
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'very_high'
  riskScore: number // 0-100
  riskFactors: RiskFactor[]
  mitigationStrategies: string[]
  defaultProbability: number // 0-1
  expectedLoss: number // dollars
}

export interface RiskFactor {
  factor: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  impact: number // -100 to +100
}

export interface OutcomePrediction {
  conversionProbability: number // 0-1
  expectedCloseTime: number // days
  expectedDealSize: number // dollars
  confidenceInterval: [number, number] // min, max expected deal size
  successFactors: string[]
  obstacles: string[]
}

export interface CompetitiveIntelligence {
  knownCompetitors: string[]
  estimatedCompetitorTerms?: Partial<DealStructure>
  competitiveAdvantages: string[]
  competitiveDisadvantages: string[]
  winStrategy: string
}

// ==================== CONVERSATION AI ====================

export type MessageRole = 'user' | 'assistant' | 'system'
export type IntentType =
  | 'query'
  | 'analysis'
  | 'recommendation'
  | 'export'
  | 'action'
  | 'clarification'
  | 'feedback'

export interface Message {
  messageId: string
  role: MessageRole
  content: string
  timestamp: Date
  intent?: DetectedIntent
  entities?: ExtractedEntity[]
  actionTaken?: ActionResult
  results?: unknown
  confidence?: number
}

export interface DetectedIntent {
  primary: IntentType
  specific: string // e.g., "find_prospects", "analyze_competitor", "generate_report"
  confidence: number // 0-1
  parameters: Record<string, unknown>
}

export interface ExtractedEntity {
  type: string // e.g., 'company', 'industry', 'location', 'date_range', 'metric'
  value: string
  normalizedValue?: unknown // Parsed/normalized version
  confidence: number
}

export interface ActionResult {
  actionType: string
  status: 'success' | 'failure' | 'partial'
  result: unknown
  errorMessage?: string
  executionTimeMs: number
}

export interface ConversationContext {
  userId: string
  currentView?: string // What page/section user is on
  selectedProspects?: string[]
  recentActions: string[]
  userGoals: string[]
  sessionMetadata: Record<string, unknown>
}

export interface ConversationSession {
  sessionId: string
  userId: string
  startedAt: Date
  lastActiveAt: Date
  messages: Message[]
  context: ConversationContext
  persistent: boolean // Whether to save long-term
}

export interface AICapability {
  name: string
  description: string
  examples: string[]
  category: 'query' | 'analysis' | 'generation' | 'action'
  enabled: boolean
}

// ==================== GENERATIVE ENGINE INTERFACES ====================

export interface GenerativeOutreachEngine {
  generateTemplate(request: TemplateGenerationRequest): Promise<OutreachTemplate>

  generateFollowUp(previousMessages: Message[], outcome: string): Promise<OutreachTemplate>

  generateObjectionHandler(objection: string, prospectId: string): Promise<string>

  optimizeTemplate(template: OutreachTemplate, feedback: string): Promise<OutreachTemplate>

  abTestTemplates(templates: OutreachTemplate[]): Promise<ABTestResult>
}

export interface ABTestResult {
  testId: string
  variants: OutreachTemplate[]
  winningVariant?: string
  results: Record<string, TemplatePerformance>
  statisticalSignificance: number
  recommendation: string
}

export interface ReportGenerator {
  generateReport(
    reportType: ReportType,
    options: ReportGenerationOptions
  ): Promise<GenerativeReport>

  generateInsights(data: unknown, context: string): Promise<GeneratedInsight[]>

  generateRecommendations(insights: GeneratedInsight[], context: unknown): Promise<Recommendation[]>

  exportReport(report: GenerativeReport, format: ReportFormat): Promise<Blob | string>
}

export interface ReportGenerationOptions {
  userId: string
  dateRange?: [Date, Date]
  filters?: Record<string, unknown>
  includeVisualizations: boolean
  targetAudience: 'executive' | 'analyst' | 'sales' | 'technical'
  detailLevel: 'summary' | 'standard' | 'comprehensive'
  customSections?: string[]
}

export interface DealProposalGenerator {
  generateProposal(
    prospectId: string,
    options: ProposalGenerationOptions
  ): Promise<GeneratedDealProposal>

  generateAlternativeStructures(
    baseProposal: GeneratedDealProposal,
    count: number
  ): Promise<DealStructure[]>

  optimizePricing(
    proposal: GeneratedDealProposal,
    constraints: PricingConstraints
  ): Promise<DealStructure>

  explainProposal(proposal: GeneratedDealProposal): Promise<string>
}

export interface ProposalGenerationOptions {
  targetDealSize?: number
  riskTolerance: 'conservative' | 'moderate' | 'aggressive'
  competitivePosition: CompetitivePosition
  includeAlternatives: boolean
  customConstraints?: Record<string, unknown>
}

export interface PricingConstraints {
  minProfitMargin: number
  maxRisk: number
  targetConversionProbability: number
  competitivePressure: 'low' | 'medium' | 'high'
}

export interface ConversationAI {
  sendMessage(sessionId: string, message: string): Promise<Message>

  detectIntent(message: string): Promise<DetectedIntent>

  extractEntities(message: string): Promise<ExtractedEntity[]>

  executeAction(intent: DetectedIntent, context: ConversationContext): Promise<ActionResult>

  getSessionHistory(sessionId: string): Promise<Message[]>

  getSuggestions(context: ConversationContext): Promise<string[]> // Suggested queries

  explainResponse(messageId: string): Promise<string> // Explain reasoning
}

// ==================== SHARED TYPES ====================

export interface UserPreferences {
  // Explicit preferences
  preferredIndustries: string[]
  preferredStates: string[]
  dealSizeRange: [number, number]
  riskTolerance: 'conservative' | 'moderate' | 'aggressive'

  // Communication preferences
  preferredOutreachChannel: OutreachChannel
  communicationStyle: 'formal' | 'casual' | 'consultative'
  followUpCadence: number // days

  // Generation preferences
  preferredLLM?: 'gpt-4' | 'gpt-3.5-turbo' | 'claude-3-opus' | 'claude-3-sonnet'
  templateTonality: Tonality
  reportDetailLevel: 'summary' | 'standard' | 'comprehensive'
}

// ==================== CONFIGURATION ====================

export interface GenerativeConfig {
  llm: {
    provider: 'openai' | 'anthropic' | 'local'
    model: string
    temperature: number
    maxTokens: number
    apiKey?: string
  }

  caching: {
    enabled: boolean
    ttl: number // seconds
    maxSize: number // MB
  }

  rateLimits: {
    requestsPerMinute: number
    tokensPerDay: number
    costLimitPerDay: number // dollars
  }

  quality: {
    minConfidenceThreshold: number // 0-1
    requireHumanReview: boolean // For low-confidence generations
    enableFeedbackLoop: boolean
  }
}

export default {}
