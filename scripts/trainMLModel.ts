/**
 * Train and persist the ML scoring model.
 *
 *   npm run train:ml-model
 *
 * IMPORTANT / HONEST DISCLOSURE:
 * This trains on CLEARLY-SYNTHETIC seed data (a deterministic, generated dataset
 * — see MLScoringStrategy.generateSyntheticTrainingData). The resulting weights
 * are inspectable and reproducible, but the model is NOT validated against real
 * repayment/closed-deal outcomes. Do not use the ML score for underwriting
 * decisions until it has been retrained and evaluated on labeled history.
 *
 * The committed artifact (server/models/ml-scoring-weights.json) is what the
 * server loads at runtime; if it is absent the strategy retrains the same
 * deterministic dataset in-memory, so behavior is identical either way.
 */
import fs from 'fs'
import path from 'path'
import { MLScoringModel } from '../server/services/MLScoringModel'
import { MLScoringStrategy, WEIGHTS_PATH } from '../server/services/MLScoringStrategy'

function main(): void {
  const strategy = new MLScoringStrategy()
  const model = new MLScoringModel()

  const data = strategy.generateSyntheticTrainingData()
  console.log(
    `[train:ml] generated ${data.length} synthetic training examples (deterministic seed)`
  )

  const metrics = model.train(data, { epochs: 400, learningRate: 0.05 })
  console.log(
    `[train:ml] trained: loss=${metrics.finalLoss.toFixed(4)} ` +
      `trainAccuracy=${(metrics.trainAccuracy * 100).toFixed(1)}% ` +
      `epochs=${metrics.epochs} samples=${metrics.samples}`
  )

  if (metrics.trainAccuracy < 0.6) {
    console.warn('[train:ml] WARNING: low training accuracy — check hyperparameters/data')
  }

  const weights = model.exportWeights()
  const dir = path.dirname(WEIGHTS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(weights, null, 2) + '\n')
  console.log(`[train:ml] wrote weights → ${WEIGHTS_PATH}`)
  console.log(
    '[train:ml] NOTE: synthetic training data — validate against real outcomes before relying on ML scores.'
  )
}

main()
