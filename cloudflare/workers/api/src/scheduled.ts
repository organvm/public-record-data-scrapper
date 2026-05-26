/**
 * Cron handler — the $0 async pipeline.
 *
 * telos: "Async pipeline → Queues (Cron + a D1 drain at the $0 floor)". Until
 * the $5 Workers Paid plan unlocks real Queues/Durable Objects, scheduled work
 * is driven by Cron Triggers and a D1 `jobs` table that we drain each tick.
 * This mirrors the old BullMQ topology:
 *   - "0 2 ..."  daily 02:00     -> ucc-ingestion
 *   - every 6h                   -> data-enrichment
 *   - every 12h                  -> health-scores
 *
 * Fail-safe by construction: a thrown handler is caught and logged, never
 * crashing the tick; a failing job is marked `failed` and skipped, never
 * blocking the rest of the drain.
 */
import { all, run } from './db'
import type { Env } from './types'

interface JobRow {
  id: string
  type: string
  payload: string | null
  org_id: string | null
  attempts: number
}

const MAX_ATTEMPTS = 5
const DRAIN_BATCH = 25

// --- Scheduled-task stubs (would enqueue per-state / per-prospect work) ------

async function runIngestion(env: Env): Promise<void> {
  // TODO: port server queue `ucc-ingestion`. Fire per-state scraper Workers,
  // stream rows to D1 (prospects/ucc_filings), large payloads to R2 ARTIFACTS,
  // and re-enqueue failures into the `jobs` table.
  console.log(`[cron] ingestion tick (env=${env.ENVIRONMENT}) — stub`)
}

async function runEnrichment(env: Env): Promise<void> {
  // TODO: port server queue `data-enrichment`. Enrich org-scoped prospects.
  console.log(`[cron] enrichment tick (env=${env.ENVIRONMENT}) — stub`)
}

async function runHealthScores(env: Env): Promise<void> {
  // TODO: port server queue `health-scores`. Recompute priority/health scores
  // (telos: Workers AI + Vectorize replace hand-rolled heuristics).
  console.log(`[cron] health-scores tick (env=${env.ENVIRONMENT}) — stub`)
}

/**
 * Process a single dequeued job. Stub for now; switch on `job.type` as routes
 * are ported. Throwing here marks the job failed (caught by the drain).
 */
async function processJob(env: Env, job: JobRow): Promise<void> {
  // TODO: dispatch by job.type. Keep all work org-scoped via job.org_id.
  console.log(`[drain] processing job ${job.id} type=${job.type} org=${job.org_id ?? 'none'} — stub`)
}

/**
 * Drain pending jobs from D1. Always runs on every cron tick (the $0 queue).
 * At-least-once: a job is marked `processing` before work, then `done` or
 * `failed`. Per-job try/catch means one bad job never stalls the batch.
 */
export async function drainJobs(env: Env): Promise<void> {
  let jobs: JobRow[]
  try {
    jobs = await all<JobRow>(
      env,
      `SELECT id, type, payload, org_id, attempts
         FROM jobs
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?`,
      DRAIN_BATCH
    )
  } catch (err) {
    console.error('[drain] failed to read jobs queue', err)
    return
  }

  for (const job of jobs) {
    try {
      // Claim the job (best-effort; duplicate delivery is acceptable at-least-once).
      await run(
        env,
        `UPDATE jobs SET status = 'processing', attempts = attempts + 1 WHERE id = ?`,
        job.id
      )

      await processJob(env, job)

      await run(env, `UPDATE jobs SET status = 'done' WHERE id = ?`, job.id)
    } catch (err) {
      console.error(`[drain] job ${job.id} failed`, err)
      const nextStatus = job.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending'
      try {
        await run(env, `UPDATE jobs SET status = ? WHERE id = ?`, nextStatus, job.id)
      } catch (markErr) {
        console.error(`[drain] could not mark job ${job.id} as ${nextStatus}`, markErr)
      }
    }
  }
}

/**
 * Cloudflare Cron entrypoint. Routes by schedule, then always drains the queue.
 * Uses ctx.waitUntil so work continues past the handler return.
 */
export async function scheduled(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const task = (async () => {
    try {
      switch (event.cron) {
        case '0 2 * * *':
          await runIngestion(env)
          break
        case '0 */6 * * *':
          await runEnrichment(env)
          break
        case '0 */12 * * *':
          await runHealthScores(env)
          break
        default:
          console.warn(`[cron] unrecognized schedule: ${event.cron}`)
      }
    } catch (err) {
      // Fail-safe: a broken scheduled task never aborts the drain below.
      console.error(`[cron] scheduled task error for ${event.cron}`, err)
    }

    // The $0 queue: always drain pending jobs regardless of which cron fired.
    await drainJobs(env)
  })()

  ctx.waitUntil(task)
}
