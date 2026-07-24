import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readMigration(filename: string): string {
  const path = fileURLToPath(new URL(`../../../database/migrations/${filename}`, import.meta.url))
  return readFileSync(path, 'utf8')
}

describe('migration 025 API-key name width', () => {
  it('widens the deployed column to the route contract maximum', () => {
    const sql = readMigration('025_api_key_name_width.sql')

    expect(sql).toMatch(/ALTER\s+TABLE\s+api_keys\s+ALTER\s+COLUMN\s+name\s+TYPE\s+VARCHAR\(120\)/i)
  })

  it('has an explicit bounded rollback to the prior width', () => {
    const sql = readMigration('025_down.sql')

    expect(sql).toMatch(
      /ALTER\s+COLUMN\s+name\s+TYPE\s+VARCHAR\(100\)\s+USING\s+left\(name,\s*100\)/i
    )
  })
})
