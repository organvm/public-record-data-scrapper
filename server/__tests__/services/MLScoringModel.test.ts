/**
 * Tests for the trainable logistic-regression scoring model and its domain
 * strategy. These prove the model genuinely LEARNS (fits separable data),
 * persists/loads deterministically, and that the strategy is honestly labeled.
 */
import { describe, it, expect } from 'vitest'
import { MLScoringModel, type TrainingExample } from '../../services/MLScoringModel'
import {
  MLScoringStrategy,
  ML_WARNING,
  type MlProspectInput
} from '../../services/MLScoringStrategy'

describe('MLScoringModel', () => {
  it('sigmoid is bounded in [0, 1] and monotonic', () => {
    expect(MLScoringModel.sigmoid(0)).toBeCloseTo(0.5, 5)
    expect(MLScoringModel.sigmoid(-50)).toBeGreaterThanOrEqual(0)
    expect(MLScoringModel.sigmoid(-50)).toBeLessThan(0.01)
    expect(MLScoringModel.sigmoid(50)).toBeLessThanOrEqual(1)
    expect(MLScoringModel.sigmoid(50)).toBeGreaterThan(0.99)
    expect(MLScoringModel.sigmoid(2)).toBeGreaterThan(MLScoringModel.sigmoid(1))
  })

  it('throws when predicting before training', () => {
    const model = new MLScoringModel()
    expect(model.isReady()).toBe(false)
    expect(() => model.predict({ a: 1 })).toThrow(/no weights/i)
  })

  it('learns a linearly separable pattern (high train accuracy)', () => {
    // Label depends on whether x1 > x2; build a clean separable set.
    const examples: TrainingExample[] = []
    for (let i = 0; i < 80; i++) {
      const x1 = (i % 8) / 8
      const x2 = ((i * 3) % 8) / 8
      examples.push({ features: { x1, x2 }, label: x1 > x2 ? 1 : 0 })
    }
    const model = new MLScoringModel()
    const metrics = model.train(examples, { epochs: 600, learningRate: 0.2 })

    expect(metrics.samples).toBe(80)
    expect(metrics.finalLoss).toBeLessThan(0.6)
    expect(metrics.trainAccuracy).toBeGreaterThan(0.75)
  })

  it('round-trips weights via export/load with identical predictions', () => {
    const examples: TrainingExample[] = [
      { features: { a: 0, b: 1 }, label: 0 },
      { features: { a: 1, b: 0 }, label: 1 },
      { features: { a: 0.2, b: 0.8 }, label: 0 },
      { features: { a: 0.9, b: 0.1 }, label: 1 }
    ]
    const model = new MLScoringModel()
    model.train(examples, { epochs: 200 })
    const probe = { a: 0.7, b: 0.3 }
    const before = model.predict(probe)

    const weights = model.exportWeights()
    const reloaded = new MLScoringModel()
    reloaded.loadWeights(weights)

    expect(reloaded.predict(probe)).toBeCloseTo(before, 10)
    expect(weights.modelVersion).toBe('1.0.0')
    expect(weights.featureOrder).toEqual(['a', 'b'])
  })
})

describe('MLScoringStrategy', () => {
  const strongProspect: MlProspectInput = {
    daysSinceLastFiling: 25,
    totalFilings: 2,
    activeFilings: 0,
    lapsedFilings: 0,
    terminatedFilings: 2,
    timeSinceDefault: 600,
    reviewCount: 40,
    avgSentiment: 0.85,
    violationCount: 0,
    healthScore: 88
  }
  const weakProspect: MlProspectInput = {
    daysSinceLastFiling: 1100,
    totalFilings: 7,
    activeFilings: 6,
    lapsedFilings: 1,
    terminatedFilings: 0,
    timeSinceDefault: 60,
    reviewCount: 2,
    avgSentiment: 0.2,
    violationCount: 4,
    healthScore: 25
  }

  it('extracts engineered features in [0,1]-ish ranges', () => {
    const strategy = new MLScoringStrategy()
    const f = strategy.extractFeatures(strongProspect)
    expect(f.recency).toBeGreaterThan(0.8)
    expect(f.terminatedRatio).toBe(1)
    expect(f.filingBurden).toBe(0)
    expect(f.violations).toBe(0)
    expect(f.sentiment).toBeCloseTo(0.85, 5)
  })

  it('generates a reproducible, reasonably-balanced synthetic dataset', () => {
    const a = new MLScoringStrategy().generateSyntheticTrainingData(120)
    const b = new MLScoringStrategy().generateSyntheticTrainingData(120)
    expect(a.length).toBe(120)
    // Deterministic seed → identical datasets across instances.
    expect(a[0]).toEqual(b[0])
    expect(a[119]).toEqual(b[119])
    const positives = a.filter((e) => e.label === 1).length
    // Not degenerate (both classes represented).
    expect(positives).toBeGreaterThan(20)
    expect(positives).toBeLessThan(100)
  })

  it('scores a strong prospect higher than a weak one, with honest metadata', () => {
    const strategy = new MLScoringStrategy()
    const strong = strategy.score(strongProspect)
    const weak = strategy.score(weakProspect)

    expect(strong.score).toBeGreaterThan(weak.score)
    expect(strong.probability).toBeGreaterThanOrEqual(0)
    expect(strong.probability).toBeLessThanOrEqual(1)
    expect(strong.score).toBeGreaterThanOrEqual(0)
    expect(strong.score).toBeLessThanOrEqual(100)

    // Honest labeling: low confidence + explicit warning, every time.
    expect(strong.confidence).toBe(0.3)
    expect(strong.warning).toBe(ML_WARNING)
    expect(strong.warning).toMatch(/synthetic seed data/i)
  })
})
