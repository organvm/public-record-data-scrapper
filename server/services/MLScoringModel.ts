/**
 * MLScoringModel — a small, dependency-free, genuinely-trainable logistic
 * regression model.
 *
 * This is a real machine-learning model: it fits weights to labeled examples via
 * batch gradient descent on the binary cross-entropy loss, normalizes features
 * with stored mean/std statistics, and serializes the learned parameters to JSON
 * for inference. It is intentionally interpretable (one weight per feature) and
 * has no heavy dependencies so it runs anywhere the server runs.
 *
 * It does NOT, by itself, make the product's scoring "ML-validated": the value of
 * any model is in its training data. See {@link MLScoringStrategy}, which trains
 * this model on clearly-SYNTHETIC seed data and labels the output accordingly.
 *
 * @module server/services/MLScoringModel
 */

export interface FeatureStats {
  mean: number
  std: number
}

export interface ModelWeights {
  /** Bias term. */
  intercept: number
  /** Learned weight per feature name. */
  weights: Record<string, number>
  /** Per-feature normalization statistics captured at training time. */
  normalizers: Record<string, FeatureStats>
  /** Stable feature ordering (documentation / reproducibility). */
  featureOrder: string[]
  /** ISO timestamp the model was trained. */
  trainedAt: string
  /** Semantic version of the weights artifact. */
  modelVersion: string
}

export interface TrainingExample {
  features: Record<string, number>
  /** Target label in [0, 1]; for classification use 0 or 1. */
  label: number
  /** Optional per-sample weight for class imbalance. */
  sampleWeight?: number
}

export interface TrainingOptions {
  learningRate?: number
  epochs?: number
  /** L2 regularization strength (ridge). */
  l2?: number
}

export interface TrainingMetrics {
  finalLoss: number
  epochs: number
  learningRate: number
  samples: number
  /** Training-set accuracy at a 0.5 threshold (overfitting smoke-check). */
  trainAccuracy: number
}

const MIN_STD = 1e-6

export class MLScoringModel {
  private weights: ModelWeights | null = null

  /** Numerically-stable logistic sigmoid. */
  static sigmoid(z: number): number {
    if (z >= 0) {
      const e = Math.exp(-z)
      return 1 / (1 + e)
    }
    const e = Math.exp(z)
    return e / (1 + e)
  }

  /** Whether the model has trained or loaded weights. */
  isReady(): boolean {
    return this.weights !== null
  }

  private computeNormalizers(rows: Record<string, number>[]): {
    normalizers: Record<string, FeatureStats>
    featureOrder: string[]
  } {
    const featureOrder = Array.from(
      rows.reduce<Set<string>>((set, row) => {
        Object.keys(row).forEach((k) => set.add(k))
        return set
      }, new Set<string>())
    ).sort()

    const normalizers: Record<string, FeatureStats> = {}
    for (const key of featureOrder) {
      const values = rows.map((r) => r[key] ?? 0)
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance =
        values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / Math.max(values.length, 1)
      normalizers[key] = { mean, std: Math.max(Math.sqrt(variance), MIN_STD) }
    }
    return { normalizers, featureOrder }
  }

  private normalize(
    features: Record<string, number>,
    normalizers: Record<string, FeatureStats>
  ): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [key, norm] of Object.entries(normalizers)) {
      const raw = features[key] ?? 0
      out[key] = (raw - norm.mean) / norm.std
    }
    return out
  }

  /**
   * Fit the model to labeled examples via batch gradient descent.
   */
  train(examples: TrainingExample[], options: TrainingOptions = {}): TrainingMetrics {
    if (examples.length === 0) {
      throw new Error('MLScoringModel.train: no training examples provided')
    }
    const learningRate = options.learningRate ?? 0.05
    const epochs = options.epochs ?? 400
    const l2 = options.l2 ?? 0.001

    const { normalizers, featureOrder } = this.computeNormalizers(examples.map((e) => e.features))
    const weights: Record<string, number> = {}
    for (const key of featureOrder) weights[key] = 0
    let intercept = 0

    const normalizedRows = examples.map((e) => ({
      x: this.normalize(e.features, normalizers),
      y: e.label,
      w: e.sampleWeight ?? 1
    }))

    let finalLoss = 0
    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradW: Record<string, number> = {}
      for (const key of featureOrder) gradW[key] = 0
      let gradB = 0
      let loss = 0
      let weightSum = 0

      for (const row of normalizedRows) {
        let z = intercept
        for (const key of featureOrder) z += weights[key] * (row.x[key] ?? 0)
        const pred = MLScoringModel.sigmoid(z)
        const error = pred - row.y

        loss +=
          row.w *
          -(
            row.y * Math.log(Math.max(pred, 1e-12)) +
            (1 - row.y) * Math.log(Math.max(1 - pred, 1e-12))
          )
        weightSum += row.w

        gradB += row.w * error
        for (const key of featureOrder) gradW[key] += row.w * error * (row.x[key] ?? 0)
      }

      const denom = Math.max(weightSum, 1)
      intercept -= learningRate * (gradB / denom)
      for (const key of featureOrder) {
        // Gradient + L2 shrinkage (bias is not regularized).
        weights[key] -= learningRate * (gradW[key] / denom + l2 * weights[key])
      }
      finalLoss = loss / denom
    }

    this.weights = {
      intercept,
      weights,
      normalizers,
      featureOrder,
      trainedAt: new Date().toISOString(),
      modelVersion: '1.0.0'
    }

    // Training-set accuracy as an overfitting smoke-check.
    let correct = 0
    for (const e of examples) {
      const p = this.predict(e.features)
      if ((p >= 0.5 ? 1 : 0) === (e.label >= 0.5 ? 1 : 0)) correct++
    }

    return {
      finalLoss,
      epochs,
      learningRate,
      samples: examples.length,
      trainAccuracy: correct / examples.length
    }
  }

  /**
   * Predict the probability (0..1) for a feature vector.
   * @throws if the model has no weights (train or load first).
   */
  predict(features: Record<string, number>): number {
    if (!this.weights) {
      throw new Error('MLScoringModel.predict: model has no weights (train or loadWeights first)')
    }
    const normalized = this.normalize(features, this.weights.normalizers)
    let z = this.weights.intercept
    for (const [key, weight] of Object.entries(this.weights.weights)) {
      z += weight * (normalized[key] ?? 0)
    }
    return MLScoringModel.sigmoid(z)
  }

  loadWeights(weights: ModelWeights): void {
    this.weights = weights
  }

  exportWeights(): ModelWeights {
    if (!this.weights) {
      throw new Error('MLScoringModel.exportWeights: model has no weights')
    }
    return JSON.parse(JSON.stringify(this.weights)) as ModelWeights
  }
}
