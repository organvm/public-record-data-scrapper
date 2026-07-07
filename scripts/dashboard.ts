#!/usr/bin/env tsx

/**
 * Minimal Status/Usage Dashboard
 *
 * Shows key metrics for the public-record-data-scrapper product.
 */

import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { testConnection, query, closePool } from '../apps/web/src/lib/db/index.js'
import chalk from 'chalk'

// Load environment variables
config()

async function main() {
  console.log(chalk.bold.blue('\n📊 Public Record Data Scraper Dashboard'))
  console.log('='.repeat(60))

  try {
    const connected = await testConnection()
    if (!connected) {
      console.log(chalk.red('✗ Database connection failed.'))
      process.exit(1)
    }

    console.log(chalk.green('✓ Database connected\n'))

    // 1. Prospect Metrics
    console.log(chalk.bold('👥 Prospect Metrics'))
    const prospectCount = await query('SELECT COUNT(*) as count FROM prospects')
    const prospectsByStatus = await query('SELECT status, COUNT(*) as count FROM prospects GROUP BY status ORDER BY count DESC')
    
    console.log(`  Total Prospects: ${chalk.cyan(prospectCount.rows[0].count)}`)
    prospectsByStatus.rows.forEach(row => {
      console.log(`    - ${row.status}: ${row.count}`)
    })
    console.log()

    // 2. UCC Filings Metrics
    console.log(chalk.bold('📄 UCC Filings Metrics'))
    const uccCount = await query('SELECT COUNT(*) as count FROM ucc_filings')
    const uccByType = await query('SELECT filing_type, COUNT(*) as count FROM ucc_filings GROUP BY filing_type')
    const activeUccCount = await query("SELECT COUNT(*) as count FROM ucc_filings WHERE status = 'active'")

    console.log(`  Total Filings: ${chalk.cyan(uccCount.rows[0].count)}`)
    console.log(`  Active Filings: ${chalk.cyan(activeUccCount.rows[0].count)}`)
    uccByType.rows.forEach(row => {
      console.log(`    - ${row.filing_type}: ${row.count}`)
    })
    console.log()

    // 3. Ingestion Health
    console.log(chalk.bold('⚙️  Ingestion Health (Last 7 Days)'))
    
    try {
      const recentLogs = await query(`
        SELECT status, COUNT(*) as count 
        FROM ingestion_logs 
        WHERE started_at >= NOW() - INTERVAL '7 days' 
        GROUP BY status
      `)
      if (recentLogs.rows.length === 0) {
         console.log(`  No ingestion logs in the last 7 days.`)
      } else {
        recentLogs.rows.forEach(row => {
          const color = row.status === 'success' ? chalk.green : (row.status === 'failed' ? chalk.red : chalk.yellow)
          console.log(`  ${row.status}: ${color(row.count)}`)
        })
      }
    } catch (e) {
      console.log(chalk.gray('  (Ingestion logs table not available or empty)'))
    }
    console.log()
    
    // 4. Data Quality / Coverage (Telemetry)
    console.log(chalk.bold('📡 State Telemetry Status'))
    try {
      const telemetryStats = await query(`
        SELECT current_status, COUNT(*) as count 
        FROM ingestion_telemetry 
        GROUP BY current_status
      `)
      if (telemetryStats.rows.length === 0) {
         console.log(`  No telemetry data.`)
      } else {
        telemetryStats.rows.forEach(row => {
          console.log(`  States in '${row.current_status}': ${chalk.cyan(row.count)}`)
        })
      }
    } catch (e) {
      console.log(chalk.gray('  (Telemetry table not available)'))
    }

    console.log('\n' + '='.repeat(60))
    console.log(chalk.bold.green('Dashboard Generated Successfully'))

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(chalk.red('\n✗ Error generating dashboard:'), message)
    process.exit(1)
  } finally {
    await closePool()
  }
}

// Run if executed directly
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main()
}

export { main as runDashboard }
