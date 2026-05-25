export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'
export type SignalType = 'hiring' | 'permit' | 'contract' | 'expansion' | 'equipment'
export type ProspectStatus = 'new' | 'claimed' | 'contacted' | 'qualified' | 'dead' | 'closed-won' | 'closed-lost' | 'unclaimed'
export type IndustryType =
  | 'restaurant'
  | 'retail'
  | 'construction'
  | 'healthcare'
  | 'manufacturing'
  | 'services'
  | 'technology'
export type DataTier = 'oss' | 'paid'

export interface UCCFiling {
  id: string
  filingDate: string
  debtorName: string
  securedParty: string
  state: string
  lienAmount?: number
  status: 'active' | 'terminated' | 'lapsed'
  filingType: 'UCC-1' | 'UCC-3'
}

export interface GrowthSignal {
  id: string
  type: SignalType
  description: string
  detectedDate: string
  sourceUrl?: string
  score: number
  confidence: number
  mlConfidence?: number // ML model confidence in signal validity (0-100)
}

export interface HealthScore {
  grade: HealthGrade
  score: number
  sentimentTrend: 'improving' | 'stable' | 'declining'
  reviewCount: number
  avgSentiment: number
  violationCount: number
  lastUpdated: string
}

export interface MLScoring {
  confidence: number // Overall ML confidence in prospect quality (0-100)
  recoveryLikelihood: number // Predicted likelihood of default recovery (0-100)
  modelVersion: string
  lastUpdated: string
  factors: {
    healthTrend: number
    signalQuality: number
    industryRisk: number
    timeToRecovery: number
    financialStability: number
  }
}

export interface Prospect {
  id: string
  companyName: string
  industry: IndustryType
  state: string
  status: ProspectStatus
  priorityScore: number
  defaultDate: string
  timeSinceDefault: number
  lastFilingDate?: string
  uccFilings: UCCFiling[]
  growthSignals: GrowthSignal[]
  healthScore: HealthScore
  narrative: string
  estimatedRevenue?: number
  claimedBy?: string
  claimedDate?: string
  mlScoring?: MLScoring // ML confidence and recovery prediction
}

export interface CompetitorData {
  lenderName: string
  filingCount: number
  avgDealSize: number
  marketShare: number
  industries: IndustryType[]
  topState: string
  monthlyTrend: number
}

export interface PortfolioCompany {
  id: string
  companyName: string
  fundingDate: string
  fundingAmount: number
  currentStatus: 'performing' | 'watch' | 'at-risk' | 'default'
  healthScore: HealthScore
  lastAlertDate?: string
}

export interface RequalificationLead {
  id?: string
  originalProspect: Prospect
  newSignals: GrowthSignal[]
  netScore: number
  recommendation: 'revive' | 'dismiss'
  reasoning: string
}

export interface DashboardStats {
  totalProspects: number
  highValueProspects: number
  avgPriorityScore: number
  newSignalsToday: number
  portfolioAtRisk: number
  avgHealthGrade: string
}

export interface ProspectNote {
  id: string
  prospectId: string
  content: string
  createdBy: string
  createdAt: string
  updatedAt?: string
}

export interface FollowUpReminder {
  id: string
  prospectId: string
  dueDate: string
  priority: 'low' | 'medium' | 'high'
  description: string
  completed: boolean
  createdBy: string
  createdAt: string
  completedAt?: string
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  category: 'initial-outreach' | 'follow-up' | 'recovery-offer' | 'check-in'
  variables: string[] // e.g., ['companyName', 'priorityScore', 'industryType']
}

export interface OutreachEmail {
  id: string
  prospectId: string
  templateId: string
  subject: string
  body: string
  status: 'draft' | 'sent' | 'scheduled'
  sentAt?: string
  scheduledFor?: string
  createdBy: string
  createdAt: string
}

// Recursive & Advanced Feature Types
export type RelationshipType =
  | 'parent'
  | 'subsidiary'
  | 'affiliate'
  | 'common_secured_party'
  | 'guarantor'
  | 'same_industry'

export interface CompanyRelationship {
  fromCompanyId: string
  toCompanyId: string
  relationshipType: RelationshipType
  confidence: number
  sourceFilingId?: string
  discoveredDate: string
  depth: number
  metadata?: Record<string, unknown>
}

export interface CompanyNode {
  id: string
  companyName: string
  prospect?: Prospect
  relationships: CompanyRelationship[]
  depth: number
  visitedAt: string
}

export interface CompanyGraph {
  rootId: string
  nodes: Map<string, CompanyNode>
  edges: CompanyRelationship[]
  maxDepth: number
  totalNodes: number
  totalEdges: number
  createdAt: string
  metadata: {
    riskConcentration: number
    networkHealth: HealthGrade
    totalExposure: number
  }
}

export interface RecursiveTraversalConfig {
  maxDepth: number
  relationshipTypes: RelationshipType[]
  includeProspectData: boolean
  stopConditions?: {
    maxNodes?: number
    maxEdges?: number
  }
}

export interface RecommendationReason {
  factor: string
  description: string
  weight: number
  evidence: string[]
}

export interface PersonalizedRecommendation {
  id: string
  userId: string
  prospectId: string
  prospect: Prospect
  score: number
  reasons: RecommendationReason[]
  matchFactors: {
    industryMatch: number
    scoreMatch: number
    signalMatch: number
    behaviorMatch: number
    networkMatch: number
  }
  generatedAt: string
  expiresAt: string
  status: 'new' | 'viewed' | 'acted' | 'dismissed'
}

export interface GenerativeContext {
  prospect: Prospect
  marketData?: CompetitorData[]
  relationships?: CompanyGraph
  historicalSignals?: GrowthSignal[]
  industryTrends?: IndustryTrend[]
}

export interface GenerativeInsight {
  // Narrative-style insight fields (used by GenerativeNarrative.keyInsights)
  category?: string
  text?: string
  sources?: string[]
  // Report-style insight fields (used by report builder / generateInsights)
  id?: string
  type?: 'opportunity' | 'risk' | 'trend' | 'recommendation' | string
  title?: string
  description?: string
  impact?: 'low' | 'medium' | 'high'
  relatedProspects?: string[]
  generatedAt?: string
  evidence?: string[]
  // Shared
  confidence: number
}

export interface GenerativeNarrativeSections {
  summary: string
  keyFindings: string[]
  opportunityAnalysis: string
  riskFactors: string[]
  recommendedActions: string[]
  marketContext: string
  competitiveLandscape: string
}

export interface GenerativeNarrative {
  prospectId: string
  summary: string
  keyInsights: GenerativeInsight[]
  riskFactors: string[]
  opportunities: string[]
  recommendedActions: string[]
  generatedAt: string
  /** Parsed structured sections (optional; populated by some generators). */
  sections?: GenerativeNarrativeSections
  /** Overall narrative confidence (optional). */
  confidence?: number
  /** Source attributions (optional). */
  sources?: string[]
}

export interface ChainedSignal {
  signal: GrowthSignal
  depth: number
  parentSignalId: string
  relationshipType: 'triggered_by' | 'correlated_with' | 'implies'
  confidence: number
}

export interface SignalChain {
  id: string
  prospectId: string
  rootSignal: GrowthSignal
  chainedSignals: ChainedSignal[]
  totalConfidence: number
  chainStrength: number
  discoveryPath: string[]
  detectedAt: string
}

export interface RecursiveSignalConfig {
  maxDepth: number
  minConfidence: number
  signalTriggers: Record<SignalType, SignalType[]>
  correlationThreshold: number
}

export interface ReportSubsection {
  title: string
  content: string
}

export interface ReportSection {
  id: string
  title: string
  content: string
  insights?: GenerativeInsight[]
  visualizations?: Visualization[]
  subsections?: ReportSubsection[]
}

export interface Visualization {
  type: 'chart' | 'graph' | 'table' | 'map'
  data: unknown
  config: Record<string, unknown>
}

export interface GenerativeReportMetadata {
  generatedAt: string
  generatedBy: string
  dataRange: { start: string; end: string }
  prospectCount: number
  sources: string[]
}

export interface GenerativeReport {
  id: string
  type: 'portfolio' | 'market' | 'prospect' | 'competitive'
  title: string
  sections: ReportSection[]
  insights: GenerativeInsight[]
  recommendations: string[]
  metadata: GenerativeReportMetadata
  format: 'markdown' | 'html' | 'pdf' | 'json'
  content: string
}

export type EnrichmentStepType =
  | 'revenue'
  | 'industry'
  | 'signals'
  | 'health'
  | 'relationships'
  | 'market'

export interface EnrichmentStep {
  id: string
  name: string
  type: EnrichmentStepType
  priority: number
  dependencies: string[]
  estimatedDuration: number
}

export interface EnrichmentPlan {
  prospectId: string
  steps: EnrichmentStep[]
  currentDepth: number
  maxDepth: number
  adaptiveStrategy: boolean
  completedSteps: string[]
  createdAt: string
}

export interface RecursiveEnrichmentResult {
  prospectId: string
  originalProspect: Prospect
  enrichedProspect: Prospect
  executedSteps: EnrichmentStep[]
  improvements: {
    dataCompleteness: number
    confidenceIncrease: number
    newFieldsAdded: string[]
  }
  totalDepth: number
  duration: number
}

export interface NetworkRecommendation {
  type: 'cluster_approach' | 'cross_sell'
  targetCompanies: string[]
  reasoning: string
  estimatedValue: number
  confidence: number
  priority: number
}

export interface NetworkRequalification {
  rootLeadId: string
  requalifiedLeads: RequalificationLead[]
  networkGraph: CompanyGraph
  totalOpportunityValue: number
  recommendations: NetworkRecommendation[]
  executionDepth: number
  completedAt: string
}

export interface ClaimPattern {
  industries: IndustryType[]
  avgScore: number
  signalTypes: SignalType[]
  outcomeRate: number
  frequency: number
}

export interface SavedFilter {
  id: string
  name: string
  filters: {
    industries?: IndustryType[]
    states?: string[]
    minScore?: number
    maxScore?: number
    statuses?: ProspectStatus[]
    signalTypes?: SignalType[]
    healthGrades?: HealthGrade[]
    [key: string]: unknown
  }
  isDefault: boolean
  createdAt: string
  usageCount: number
}

export interface DashboardWidget {
  id: string
  type: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  config: Record<string, unknown>
}

export interface DashboardLayout {
  widgets: DashboardWidget[]
  columns: number
  theme: 'light' | 'dark' | 'auto'
}

export interface NotificationSettings {
  newProspects: boolean
  healthAlerts: boolean
  signalDetection: boolean
  portfolioUpdates: boolean
  competitorActivity: boolean
  requalificationOpportunities: boolean
  aiInsights: boolean
  channels: {
    email: boolean
    inApp: boolean
    push: boolean
  }
}

export interface UserProfile {
  userId: string
  preferences: {
    industries: IndustryType[]
    states: string[]
    minPriorityScore: number
    minHealthGrade: HealthGrade
    preferredSignalTypes: SignalType[]
    riskTolerance: 'low' | 'medium' | 'high'
  }
  behavior: {
    claimPatterns: ClaimPattern[]
    conversionRate: number
    avgTimeToContact: number
    successfulIndustries: IndustryType[]
    preferredDealSize: { min: number; max: number }
  }
  customFilters: SavedFilter[]
  dashboardLayout: DashboardLayout
  notificationSettings: NotificationSettings
  createdAt: string
  lastActive: string
}

export type IndustryTrend = {
  industry: IndustryType
  direction: 'growing' | 'stable' | 'declining'
  growthRate: number
  keyDrivers: string[]
  opportunities: string[]
  threats: string[]
  data?: unknown[]
}

export type ImprovementCategory =
  | 'performance'
  | 'security'
  | 'usability'
  | 'data-quality'
  | 'feature-enhancement'
  | 'strategic'
  | 'competitor-intelligence'
  | 'competitor-analysis'
  | 'threat-analysis'
  | 'opportunity-analysis'
  | 'strategic-recommendation'

// ============================================================================
// Broker OS Types (Multi-tenancy, CRM, Deals, Communications, Compliance)
// ============================================================================

// Multi-tenancy
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise'
export type UserRole = 'admin' | 'manager' | 'broker' | 'viewer'

export interface Organization {
  id: string
  name: string
  slug: string
  settings: Record<string, unknown>
  subscriptionTier: SubscriptionTier
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  orgId: string
  email: string
  emailVerified: boolean
  firstName?: string
  lastName?: string
  phone?: string
  avatarUrl?: string
  role: UserRole
  isActive: boolean
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

// CRM / Contacts
export type ContactRole = 'owner' | 'ceo' | 'cfo' | 'controller' | 'manager' | 'bookkeeper' | 'other'
export type ContactMethod = 'email' | 'phone' | 'mobile' | 'sms'
export type ContactRelationship = 'owner' | 'decision_maker' | 'influencer' | 'employee' | 'advisor' | 'other'

export interface Contact {
  id: string
  orgId: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  phoneExt?: string
  mobile?: string
  title?: string
  role?: ContactRole
  preferredContactMethod: ContactMethod
  timezone: string
  notes?: string
  tags: string[]
  source?: string
  isActive: boolean
  lastContactedAt?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface ProspectContact {
  id: string
  prospectId: string
  contactId: string
  isPrimary: boolean
  relationship: ContactRelationship
  createdAt: string
}

export type ActivityType =
  | 'call_outbound' | 'call_inbound' | 'call_missed'
  | 'email_sent' | 'email_received' | 'email_opened' | 'email_clicked'
  | 'sms_sent' | 'sms_received'
  | 'meeting_scheduled' | 'meeting_completed' | 'meeting_cancelled'
  | 'note' | 'task_created' | 'task_completed'
  | 'status_change' | 'document_sent' | 'document_signed'

export interface ContactActivity {
  id: string
  contactId: string
  prospectId?: string
  userId?: string
  activityType: ActivityType
  subject?: string
  description?: string
  outcome?: string
  durationSeconds?: number
  metadata: Record<string, unknown>
  scheduledAt?: string
  completedAt?: string
  createdAt: string
}

// Deals
export type DealPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TerminalType = 'won' | 'lost' | 'withdrawn'

export interface DealStage {
  id: string
  orgId: string
  name: string
  slug: string
  description?: string
  stageOrder: number
  isTerminal: boolean
  terminalType?: TerminalType
  color?: string
  autoActions: Record<string, unknown>
  createdAt: string
}

export interface Lender {
  id: string
  orgId: string
  name: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  buyBox: Record<string, unknown>
  commissionRate?: number
  avgApprovalTimeHours?: number
  notes?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Deal {
  id: string
  orgId: string
  prospectId?: string
  contactId?: string
  lenderId?: string
  stageId: string
  assignedTo?: string
  dealNumber?: string
  amountRequested?: number
  amountApproved?: number
  amountFunded?: number
  termMonths?: number
  factorRate?: number
  dailyPayment?: number
  weeklyPayment?: number
  totalPayback?: number
  commissionAmount?: number
  useOfFunds?: string
  useOfFundsDetails?: string
  bankConnected: boolean
  averageDailyBalance?: number
  monthlyRevenue?: number
  nsfCount?: number
  existingPositions?: number
  priority: DealPriority
  probability?: number
  expectedCloseDate?: string
  actualCloseDate?: string
  lostReason?: string
  lostNotes?: string
  submittedAt?: string
  approvedAt?: string
  fundedAt?: string
  createdAt: string
  updatedAt: string
}

export type DocumentType =
  | 'application' | 'bank_statement' | 'tax_return' | 'voided_check'
  | 'drivers_license' | 'business_license' | 'landlord_letter'
  | 'contract' | 'signed_contract' | 'disclosure' | 'signed_disclosure'
  | 'other'

export interface DealDocument {
  id: string
  dealId: string
  documentType: DocumentType
  fileName: string
  filePath: string
  fileSize?: number
  mimeType?: string
  isRequired: boolean
  uploadedBy?: string
  uploadedAt: string
  verifiedBy?: string
  verifiedAt?: string
  metadata: Record<string, unknown>
}

// Communications
export type CommunicationChannel = 'email' | 'sms' | 'call'
export type CommunicationDirection = 'inbound' | 'outbound'
export type CommunicationStatus =
  | 'pending' | 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked'
  | 'bounced' | 'failed' | 'answered' | 'no_answer' | 'voicemail' | 'busy'

export type TemplateCategory =
  | 'initial_outreach' | 'follow_up' | 'application_request'
  | 'document_request' | 'approval_notification' | 'funding_notification'
  | 'check_in' | 'renewal' | 'other'

export interface CommunicationTemplate {
  id: string
  orgId: string
  name: string
  description?: string
  channel: CommunicationChannel | 'call_script'
  category?: TemplateCategory
  subject?: string
  body: string
  variables: string[]
  isActive: boolean
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface Communication {
  id: string
  orgId: string
  contactId?: string
  prospectId?: string
  dealId?: string
  templateId?: string
  sentBy?: string
  channel: CommunicationChannel
  direction: CommunicationDirection
  fromAddress?: string
  toAddress?: string
  ccAddresses?: string[]
  bccAddresses?: string[]
  subject?: string
  fromPhone?: string
  toPhone?: string
  body?: string
  bodyHtml?: string
  attachments: Array<{ name: string; url: string; size: number; mimeType: string }>
  status: CommunicationStatus
  statusReason?: string
  callDurationSeconds?: number
  callRecordingUrl?: string
  externalId?: string
  openedAt?: string
  clickedAt?: string
  deliveredAt?: string
  failedAt?: string
  failureReason?: string
  scheduledFor?: string
  sentAt?: string
  metadata: Record<string, unknown>
  createdAt: string
}

// Compliance
export type ConsentType =
  | 'express_written' | 'prior_express' | 'transactional'
  | 'marketing_email' | 'marketing_sms' | 'marketing_call'
  | 'data_sharing' | 'terms_of_service' | 'privacy_policy'

export type CollectionMethod =
  | 'web_form' | 'phone_recording' | 'signed_document'
  | 'email_opt_in' | 'sms_opt_in' | 'verbal' | 'imported'

export type DisclosureStatus =
  | 'draft' | 'generated' | 'sent' | 'viewed' | 'signed' | 'expired' | 'superseded'

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'
export type AlertStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'false_positive'

export interface DisclosureRequirement {
  id: string
  state: string
  regulationName: string
  effectiveDate: string
  expiryDate?: string
  requiredFields: string[]
  calculationRules: Record<string, unknown>
  templateUrl?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface Disclosure {
  id: string
  orgId: string
  dealId: string
  requirementId?: string
  state: string
  regulationName: string
  version: string
  fundingAmount: number
  totalDollarCost: number
  financeCharge?: number
  termDays?: number
  paymentFrequency?: string
  paymentAmount?: number
  numberOfPayments?: number
  aprEquivalent?: number
  disclosureData: Record<string, unknown>
  documentUrl?: string
  documentHash?: string
  signatureRequired: boolean
  signatureUrl?: string
  signatureId?: string
  signedAt?: string
  signedBy?: string
  signedIp?: string
  signatureImageUrl?: string
  status: DisclosureStatus
  sentAt?: string
  viewedAt?: string
  expiresAt?: string
  generatedBy?: string
  createdAt: string
  updatedAt: string
}

export interface ConsentRecord {
  id: string
  orgId: string
  contactId: string
  consentType: ConsentType
  channel?: CommunicationChannel | 'mail' | 'all'
  isGranted: boolean
  consentText?: string
  consentVersion?: string
  collectionMethod: CollectionMethod
  collectionUrl?: string
  recordingUrl?: string
  documentUrl?: string
  ipAddress?: string
  userAgent?: string
  evidence?: Record<string, unknown>
  grantedAt: string
  expiresAt?: string
  revokedAt?: string
  revokedReason?: string
  collectedBy?: string
  createdAt: string
}

export interface AuditLog {
  id: string
  orgId?: string
  userId?: string
  action: string
  entityType: string
  entityId?: string
  changes?: Record<string, { old: unknown; new: unknown }>
  beforeState?: Record<string, unknown>
  afterState?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
  requestId?: string
  createdAt: string
}

export interface ComplianceAlert {
  id: string
  orgId: string
  alertType: string
  severity: AlertSeverity
  dealId?: string
  contactId?: string
  communicationId?: string
  title: string
  description?: string
  remediationSteps?: string
  status: AlertStatus
  acknowledgedBy?: string
  acknowledgedAt?: string
  resolvedBy?: string
  resolvedAt?: string
  resolutionNotes?: string
  createdAt: string
  updatedAt: string
}
