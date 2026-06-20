#!/usr/bin/env node
/**
 * CLI Data Scraper
 *
 * Standalone terminal script for scraping UCC filing data and enriching company information
 * No GUI required - designed for solo individual use and field data collection
 */

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { z, ZodError } from 'zod'
import { ScraperAgent } from '../apps/web/src/lib/agentic/agents/ScraperAgent'
import { DataNormalizationAgent } from '../apps/web/src/lib/agentic/agents/DataNormalizationAgent'
import { EnrichmentOrchestratorAgent } from '../apps/web/src/lib/agentic/agents/EnrichmentOrchestratorAgent'
import { UCCFiling } from './scrapers/base-scraper'
import { database } from '../server/database/connection'
import { LeadExportService, serializeLeadExportCsv } from '../server/services/LeadExportService'
import type { LeadExportFormat } from '../server/services/LeadExportService'
import { createServiceLogger } from '../server/utils/logger'

const program = new Command()
const cliLogger = createServiceLogger('CliScraper')
const SUPPORTED_CLI_STATES = ['CA', 'TX', 'FL', 'NY'] as const
const SUPPORTED_TIERS = ['free', 'starter', 'professional'] as const
const MAX_BATCH_ROWS = 1000
const MAX_BATCH_INPUT_BYTES = 5 * 1024 * 1024

type SupportedCliState = (typeof SUPPORTED_CLI_STATES)[number]

class CliValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: string[]
  ) {
    super(message)
    this.name = 'CliValidationError'
  }
}

const companyNameSchema = z
  .string()
  .trim()
  .min(1, 'company name is required')
  .max(160, 'company name must be 160 characters or less')
  .refine((value) => !hasControlCharacters(value), {
    message: 'company name cannot contain control characters'
  })
  .transform((value) => value.replace(/\s+/g, ' '))

const stateCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(
    (value): value is SupportedCliState => {
      return SUPPORTED_CLI_STATES.includes(value as SupportedCliState)
    },
    {
      message: `state must be one of: ${SUPPORTED_CLI_STATES.join(', ')}`
    }
  )

const pathSchema = z
  .string()
  .trim()
  .min(1, 'path is required')
  .max(4096, 'path is too long')
  .refine((value) => !value.includes('\0'), { message: 'path cannot contain a NUL byte' })
  .transform((value) => path.resolve(value))

const tierSchema = z.enum(SUPPORTED_TIERS)

// Configure CLI
program
  .name('ucc-scraper')
  .description('UCC filing and company data scraper - Terminal-based data collection tool')
  .version('1.0.0')

// Scrape UCC filings command
program
  .command('scrape-ucc')
  .description('Scrape UCC filings for a company in a specific state')
  .requiredOption('-c, --company <name>', 'Company name to search')
  .requiredOption('-s, --state <code>', `State code (${SUPPORTED_CLI_STATES.join(', ')})`)
  .option('-o, --output <file>', 'Output file path (JSON)', './output.json')
  .option('--csv', 'Export as CSV instead of JSON')
  .action(async (options) => {
    const parsed = parseCliOptions('scrape-ucc', () => parseScrapeOptions(options))
    if (!parsed) return

    const spinner = ora('Initializing scraper...').start()
    cliLogger.info('CLI command started', {
      command: 'scrape-ucc',
      company: parsed.company,
      state: parsed.state,
      outputPath: parsed.outputPath,
      csv: parsed.csv
    })

    try {
      spinner.text = `Searching UCC filings for ${parsed.company} in ${parsed.state}...`

      const scraperAgent = new ScraperAgent()
      const result = await scraperAgent.executeTask({
        type: 'scrape-ucc',
        payload: {
          companyName: parsed.company,
          state: parsed.state
        }
      })

      if (!result.success) {
        spinner.fail(chalk.red('Scraping failed'))
        console.error(chalk.red('Error:'), result.error)
        cliLogger.warn('CLI command failed', {
          command: 'scrape-ucc',
          company: parsed.company,
          state: parsed.state,
          error: result.error
        })

        const searchUrl = getString(asRecord(result.data).searchUrl)
        if (searchUrl) {
          console.log(chalk.yellow('\nManual search URL:'), searchUrl)
        }

        process.exitCode = 1
        return
      }

      const data = asScrapeData(result.data, parsed.company, parsed.state)
      spinner.succeed(chalk.green('Scraping completed'))
      cliLogger.info('CLI command completed', {
        command: 'scrape-ucc',
        company: parsed.company,
        state: parsed.state,
        filingCount: data.filingCount
      })

      // Display results
      console.log(chalk.cyan('\n=== Results ==='))
      console.log(chalk.white(`Company: ${parsed.company}`))
      console.log(chalk.white(`State: ${data.state}`))
      console.log(chalk.white(`Filings found: ${data.filingCount}`))

      if (data.retryCount && data.retryCount > 0) {
        console.log(chalk.yellow(`Retries: ${data.retryCount}`))
      }

      if (data.parsingErrors && data.parsingErrors.length > 0) {
        console.log(chalk.yellow(`\n⚠ Parsing warnings (${data.parsingErrors.length}):`))
        data.parsingErrors.slice(0, 5).forEach((err: string) => {
          console.log(chalk.gray(`  • ${err}`))
        })
        if (data.parsingErrors.length > 5) {
          console.log(chalk.gray(`  ... and ${data.parsingErrors.length - 5} more`))
        }
      }

      if (data.filingCount > 0) {
        console.log(chalk.cyan('\n--- Filings ---'))
        data.filings.forEach((filing: UCCFiling, idx: number) => {
          console.log(chalk.white(`\n${idx + 1}. Filing #${filing.filingNumber}`))
          console.log(chalk.gray(`   Debtor: ${filing.debtorName}`))
          console.log(chalk.gray(`   Secured Party: ${filing.securedParty}`))
          console.log(chalk.gray(`   Date: ${filing.filingDate}`))
          console.log(chalk.gray(`   Status: ${filing.status}`))
        })
      }

      // Save to file
      const outputPath = parsed.outputPath
      let fileContent: string

      if (parsed.csv) {
        // Convert to CSV
        fileContent = convertToCSV(data)
      } else {
        // Save as JSON
        fileContent = JSON.stringify(data, null, 2)
      }

      await ensureOutputFileTarget(outputPath)
      await fs.writeFile(outputPath, fileContent, 'utf-8')
      console.log(chalk.green(`\n✓ Results saved to: ${outputPath}`))

      if (data.searchUrl) {
        console.log(chalk.blue(`\nManual verification URL: ${data.searchUrl}`))
      }
    } catch (error) {
      handleCliFailure('scrape-ucc', spinner, 'Operation failed', error, {
        company: parsed.company,
        state: parsed.state
      })
    }
  })

// Enrich company data command
program
  .command('enrich')
  .description('Enrich company data from multiple public sources')
  .requiredOption('-c, --company <name>', 'Company name')
  .requiredOption('-s, --state <code>', 'State code')
  .option('-o, --output <file>', 'Output file path', './enriched-data.json')
  .option('--tier <level>', 'Subscription tier (free, starter, professional)', 'free')
  .option('--csv', 'Export as CSV instead of JSON')
  .action(async (options) => {
    const parsed = parseCliOptions('enrich', () => parseEnrichOptions(options))
    if (!parsed) return

    const spinner = ora('Initializing enrichment pipeline...').start()
    cliLogger.info('CLI command started', {
      command: 'enrich',
      company: parsed.company,
      state: parsed.state,
      tier: parsed.tier,
      outputPath: parsed.outputPath,
      csv: parsed.csv
    })

    try {
      spinner.text = `Enriching data for ${parsed.company}...`

      const orchestrator = new EnrichmentOrchestratorAgent()
      const userId = `cli-user-${Date.now()}`

      const result = await orchestrator.executeTask({
        type: 'enrich-prospect',
        payload: {
          companyName: parsed.company,
          state: parsed.state,
          tier: parsed.tier,
          userId
        }
      })

      if (!result.success) {
        spinner.fail(chalk.red('Enrichment failed'))
        console.error(chalk.red('Error:'), result.error)
        cliLogger.warn('CLI command failed', {
          command: 'enrich',
          company: parsed.company,
          state: parsed.state,
          error: result.error
        })
        process.exitCode = 1
        return
      }

      const data = asEnrichmentData(result.data)
      spinner.succeed(chalk.green('Enrichment completed'))
      cliLogger.info('CLI command completed', {
        command: 'enrich',
        company: parsed.company,
        state: parsed.state,
        sourceCount: data.sources.length
      })

      // Display results
      console.log(chalk.cyan('\n=== Enrichment Results ==='))
      console.log(chalk.white(`Company: ${parsed.company}`))
      console.log(chalk.white(`Sources used: ${data.sources.length}`))
      console.log(chalk.white(`Total cost: $${data.cost || 0}`))
      console.log(chalk.white(`Response time: ${data.responseTime || 0}ms`))

      if (data.enrichedData) {
        console.log(chalk.cyan('\n--- Enriched Data Summary ---'))
        const enrichedData = data.enrichedData

        if (enrichedData.sec) {
          const sec = enrichedData.sec
          console.log(chalk.white(`\nSEC EDGAR:`))
          console.log(chalk.gray(`  CIK: ${sec.cik || 'N/A'}`))
          console.log(chalk.gray(`  SIC: ${sec.sicCode || 'N/A'}`))
        }

        if (enrichedData.osha) {
          const osha = enrichedData.osha
          console.log(chalk.white(`\nOSHA:`))
          console.log(chalk.gray(`  Violations: ${osha.violations || 0}`))
          console.log(chalk.gray(`  Penalties: $${osha.totalPenalties || 0}`))
        }

        if (enrichedData.uspto) {
          const uspto = enrichedData.uspto
          console.log(chalk.white(`\nUSPTO:`))
          console.log(chalk.gray(`  Trademarks: ${uspto.trademarkCount || 0}`))
        }

        if (enrichedData.samGov) {
          const samGov = enrichedData.samGov
          console.log(chalk.white(`\nSAM.gov:`))
          console.log(chalk.gray(`  Registered: ${samGov.isRegistered ? 'Yes' : 'No'}`))
          console.log(chalk.gray(`  Contracts: ${samGov.contractCount || 0}`))
        }
      }

      // Save to file
      const outputPath = parsed.outputPath
      let fileContent: string

      if (parsed.csv) {
        fileContent = convertEnrichmentToCSV(data)
      } else {
        fileContent = JSON.stringify(data, null, 2)
      }

      await ensureOutputFileTarget(outputPath)
      await fs.writeFile(outputPath, fileContent, 'utf-8')
      console.log(chalk.green(`\n✓ Results saved to: ${outputPath}`))
    } catch (error) {
      handleCliFailure('enrich', spinner, 'Operation failed', error, {
        company: parsed.company,
        state: parsed.state
      })
    }
  })

// Normalize company name
program
  .command('normalize')
  .description('Normalize and standardize company name')
  .requiredOption('-n, --name <name>', 'Company name to normalize')
  .action(async (options) => {
    const name = parseCliOptions('normalize', () => parseCompanyName(options.name, 'name'))
    if (!name) return

    const spinner = ora('Normalizing company name...').start()
    cliLogger.info('CLI command started', { command: 'normalize', company: name })

    try {
      const normAgent = new DataNormalizationAgent()
      const result = await normAgent.executeTask({
        type: 'normalize-company-name',
        payload: { name }
      })

      if (result.success) {
        const data = asRecord(result.data)
        spinner.succeed(chalk.green('Normalization completed'))
        cliLogger.info('CLI command completed', { command: 'normalize', company: name })
        console.log(chalk.cyan('\nOriginal:'), chalk.white(String(data.original || '')))
        console.log(chalk.cyan('Normalized:'), chalk.white(String(data.normalized || '')))
      } else {
        spinner.fail(chalk.red('Normalization failed'))
        console.error(chalk.red('Error:'), result.error)
        cliLogger.warn('CLI command failed', {
          command: 'normalize',
          company: name,
          error: result.error
        })
        process.exitCode = 1
        return
      }
    } catch (error) {
      handleCliFailure('normalize', spinner, 'Operation failed', error, { company: name })
    }
  })

// List available states
program
  .command('list-states')
  .description('List all states with available UCC scrapers')
  .action(async () => {
    const spinner = ora('Checking available scrapers...').start()
    cliLogger.info('CLI command started', { command: 'list-states' })

    try {
      const scraperAgent = new ScraperAgent()
      const result = await scraperAgent.executeTask({
        type: 'list-available-states',
        payload: {}
      })

      const data = asListStatesData(result.data)
      spinner.succeed(chalk.green('Available scrapers'))
      cliLogger.info('CLI command completed', {
        command: 'list-states',
        stateCount: data.count
      })

      console.log(chalk.cyan('\n=== Supported States ==='))
      data.states.forEach((state: string) => {
        console.log(chalk.white(`  ✓ ${state}`))
      })
      console.log(chalk.gray(`\nTotal: ${data.count} states\n`))
    } catch (error) {
      handleCliFailure('list-states', spinner, 'Operation failed', error)
    }
  })

// Batch processing command
program
  .command('batch')
  .description('Process multiple companies from a file')
  .requiredOption('-i, --input <file>', 'Input CSV file (company,state)')
  .option('-o, --output <dir>', 'Output directory', './batch-results')
  .option('--enrich', 'Also enrich data for each company')
  .action(async (options) => {
    const parsed = parseCliOptions('batch', () => parseBatchOptions(options))
    if (!parsed) return

    const spinner = ora('Reading input file...').start()
    cliLogger.info('CLI command started', {
      command: 'batch',
      inputPath: parsed.inputPath,
      outputDir: parsed.outputDir,
      enrich: parsed.enrich
    })

    try {
      // Read input file
      await assertInputFileSafe(parsed.inputPath)
      const inputContent = await fs.readFile(parsed.inputPath, 'utf-8')
      const lines = inputContent
        .trim()
        .split('\n')
        .filter((line) => line.trim() !== '')

      if (lines.length < 2) {
        spinner.fail(chalk.red('Input file must contain header and at least one data row'))
        cliLogger.warn('CLI command failed validation', {
          command: 'batch',
          reason: 'input_file_empty'
        })
        process.exitCode = 1
        return
      }

      if (lines.length - 1 > MAX_BATCH_ROWS) {
        throw new CliValidationError(
          `Input file exceeds maximum batch size of ${MAX_BATCH_ROWS} rows`
        )
      }

      const companies = lines
        .slice(1)
        .map((line, idx) => {
          // Simple CSV parsing - handles quoted fields
          const fields = parseCsvLine(line)
          const company = (fields[0] || '').replace(/^"|"$/g, '').trim()
          const state = (fields[1] || '').replace(/^"|"$/g, '').trim()

          try {
            return {
              company: parseCompanyName(company, `line ${idx + 2} company`),
              state: parseStateCode(state, `line ${idx + 2} state`)
            }
          } catch (error) {
            console.log(
              chalk.yellow(`⚠ Skipping invalid line ${idx + 2}: ${formatCliError(error)}`)
            )
            cliLogger.warn('Skipping invalid batch row', {
              command: 'batch',
              lineNumber: idx + 2,
              error: formatCliError(error)
            })
            return null
          }
        })
        .filter(Boolean) as { company: string; state: string }[]

      if (companies.length === 0) {
        throw new CliValidationError('Input file did not contain any valid company rows')
      }

      spinner.succeed(chalk.green(`Found ${companies.length} companies to process`))

      // Create output directory
      const outputDir = parsed.outputDir
      await fs.mkdir(outputDir, { recursive: true })

      // Process each company
      const results = []

      for (let i = 0; i < companies.length; i++) {
        const { company, state } = companies[i]
        console.log(
          chalk.cyan(`\n[${i + 1}/${companies.length}] Processing ${company} (${state})...`)
        )

        const scraperAgent = new ScraperAgent()
        const result = await scraperAgent.executeTask({
          type: 'scrape-ucc',
          payload: { companyName: company, state }
        })

        if (result.success) {
          const data = asScrapeData(result.data, company, state)
          console.log(chalk.green(`  ✓ Found ${data.filingCount} filings`))
          results.push({ ...data, company, state })

          // Save individual result with timestamp to avoid collisions
          const timestamp = Date.now()
          const sanitized = company.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50)
          const filename = `${sanitized}-${state}-${timestamp}.json`
          await fs.writeFile(path.join(outputDir, filename), JSON.stringify(data, null, 2), 'utf-8')
        } else {
          console.log(chalk.yellow(`  ⚠ Failed: ${result.error}`))
          results.push({ company, state, error: result.error })
        }

        // Rate limiting
        if (i < companies.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 15000)) // 15 second delay
        }
      }

      // Save summary
      const summaryPath = path.join(outputDir, 'summary.json')
      await fs.writeFile(summaryPath, JSON.stringify(results, null, 2), 'utf-8')

      console.log(chalk.green(`\n✓ Batch processing completed`))
      console.log(chalk.white(`Results saved to: ${outputDir}`))
      cliLogger.info('CLI command completed', {
        command: 'batch',
        requestedRows: lines.length - 1,
        processedRows: companies.length,
        outputDir
      })
    } catch (error) {
      handleCliFailure('batch', spinner, 'Batch processing failed', error, {
        inputPath: parsed.inputPath,
        outputDir: parsed.outputDir
      })
    }
  })

// Lead export command
program
  .command('lead-export')
  .description('Export scored MCA leads as CSV and JSON batch files')
  .option('-o, --output-dir <dir>', 'Output directory', './lead-export')
  .option('--format <format>', 'Output format: json, csv, or both', 'both')
  .option('--min-score <score>', 'Minimum MCA score to export', '70')
  .option('--max-score <score>', 'Maximum MCA score to export')
  .option('--state <code>', 'Filter by two-letter state code')
  .option('--industry <name>', 'Filter by industry')
  .option('--status <status>', 'Filter by prospect status')
  .option('--limit <count>', 'Batch size', '100')
  .option('--offset <count>', 'Batch offset for pagination', '0')
  .action(async (options) => {
    const parsed = parseCliOptions('lead-export', () => parseLeadExportOptions(options))
    if (!parsed) return

    const spinner = ora('Connecting to database...').start()
    let connected = false
    cliLogger.info('CLI command started', {
      command: 'lead-export',
      outputDir: parsed.outputDir,
      format: parsed.format,
      filters: parsed.filters
    })

    try {
      await database.connect()
      connected = true

      spinner.text = 'Building scored MCA lead export...'
      const exportService = new LeadExportService()
      const batch = await exportService.exportLeads({
        state: parsed.filters.state,
        industry: parsed.filters.industry,
        status: parsed.filters.status,
        minScore: parsed.filters.minScore,
        maxScore: parsed.filters.maxScore,
        limit: parsed.filters.limit,
        offset: parsed.filters.offset
      })

      await fs.mkdir(parsed.outputDir, { recursive: true })

      const writtenFiles: string[] = []
      if (parsed.format === 'json' || parsed.format === 'both') {
        const jsonPath = path.join(parsed.outputDir, `${batch.batch.id}.json`)
        await fs.writeFile(jsonPath, JSON.stringify(batch, null, 2), 'utf-8')
        writtenFiles.push(jsonPath)
      }

      if (parsed.format === 'csv' || parsed.format === 'both') {
        const csvPath = path.join(parsed.outputDir, `${batch.batch.id}.csv`)
        await fs.writeFile(csvPath, serializeLeadExportCsv(batch), 'utf-8')
        writtenFiles.push(csvPath)
      }

      spinner.succeed(chalk.green('Lead export completed'))
      cliLogger.info('CLI command completed', {
        command: 'lead-export',
        batchId: batch.batch.id,
        leadCount: batch.batch.count,
        total: batch.batch.total,
        writtenFiles
      })

      console.log(chalk.cyan('\n=== Lead Export Batch ==='))
      console.log(chalk.white(`Batch: ${batch.batch.id}`))
      console.log(chalk.white(`Leads: ${batch.batch.count} of ${batch.batch.total}`))
      console.log(chalk.white(`Min score: ${batch.batch.filters.min_score}`))
      if (batch.batch.next_offset !== null) {
        console.log(chalk.yellow(`Next offset: ${batch.batch.next_offset}`))
      }
      for (const file of writtenFiles) {
        console.log(chalk.green(`✓ ${file}`))
      }
    } catch (error) {
      handleCliFailure('lead-export', spinner, 'Lead export failed', error, {
        outputDir: parsed.outputDir,
        format: parsed.format
      })
    } finally {
      if (connected) {
        await database.disconnect()
      }
    }
  })

type ScrapeOptions = {
  company: string
  state: SupportedCliState
  outputPath: string
  csv: boolean
}

type EnrichOptions = ScrapeOptions & {
  tier: (typeof SUPPORTED_TIERS)[number]
}

type BatchOptions = {
  inputPath: string
  outputDir: string
  enrich: boolean
}

type LeadExportOptions = {
  outputDir: string
  format: LeadExportFormat
  filters: {
    minScore: number
    maxScore?: number
    state?: SupportedCliState
    industry?: string
    status?: string
    limit: number
    offset: number
  }
}

type ScrapeCliData = {
  state: string
  companyName: string
  filings: UCCFiling[]
  filingCount: number
  searchUrl?: string
  retryCount?: number
  parsingErrors?: string[]
}

type EnrichmentCliData = Record<string, unknown> & {
  sources: string[]
  cost?: number
  responseTime?: number
  enrichedData?: Record<string, Record<string, unknown>>
}

type ListStatesCliData = {
  states: string[]
  count: number
}

function parseCliOptions<T>(command: string, parser: () => T): T | undefined {
  try {
    return parser()
  } catch (error) {
    handleCliFailure(command, undefined, 'Invalid options', error)
    return undefined
  }
}

function parseScrapeOptions(options: Record<string, unknown>): ScrapeOptions {
  return {
    company: parseCompanyName(options.company, 'company'),
    state: parseStateCode(options.state, 'state'),
    outputPath: parsePathOption(options.output, 'output'),
    csv: Boolean(options.csv)
  }
}

function parseEnrichOptions(options: Record<string, unknown>): EnrichOptions {
  return {
    ...parseScrapeOptions(options),
    tier: parseSchema(tierSchema, options.tier, 'tier')
  }
}

function parseBatchOptions(options: Record<string, unknown>): BatchOptions {
  return {
    inputPath: parsePathOption(options.input, 'input'),
    outputDir: parsePathOption(options.output, 'output'),
    enrich: Boolean(options.enrich)
  }
}

function parseLeadExportOptions(options: Record<string, unknown>): LeadExportOptions {
  const minScore = parseCliInteger(options.minScore, 'min-score', { min: 0, max: 100 })
  const maxScore =
    options.maxScore === undefined || options.maxScore === ''
      ? undefined
      : parseCliInteger(options.maxScore, 'max-score', { min: 0, max: 100 })

  if (maxScore !== undefined && maxScore < minScore) {
    throw new CliValidationError('max-score must be greater than or equal to min-score')
  }

  return {
    outputDir: parsePathOption(options.outputDir, 'output-dir'),
    format: parseLeadExportFormat(options.format),
    filters: {
      minScore,
      maxScore,
      state:
        options.state === undefined || options.state === ''
          ? undefined
          : parseStateCode(options.state, 'state'),
      industry: parseOptionalText(options.industry, 'industry'),
      status: parseOptionalText(options.status, 'status'),
      limit: parseCliInteger(options.limit, 'limit', { min: 1, max: 1000 }),
      offset: parseCliInteger(options.offset, 'offset', { min: 0 })
    }
  }
}

function parseCompanyName(value: unknown, label: string): string {
  return parseSchema(companyNameSchema, value, label)
}

function parseStateCode(value: unknown, label: string): SupportedCliState {
  return parseSchema(stateCodeSchema, value, label) as SupportedCliState
}

function parsePathOption(value: unknown, label: string): string {
  return parseSchema(pathSchema, value, label)
}

function parseOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const text = parseSchema(
    z
      .string()
      .trim()
      .min(1, `${label} cannot be empty`)
      .max(120, `${label} must be 120 characters or less`)
      .refine((current) => !hasControlCharacters(current), {
        message: `${label} cannot contain control characters`
      }),
    value,
    label
  )
  return text
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (result.success) {
    return result.data
  }

  throw new CliValidationError(
    `Invalid ${label}`,
    result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? `${label}.${issue.path.join('.')}` : label
      return `${field}: ${issue.message}`
    })
  )
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

export function parseLeadExportFormat(value: unknown): LeadExportFormat {
  if (typeof value !== 'string') {
    throw new CliValidationError('format must be one of: json, csv, both')
  }

  const format = value.trim().toLowerCase()
  if (format === 'json' || format === 'csv' || format === 'both') {
    return format
  }
  throw new CliValidationError('format must be one of: json, csv, both')
}

export function parseCliInteger(
  value: unknown,
  label: string,
  bounds: { min?: number; max?: number } = {}
): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new CliValidationError(`${label} must be an integer`)
  }

  const text = String(value).trim()
  if (!/^-?\d+$/.test(text)) {
    throw new CliValidationError(`${label} must be an integer`)
  }

  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed)) {
    throw new CliValidationError(`${label} must be a safe integer`)
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    throw new CliValidationError(`${label} must be at least ${bounds.min}`)
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new CliValidationError(`${label} must be at most ${bounds.max}`)
  }

  return parsed
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asScrapeData(
  value: unknown,
  fallbackCompanyName: string,
  fallbackState: string
): ScrapeCliData {
  const record = asRecord(value)
  const filings = Array.isArray(record.filings) ? (record.filings as UCCFiling[]) : []
  const parsingErrors = Array.isArray(record.parsingErrors)
    ? record.parsingErrors.filter((item): item is string => typeof item === 'string')
    : undefined

  return {
    state: getString(record.state) || fallbackState,
    companyName: getString(record.companyName) || fallbackCompanyName,
    filings,
    filingCount: getNumber(record.filingCount) ?? filings.length,
    searchUrl: getString(record.searchUrl),
    retryCount: getNumber(record.retryCount),
    parsingErrors
  }
}

function asEnrichmentData(value: unknown): EnrichmentCliData {
  const record = asRecord(value)
  const enrichedData =
    record.enrichedData && typeof record.enrichedData === 'object'
      ? (record.enrichedData as Record<string, Record<string, unknown>>)
      : undefined

  return {
    ...record,
    sources: Array.isArray(record.sources)
      ? record.sources.filter((item): item is string => typeof item === 'string')
      : [],
    cost: getNumber(record.cost),
    responseTime: getNumber(record.responseTime),
    enrichedData
  }
}

function asListStatesData(value: unknown): ListStatesCliData {
  const record = asRecord(value)
  const states = Array.isArray(record.states)
    ? record.states.filter((item): item is string => typeof item === 'string')
    : []

  return {
    states,
    count: getNumber(record.count) ?? states.length
  }
}

async function assertInputFileSafe(inputPath: string): Promise<void> {
  const stat = await fs.stat(inputPath)
  if (!stat.isFile()) {
    throw new CliValidationError('Input path must be a file')
  }
  if (stat.size > MAX_BATCH_INPUT_BYTES) {
    throw new CliValidationError(`Input file must be ${MAX_BATCH_INPUT_BYTES} bytes or smaller`)
  }
}

async function ensureOutputFileTarget(outputPath: string): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  try {
    const stat = await fs.stat(outputPath)
    if (stat.isDirectory()) {
      throw new CliValidationError('Output path must be a file, not a directory')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      i++
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  fields.push(current.trim())
  return fields
}

function handleCliFailure(
  command: string,
  spinner: ReturnType<typeof ora> | undefined,
  message: string,
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  if (spinner) {
    spinner.fail(chalk.red(message))
  } else {
    console.error(chalk.red(message))
  }

  const formatted = formatCliError(error)
  console.error(chalk.red('Error:'), formatted)
  cliLogger.error('CLI command failed', toError(error, formatted), {
    command,
    ...context
  })
  process.exitCode = 1
}

function formatCliError(error: unknown): string {
  if (error instanceof CliValidationError) {
    return error.details?.length ? `${error.message}: ${error.details.join('; ')}` : error.message
  }
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join('; ')
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function toError(error: unknown, fallbackMessage?: string): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(fallbackMessage || String(error))
}

// Helper function to convert data to CSV
function convertToCSV(data: { filings?: UCCFiling[] }): string {
  if (!data.filings || data.filings.length === 0) {
    return 'No filings found'
  }

  const headers = [
    'Filing Number',
    'Debtor Name',
    'Secured Party',
    'Filing Date',
    'Status',
    'Collateral',
    'Type'
  ]
  const rows = data.filings.map((filing: UCCFiling) => [
    filing.filingNumber,
    filing.debtorName,
    filing.securedParty,
    filing.filingDate,
    filing.status,
    filing.collateral || '',
    filing.filingType || ''
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map((row: string[]) => row.map(escapeCSV).join(','))
  ].join('\n')

  return csvContent
}

function convertEnrichmentToCSV(data: Record<string, unknown>): string {
  const headers = ['Field', 'Value']
  const rows: string[][] = []

  rows.push(['Company Name', String(data.companyName || '')])
  rows.push(['State', String(data.state || '')])
  rows.push(['Sources Used', Array.isArray(data.sources) ? data.sources.join(', ') : ''])
  rows.push(['Total Cost', `$${data.cost || 0}`])

  if (data.enrichedData && typeof data.enrichedData === 'object') {
    const enriched = data.enrichedData as Record<string, Record<string, unknown>>
    if (enriched.sec) {
      rows.push(['SEC CIK', String(enriched.sec.cik || '')])
      rows.push(['SEC SIC Code', String(enriched.sec.sicCode || '')])
    }
    if (enriched.osha) {
      rows.push(['OSHA Violations', String(enriched.osha.violations || '0')])
      rows.push(['OSHA Penalties', `$${enriched.osha.totalPenalties || 0}`])
    }
    if (enriched.uspto) {
      rows.push(['USPTO Trademarks', String(enriched.uspto.trademarkCount || '0')])
    }
    if (enriched.samGov) {
      rows.push(['SAM.gov Registered', enriched.samGov.isRegistered ? 'Yes' : 'No'])
      rows.push(['SAM.gov Contracts', String(enriched.samGov.contractCount || '0')])
    }
  }

  return [headers.join(','), ...rows.map((row) => row.map(escapeCSV).join(','))].join('\n')
}

function escapeCSV(value: unknown): string {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv)
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((error) => {
    handleCliFailure('main', undefined, 'Fatal CLI error', error)
  })
}
