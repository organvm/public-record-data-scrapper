/**
 * Data Validation Schemas
 *
 * Zod schemas for validating data pipeline inputs and outputs
 */

import { z } from 'zod'

// ============================================================================
// UCC Filing Schemas
// ============================================================================

export const UCCFilingSchema = z.object({
  id: z.string().min(1),
  filingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  debtorName: z.string().min(1).max(500),
  securedParty: z.string().min(1).max(500),
  state: z.string().length(2),
  lienAmount: z.number().positive().optional(),
  status: z.enum(['active', 'terminated', 'lapsed']),
  filingType: z.enum(['UCC-1', 'UCC-3'])
})

export type UCCFilingInput = z.input<typeof UCCFilingSchema>
export type UCCFilingOutput = z.output<typeof UCCFilingSchema>

// ============================================================================
// Growth Signal Schemas
// ============================================================================

export const SignalTypeSchema = z.enum(['hiring', 'permit', 'contract', 'expansion', 'equipment'])

export const GrowthSignalSchema = z.object({
  id: z.string().min(1),
  type: SignalTypeSchema,
  description: z.string().min(1).max(1000),
  detectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceUrl: z.string().url().optional(),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1)
})

export type GrowthSignalInput = z.input<typeof GrowthSignalSchema>
export type GrowthSignalOutput = z.output<typeof GrowthSignalSchema>

// ============================================================================
// Health Score Schemas
// ============================================================================

export const HealthGradeSchema = z.enum(['A', 'B', 'C', 'D', 'F'])

export const HealthScoreSchema = z.object({
  grade: HealthGradeSchema,
  score: z.number().min(0).max(100),
  sentimentTrend: z.enum(['improving', 'stable', 'declining']),
  reviewCount: z.number().int().nonnegative(),
  avgSentiment: z.number().min(0).max(1),
  violationCount: z.number().int().nonnegative(),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})

export type HealthScoreInput = z.input<typeof HealthScoreSchema>
export type HealthScoreOutput = z.output<typeof HealthScoreSchema>

// ============================================================================
// Prospect Schemas
// ============================================================================

export const IndustryTypeSchema = z.enum([
  'restaurant',
  'retail',
  'construction',
  'healthcare',
  'manufacturing',
  'services',
  'technology'
])

export const ProspectStatusSchema = z.enum(['new', 'claimed', 'contacted', 'qualified', 'dead'])

export const ProspectSchema = z.object({
  id: z.string().min(1),
  companyName: z.string().min(1).max(500),
  industry: IndustryTypeSchema,
  state: z.string().length(2),
  status: ProspectStatusSchema,
  priorityScore: z.number().min(0).max(100),
  defaultDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeSinceDefault: z.number().int().nonnegative(),
  lastFilingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  uccFilings: z.array(UCCFilingSchema).min(1),
  growthSignals: z.array(GrowthSignalSchema),
  healthScore: HealthScoreSchema,
  narrative: z.string().max(2000),
  estimatedRevenue: z.number().positive().optional(),
  claimedBy: z.string().max(200).optional(),
  claimedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
})

export type ProspectInput = z.input<typeof ProspectSchema>
export type ProspectOutput = z.output<typeof ProspectSchema>

// ============================================================================
// Data Source Configuration Schemas
// ============================================================================

export const DataSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['state-portal', 'api', 'database']),
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  rateLimit: z.number().int().positive()
})

export type DataSourceInput = z.input<typeof DataSourceSchema>
export type DataSourceOutput = z.output<typeof DataSourceSchema>

export const IngestionConfigSchema = z.object({
  sources: z.array(DataSourceSchema).min(1),
  batchSize: z.number().int().positive(),
  retryAttempts: z.number().int().min(1).max(10),
  retryDelay: z.number().int().positive(),
  states: z.array(z.string().length(2)).min(1)
})

export type IngestionConfigInput = z.input<typeof IngestionConfigSchema>
export type IngestionConfigOutput = z.output<typeof IngestionConfigSchema>

// ============================================================================
// Ingestion Result Schemas
// ============================================================================

export const IngestionResultSchema = z.object({
  success: z.boolean(),
  filings: z.array(UCCFilingSchema),
  errors: z.array(z.string()),
  metadata: z.object({
    source: z.string(),
    timestamp: z.string().datetime(),
    recordCount: z.number().int().nonnegative(),
    processingTime: z.number().nonnegative()
  })
})

export type IngestionResultInput = z.input<typeof IngestionResultSchema>
export type IngestionResultOutput = z.output<typeof IngestionResultSchema>

// ============================================================================
// Enrichment Configuration Schemas
// ============================================================================

export const EnrichmentSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['web-scraping', 'api', 'ml-inference']),
  capabilities: z
    .array(
      z.enum(['growth-signals', 'health-score', 'revenue-estimate', 'industry-classification'])
    )
    .min(1),
  endpoint: z.string().url().optional(),
  apiKey: z.string().optional()
})

export type EnrichmentSourceInput = z.input<typeof EnrichmentSourceSchema>
export type EnrichmentSourceOutput = z.output<typeof EnrichmentSourceSchema>

export const EnrichmentResultSchema = z.object({
  prospectId: z.string().min(1),
  success: z.boolean(),
  enrichedFields: z.array(z.string()),
  errors: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime()
})

export type EnrichmentResultInput = z.input<typeof EnrichmentResultSchema>
export type EnrichmentResultOutput = z.output<typeof EnrichmentResultSchema>

// ============================================================================
// Scheduler Configuration Schemas
// ============================================================================

export const ScheduleConfigSchema = z.object({
  enabled: z.boolean(),
  ingestionInterval: z.number().int().positive(),
  ingestionStates: z.array(z.string().length(2)).optional(),
  enrichmentInterval: z.number().int().positive(),
  enrichmentBatchSize: z.number().int().positive(),
  refreshInterval: z.number().int().positive(),
  staleDataThreshold: z.number().int().positive(),
  autoStart: z.boolean()
})

export type ScheduleConfigInput = z.input<typeof ScheduleConfigSchema>
export type ScheduleConfigOutput = z.output<typeof ScheduleConfigSchema>

export const SchedulerStatusSchema = z.object({
  running: z.boolean(),
  lastIngestionRun: z.string().datetime().optional(),
  lastEnrichmentRun: z.string().datetime().optional(),
  lastRefreshRun: z.string().datetime().optional(),
  nextScheduledRun: z.string().datetime().optional(),
  totalProspectsProcessed: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative()
})

export type SchedulerStatusInput = z.input<typeof SchedulerStatusSchema>
export type SchedulerStatusOutput = z.output<typeof SchedulerStatusSchema>

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Validate UCC filing data
 */
export function validateUCCFiling(data: unknown): UCCFilingOutput {
  return UCCFilingSchema.parse(data)
}

/**
 * Safely validate UCC filing data without throwing
 */
export function safeValidateUCCFiling(data: unknown): {
  success: boolean
  data?: UCCFilingOutput
  error?: z.ZodError
} {
  const result = UCCFilingSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Validate growth signal data
 */
export function validateGrowthSignal(data: unknown): GrowthSignalOutput {
  return GrowthSignalSchema.parse(data)
}

/**
 * Safely validate growth signal data
 */
export function safeValidateGrowthSignal(data: unknown): {
  success: boolean
  data?: GrowthSignalOutput
  error?: z.ZodError
} {
  const result = GrowthSignalSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Validate prospect data
 */
export function validateProspect(data: unknown): ProspectOutput {
  return ProspectSchema.parse(data)
}

/**
 * Safely validate prospect data
 */
export function safeValidateProspect(data: unknown): {
  success: boolean
  data?: ProspectOutput
  error?: z.ZodError
} {
  const result = ProspectSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Validate array of prospects
 */
export function validateProspects(data: unknown): ProspectOutput[] {
  return z.array(ProspectSchema).parse(data)
}

/**
 * Safely validate array of prospects
 */
export function safeValidateProspects(data: unknown): {
  success: boolean
  data?: ProspectOutput[]
  error?: z.ZodError
} {
  const result = z.array(ProspectSchema).safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}

/**
 * Validate ingestion configuration
 */
export function validateIngestionConfig(data: unknown): IngestionConfigOutput {
  return IngestionConfigSchema.parse(data)
}

/**
 * Validate enrichment result
 */
export function validateEnrichmentResult(data: unknown): EnrichmentResultOutput {
  return EnrichmentResultSchema.parse(data)
}

/**
 * Validate scheduler configuration
 */
export function validateScheduleConfig(data: unknown): ScheduleConfigOutput {
  return ScheduleConfigSchema.parse(data)
}

/**
 * Get validation errors in human-readable format
 */
export function formatValidationErrors(error: z.ZodError): string[] {
  return (
    (error as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues?.map(
      (err) => {
        const path = err.path.join('.')
        return `${path}: ${err.message}`
      }
    ) || []
  )
}

/**
 * Partial validation - allows incomplete data
 */
export const PartialProspectSchema = ProspectSchema.partial()
export type PartialProspect = z.infer<typeof PartialProspectSchema>

/**
 * Create custom validation for specific use cases
 */
export function createProspectValidator(options: {
  requireRevenue?: boolean
  minPriorityScore?: number
  requiredSignalCount?: number
}) {
  let schema = ProspectSchema

  if (options.requireRevenue) {
    schema = schema.refine(
      (data) => typeof data.estimatedRevenue === 'number' && data.estimatedRevenue > 0,
      { message: 'Estimated revenue must be a positive number' }
    ) as typeof schema
  }

  if (options.minPriorityScore !== undefined) {
    schema = schema.refine((data) => data.priorityScore >= options.minPriorityScore!, {
      message: `Priority score must be at least ${options.minPriorityScore}`
    })
  }

  if (options.requiredSignalCount !== undefined) {
    schema = schema.refine((data) => data.growthSignals.length >= options.requiredSignalCount!, {
      message: `Must have at least ${options.requiredSignalCount} growth signals`
    })
  }

  return schema
}

/**
 * Batch validation with error collection
 */
export function validateBatch<T>(
  schema: z.ZodSchema<T>,
  data: unknown[]
): {
  valid: T[]
  invalid: Array<{ index: number; data: unknown; errors: string[] }>
} {
  const valid: T[] = []
  const invalid: Array<{ index: number; data: unknown; errors: string[] }> = []

  data.forEach((item, index) => {
    const result = schema.safeParse(item)
    if (result.success) {
      valid.push(result.data)
    } else {
      invalid.push({
        index,
        data: item,
        errors: formatValidationErrors(result.error)
      })
    }
  })

  return { valid, invalid }
}
