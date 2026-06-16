/**
 * MLScoringStrategy — domain wiring for the {@link MLScoringModel}.
 *
 * Responsibilities:
 *  - Map the prospect signals the ScoringService already fetches (filing
 *    recency/counts, review sentiment, violations, time-since-default) into a
 *    numeric feature vector.
 *  - Provide a reproducible, clearly-SYNTHETIC labeled dataset to seed the model
 *    (generated from a deterministic PRNG + a latent heuristic + noise).
 *  - Produce an ML score with HONEST metadata: low confidence and an explicit
 *    warning that the model is trained on synthetic seed data and must be
 *    validated against real repayment/closed-deal outcomes before it can be
 *    relied upon. The rules-based composite score remains the product default.
 *
 * @module server/services/MLScoringStrategy
 */

import fs from 'fs'
import path from 'path'
import { MLScoringModel, type ModelWeights, type TrainingExample } from './MLScoringModel'

/**
 * The raw prospect signals available at scoring time (a subset of what
 * ScoringService.scoreProspect already computes from the database).
 */
export interface MlProspectInput {
  daysSinceLastFiling: number
  totalFilings: number
  activeFilings: number
  lapsedFilings: number
  terminatedFilings: number
  timeSinceDefault: number
  reviewCount: number
  /** Average sentiment on a 0..1 scale (as stored in health_scores). */
  avgSentiment: number
  violationCount: number
  /** Latest rules-based health score (0..100), if available. */
  healthScore: number
}

export interface MlScoreOutput {
  /** Raw model probability in [0, 1]. */
  probability: number
  /** Probability scaled to a 0..100 score for display. */
  score: number
  /**
   * Confidence in this ML score, intentionally LOW: the model is trained on
   * synthetic seed data, not validated outcomes.
   */
  confidence: number
  modelVersion: string
  /** Explicit, user-facing honesty disclosure. */
  warning: string
}

// Resolve from the process working directory (the repo root for every way this
// codebase is run: npm scripts, tsx, vitest, and `node dist/server.cjs`). This
// avoids __dirname/import.meta differences between the CJS server bundle and the
// ESM tooling. If the artifact is absent the strategy retrains deterministically
// in-memory, so a mis-resolved path degrades gracefully rather than breaking.
const WEIGHTS_PATH = path.resolve(process.cwd(), 'server', 'models', 'ml-scoring-weights.json')
const SYNTHETIC_SEED = 0x9e3779b9
const ML_WARNING =
  'Experimental ML score: trained on synthetic seed data, NOT validated against ' +
  'real repayment/closed-deal outcomes. Use only alongside the rules-based score; ' +
  'do not make underwriting decisions on it until validated on labeled history.'

/** Deterministic PRNG (mulberry32) so the synthetic dataset is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export class MLScoringStrategy {
  private readonly model: MLScoringModel
  private prepared = false

  constructor(model: MLScoringModel = new MLScoringModel()) {
    this.model = model
  }

  /**
   * Derive the numeric feature vector from raw prospect signals. Engineered
   * features mirror the heuristics the rules engine uses but are left for the
   * model to weight.
   */
  extractFeatures(input: MlProspectInput): Record<string, number> {
    const totalFilings = Math.max(input.totalFilings, 0)
    const filingBurden = totalFilings > 0 ? input.activeFilings / totalFilings : 0
    const terminatedRatio = totalFilings > 0 ? input.terminatedFilings / totalFilings : 0
    const lapsedRatio = totalFilings > 0 ? input.lapsedFilings / totalFilings : 0
    const recency = clamp(1 - input.daysSinceLastFiling / 365, 0, 1)
    // Recovery sweet spot: ~3 months to ~3 years past default.
    const recoveryWindow = clamp((input.timeSinceDefault - 90) / (1095 - 90), 0, 1)

    return {
      recency,
      logFilings: Math.log1p(totalFilings),
      filingBurden,
      terminatedRatio,
      lapsedRatio,
      recoveryWindow,
      logReviews: Math.log1p(Math.max(input.reviewCount, 0)),
      sentiment: clamp(input.avgSentiment, 0, 1),
      violations: clamp(input.violationCount, 0, 10) / 10,
      healthNorm: clamp(input.healthScore, 0, 100) / 100
    }
  }

  /**
   * Build a reproducible, clearly-SYNTHETIC labeled dataset. Each example is a
   * randomly-drawn (seeded) prospect profile; the label is a latent linear rule
   * over the features plus noise, then thresholded. This is a stand-in for real
   * outcome labels (repaid vs. defaulted) and is NOT representative of the live
   * market — it only lets the model learn coherent, inspectable weights.
   */
  generateSyntheticTrainingData(count = 240): TrainingExample[] {
    const rand = mulberry32(SYNTHETIC_SEED)

    // Latent "strong prospect" score (synthetic ground truth) over the features.
    const latentOf = (f: Record<string, number>): number =>
      1.4 * f.recency +
      1.1 * f.recoveryWindow +
      0.9 * f.terminatedRatio +
      0.8 * f.sentiment +
      0.5 * f.healthNorm +
      0.4 * f.logReviews -
      1.3 * f.filingBurden -
      1.0 * f.violations

    // Pass 1: draw feature vectors + their (noise-free) latent score.
    const drawn: Array<{ features: Record<string, number>; latent: number }> = []
    for (let i = 0; i < count; i++) {
      const totalFilings = Math.floor(rand() * 8)
      const activeFilings = Math.floor(rand() * (totalFilings + 1))
      const terminatedFilings = Math.floor(rand() * (totalFilings - activeFilings + 1))
      const lapsedFilings = Math.max(0, totalFilings - activeFilings - terminatedFilings)
      const features = this.extractFeatures({
        daysSinceLastFiling: Math.floor(rand() * 1200),
        totalFilings,
        activeFilings,
        lapsedFilings,
        terminatedFilings,
        timeSinceDefault: Math.floor(rand() * 1400),
        reviewCount: Math.floor(rand() * 60),
        avgSentiment: rand(),
        violationCount: Math.floor(rand() * 6),
        healthScore: Math.floor(rand() * 100)
      })
      drawn.push({ features, latent: latentOf(features) })
    }

    // Center the decision boundary at the median latent so the two classes are
    // balanced regardless of the feature distribution; deterministic noise then
    // adds realistic overlap (so the data is not trivially separable).
    const sortedLatents = drawn.map((d) => d.latent).sort((a, b) => a - b)
    const mid = Math.floor(sortedLatents.length / 2)
    const median =
      sortedLatents.length % 2 === 0
        ? (sortedLatents[mid - 1] + sortedLatents[mid]) / 2
        : sortedLatents[mid]

    return drawn.map((d) => {
      const noise = (rand() - 0.5) * 0.5
      return { features: d.features, label: d.latent - median + noise >= 0 ? 1 : 0 }
    })
  }

  /**
   * Ensure the model has weights: prefer the committed artifact, otherwise train
   * deterministically on the synthetic seed data (same result the training
   * script produces). Memoized.
   */
  ensureModel(): void {
    if (this.prepared && this.model.isReady()) return

    const loaded = this.tryLoadWeights()
    if (loaded) {
      this.model.loadWeights(loaded)
    } else {
      this.model.train(this.generateSyntheticTrainingData(), { epochs: 400, learningRate: 0.05 })
    }
    this.prepared = true
  }

  private tryLoadWeights(): ModelWeights | null {
    try {
      if (fs.existsSync(WEIGHTS_PATH)) {
        const raw = fs.readFileSync(WEIGHTS_PATH, 'utf8')
        const parsed = JSON.parse(raw) as ModelWeights
        if (parsed && parsed.weights && parsed.normalizers) return parsed
      }
    } catch {
      // Fall back to deterministic in-memory training.
    }
    return null
  }

  /**
   * Score a prospect with the ML model. Always returns honest, low-confidence
   * metadata and a warning; the rules-based score remains the product default.
   */
  score(input: MlProspectInput): MlScoreOutput {
    this.ensureModel()
    const probability = this.model.predict(this.extractFeatures(input))
    const version = this.model.isReady() ? this.model.exportWeights().modelVersion : '0.0.0'
    return {
      probability,
      score: Math.round(probability * 100),
      confidence: 0.3,
      modelVersion: version,
      warning: ML_WARNING
    }
  }
}

export const mlScoringStrategy = new MLScoringStrategy()
export { ML_WARNING, WEIGHTS_PATH }
