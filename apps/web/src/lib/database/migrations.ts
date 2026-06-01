/**
 * Database Migration System
 *
 * Simple migration runner for PostgreSQL schema changes
 */

import { DatabaseClient } from './client'
import { logger } from '../logging/logger'
import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'

export interface Migration {
  id: number
  name: string
  sql: string
  checksum?: string
  executed_at?: string
}

/**
 * Compute a stable checksum for a migration's SQL body so that previously
 * executed migrations that were later edited can be detected.
 */
function computeChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf-8').digest('hex')
}

export class MigrationRunner {
  private client: DatabaseClient
  private migrationsDir: string

  constructor(client: DatabaseClient, migrationsDir: string = 'database/migrations') {
    this.client = client
    this.migrationsDir = migrationsDir
  }

  /**
   * Initialize migrations table
   */
  async initialize(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum VARCHAR(64),
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `

    await this.client.query(sql)

    // Ensure the checksum column exists for tables created before checksums
    // were tracked (idempotent / safe to run repeatedly).
    await this.client.query(
      'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)'
    )

    logger.info('Migrations table initialized')
  }

  /**
   * Get executed migrations
   */
  async getExecutedMigrations(): Promise<Migration[]> {
    const result = await this.client.query<Migration>(
      'SELECT * FROM schema_migrations ORDER BY id ASC'
    )
    return result.rows
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations(): Promise<Migration[]> {
    const executed = await this.getExecutedMigrations()
    const executedIds = new Set(executed.map((m) => m.id))

    const allMigrations = await this.loadMigrationFiles()
    return allMigrations.filter((m) => !executedIds.has(m.id))
  }

  /**
   * Run pending migrations
   */
  async migrate(): Promise<void> {
    await this.initialize()

    // Detect migrations that were already applied but have since been edited.
    // Editing an applied migration is almost always a mistake (the change will
    // never be re-run), so we surface it loudly instead of silently ignoring.
    await this.detectModifiedMigrations()

    const pending = await this.getPendingMigrations()

    if (pending.length === 0) {
      logger.info('No pending migrations')
      return
    }

    logger.info(`Running ${pending.length} migrations`)

    for (const migration of pending) {
      await this.runMigration(migration)
    }

    logger.info('All migrations completed')
  }

  /**
   * Run a single migration
   */
  private async runMigration(migration: Migration): Promise<void> {
    logger.info(`Running migration: ${migration.name}`)

    try {
      await this.client.query('BEGIN')

      // Execute migration SQL
      await this.client.query(migration.sql)

      // Record migration along with its checksum so future edits can be
      // detected.
      await this.client.query(
        'INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)',
        [migration.id, migration.name, migration.checksum ?? computeChecksum(migration.sql)]
      )

      await this.client.query('COMMIT')

      logger.info(`Migration completed: ${migration.name}`)
    } catch (error) {
      await this.client.query('ROLLBACK')
      throw error
    }
  }

  /**
   * Detect migrations that were applied previously but whose SQL has since
   * changed. We only warn (rather than throw) so existing deployments are not
   * broken, but the mismatch is made visible.
   */
  private async detectModifiedMigrations(): Promise<void> {
    const executed = await this.getExecutedMigrations()
    const executedById = new Map(executed.map((m) => [m.id, m]))

    const allMigrations = await this.loadMigrationFiles()

    for (const migration of allMigrations) {
      const applied = executedById.get(migration.id)
      // Skip migrations that have not run yet or that predate checksum tracking.
      if (!applied || !applied.checksum) {
        continue
      }

      const currentChecksum = migration.checksum ?? computeChecksum(migration.sql)
      if (applied.checksum !== currentChecksum) {
        logger.warn(
          `Migration ${migration.id}_${migration.name} has been modified after being applied ` +
            `(stored checksum ${applied.checksum} != current ${currentChecksum}). ` +
            `The change will NOT be re-run. Create a new migration instead.`
        )
      }
    }
  }

  /**
   * Load migration files from directory
   */
  private async loadMigrationFiles(): Promise<Migration[]> {
    try {
      const files = await fs.readdir(this.migrationsDir)
      const sqlFiles = files.filter((f) => f.endsWith('.sql'))

      const migrations: Migration[] = []

      for (const file of sqlFiles) {
        const match = file.match(/^(\d+)_(.+)\.sql$/)
        if (!match) continue

        const id = parseInt(match[1], 10)
        const name = match[2]
        const filePath = path.join(this.migrationsDir, file)
        const sql = await fs.readFile(filePath, 'utf-8')

        migrations.push({ id, name, sql, checksum: computeChecksum(sql) })
      }

      // Sort by the parsed numeric id so migrations run in numeric order.
      // String sorting would order "10_foo" before "9_bar", applying them in
      // the wrong sequence.
      migrations.sort((a, b) => a.id - b.id)

      return migrations
    } catch (error) {
      logger.error('Failed to load migration files', { error })
      throw error
    }
  }

  /**
   * Rollback last migration
   */
  async rollback(): Promise<void> {
    const executed = await this.getExecutedMigrations()
    if (executed.length === 0) {
      logger.warn('No migrations to rollback')
      return
    }

    const last = executed[executed.length - 1]
    logger.warn(`Rolling back migration: ${last.name}`)

    await this.client.query('DELETE FROM schema_migrations WHERE id = $1', [last.id])

    logger.info('Rollback completed (SQL changes must be manually reverted)')
  }
}

/**
 * Create migration file
 */
export async function createMigration(
  name: string,
  migrationsDir: string = 'database/migrations'
): Promise<void> {
  const timestamp = Date.now()
  const filename = `${timestamp}_${name}.sql`
  const filePath = path.join(migrationsDir, filename)

  const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Add your SQL migration here

-- Example:
-- CREATE TABLE example (
--   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--   name VARCHAR(255) NOT NULL
-- );
`

  await fs.writeFile(filePath, template, 'utf-8')
  logger.info(`Migration file created: ${filename}`)
}
