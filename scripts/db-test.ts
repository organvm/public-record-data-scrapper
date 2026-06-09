#!/usr/bin/env tsx

/**
 * Database Connection Test Script
 *
 * Tests the database connection and displays basic information.
 */

import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { testConnection, query, closePool } from '../apps/web/src/lib/db'

// Load environment variables
config()

async function main() {
  console.log('Testing Database Connection')
  console.log('='.repeat(60))
  console.log(`Database: ${process.env.DB_NAME || 'ucc_mca'}`)
  console.log(`Host: ${process.env.DB_HOST || 'localhost'}`)
  console.log(`Port: ${process.env.DB_PORT || '5432'}`)
  console.log(`User: ${process.env.DB_USER || 'postgres'}`)
  console.log('='.repeat(60))

  try {
    // Test connection
    const connected = await testConnection()

    if (!connected) {
      console.error('\n✗ Database connection failed')
      process.exit(1)
    }

    // Get PostgreSQL version
    const versionResult = await query('SELECT version()')
    console.log('\nPostgreSQL Version:')
    console.log(versionResult.rows[0].version)

    // Check if migrations table exists
    const tablesResult = await query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'schema_migrations'
    `)

    if (parseInt(tablesResult.rows[0].count) > 0) {
      // Get applied migrations
      const migrationsResult = await query(`
        SELECT version, name, applied_at
        FROM schema_migrations
        ORDER BY version
      `)

      console.log('\nApplied Migrations:')
      if (migrationsResult.rows.length === 0) {
        console.log('  (none)')
      } else {
        for (const row of migrationsResult.rows) {
          console.log(`  - ${row.version}: ${row.name} (${new Date(row.applied_at).toISOString()})`)
        }
      }

      // Get table count
      const tableCountResult = await query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
      `)

      console.log(`\nTotal Tables: ${tableCountResult.rows[0].count}`)
    } else {
      console.log('\n⚠ Migrations table does not exist. Run migrations to set up the database.')
    }

    console.log('\n' + '='.repeat(60))
    console.log('✓ Database test completed successfully')
    console.log('='.repeat(60))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('\n' + '='.repeat(60))
    console.error('✗ Database test failed:', message)
    console.error('='.repeat(60))
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

export { main as testDatabase }
