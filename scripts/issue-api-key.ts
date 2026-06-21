import { randomBytes, createHash } from 'crypto'
import { database } from '../server/database/connection.js'
import { config } from '../server/config/index.js'

async function main() {
  const args = process.argv.slice(2)
  const orgIdIndex = args.indexOf('--org')
  const nameIndex = args.indexOf('--name')
  const userIndex = args.indexOf('--user')

  if (orgIdIndex === -1 || nameIndex === -1) {
    console.error('Usage: npx tsx scripts/issue-api-key.ts --org <org_id> --name <key_name> [--user <user_id>]')
    process.exit(1)
  }

  const orgId = args[orgIdIndex + 1]
  const name = args[nameIndex + 1]
  const userId = userIndex !== -1 ? args[userIndex + 1] : null

  try {
    await database.connect()

    // Generate a random key
    const rawKey = `ucc_${randomBytes(32).toString('hex')}`
    const keyHash = createHash('sha256').update(rawKey).digest('hex')
    const keyPrefix = rawKey.substring(0, 10)

    const result = await database.query(
      `INSERT INTO api_keys (org_id, name, key_hash, key_prefix, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [orgId, name, keyHash, keyPrefix, userId]
    )

    console.log(`Successfully issued API key for organization: ${orgId}`)
    console.log(`Key Name: ${name}`)
    console.log(`\nAPI Key: ${rawKey}`)
    console.log(`\nIMPORTANT: Save this key now. It will not be shown again.`)
    console.log(`To use it, send it in the Authorization header:`)
    console.log(`Authorization: Bearer ${rawKey}`)

  } catch (error) {
    console.error('Error issuing API key:', error)
  } finally {
    await database.disconnect()
  }
}

main()
