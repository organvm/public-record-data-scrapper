#!/usr/bin/env tsx

/**
 * Database Migration Runner
 *
 * This script runs all pending database migrations in order.
 * It tracks which migrations have been applied using the schema_migrations table.
 */

import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Pool } from 'pg'
import { config } from 'dotenv'

// ESM compatibility
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
config()

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ucc_mca',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || ''
})

interface Migration {
  version: string
  name: string
  filename: string
  path: string
}

async function getAppliedMigrations(): Promise<Set<string>> {
  try {
    const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version')
    return new Set(result.rows.map((row) => row.version))
  } catch {
    // If table doesn't exist, no migrations have been applied
    console.log('No migrations table found. Will create on first migration.')
    return new Set()
  }
}

async function recordMigration(migration: Migration): Promise<void> {
  await pool.query(
    `
      INSERT INTO schema_migrations (version, name)
      VALUES ($1, $2)
      ON CONFLICT (version) DO NOTHING
    `,
    [migration.version, migration.name]
  )
}

function getPendingMigrations(migrationsDir: string, appliedVersions: Set<string>): Migration[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.includes('_down.sql'))
    .sort()

  const migrations: Migration[] = []

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/)
    if (!match) {
      console.warn(`Skipping invalid migration file: ${file}`)
      continue
    }

    const [, version, name] = match

    if (!appliedVersions.has(version)) {
      migrations.push({
        version,
        name,
        filename: file,
        path: join(migrationsDir, file)
      })
    }
  }

  return migrations
}

async function runMigration(migration: Migration): Promise<void> {
  const sql = readFileSync(migration.path, 'utf-8')

  console.log(`\nRunning migration ${migration.version}: ${migration.name}`)
  console.log('='.repeat(60))

  try {
    // Run the migration SQL
    await pool.query(sql)
    await recordMigration(migration)
    console.log(`✓ Migration ${migration.version} completed successfully`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`✗ Migration ${migration.version} failed:`, message)
    throw error
  }
}

async function main() {
  console.log('Database Migration Runner')
  console.log('='.repeat(60))
  console.log(`Database: ${process.env.DB_NAME || 'ucc_mca'}`)
  console.log(`Host: ${process.env.DB_HOST || 'localhost'}`)
  console.log(`Port: ${process.env.DB_PORT || '5432'}`)
  console.log('='.repeat(60))

  try {
    // Test connection
    console.log('\nTesting database connection...')
    const connectionResult = await pool.query('SELECT NOW()')
    console.log('✓ Database connection successful')
    console.log(`  Current time: ${connectionResult.rows[0].now}`)

    // Get applied migrations
    const appliedVersions = await getAppliedMigrations()
    console.log(`\nApplied migrations: ${appliedVersions.size}`)

    // Get pending migrations
    const migrationsDir = join(__dirname, '..', 'database', 'migrations')
    const pendingMigrations = getPendingMigrations(migrationsDir, appliedVersions)

    if (pendingMigrations.length === 0) {
      console.log('\n✓ No pending migrations. Database is up to date.')
      return
    }

    console.log(`\nPending migrations: ${pendingMigrations.length}`)
    for (const migration of pendingMigrations) {
      console.log(`  - ${migration.version}: ${migration.name}`)
    }

    // Run pending migrations
    for (const migration of pendingMigrations) {
      await runMigration(migration)
    }

    console.log('\n' + '='.repeat(60))
    console.log('✓ All migrations completed successfully!')
    console.log('='.repeat(60))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('\n' + '='.repeat(60))
    console.error('✗ Migration failed:', message)
    console.error('='.repeat(60))
    process.exit(1)
  } finally {
    await pool.end()
  }
}

// Run the migration
main()

export { main as runMigrations }
