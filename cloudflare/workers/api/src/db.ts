/**
 * Typed D1 helpers.
 *
 * ┌─ TENANT ISOLATION INVARIANT (telos #3) ────────────────────────────────┐
 * │ D1/SQLite has NO row-level security. Multi-tenancy is enforced entirely │
 * │ in the QUERY LAYER. Therefore EVERY tenant-scoped statement MUST carry  │
 * │ `WHERE org_id = ?` (or an equivalent JOIN-on-org_id) and bind the org   │
 * │ from the verified Access identity — never from client input.            │
 * │ A query without org scoping does not ship. No exceptions.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
import type { Env } from './types'

/** Run a SELECT and return all rows, typed as `T`. */
export async function all<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const stmt = env.DB.prepare(sql).bind(...params)
  const { results } = await stmt.all<T>()
  return results ?? []
}

/** Run a SELECT and return the first row (or null), typed as `T`. */
export async function first<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  const stmt = env.DB.prepare(sql).bind(...params)
  const row = await stmt.first<T>()
  return row ?? null
}

/** Run an INSERT/UPDATE/DELETE and return D1's run metadata. */
export async function run(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<D1Result> {
  const stmt = env.DB.prepare(sql).bind(...params)
  return stmt.run()
}
