/**
 * Design System Context Maturity Engine — Public API.
 * Stateless pipeline: RawInput → MaturityReport.
 * Spec: Logical Analysis Architecture & Scoring Specification.
 */

import type { RawInput } from './raw-input';
import type { MaturityReport, EngineWeights } from './types';
import { normalize } from './normalization';
import { extractAllFeatures } from './features';
import { runAllDimensions } from './dimensions';
import {
  weightedScore,
  varianceOfDimensionScores,
  overallConfidence,
  scoreToLevel,
  varianceFlag,
  buildRecommendations,
} from './scoring';
import { DEFAULT_WEIGHTS } from './constants';

export type { RawInput, MaturityReport, EngineWeights };
export { DEFAULT_WEIGHTS };
export { normalize, extractAllFeatures };
export { runAllDimensions } from './dimensions';
export * from './scoring';
export * from './types';
export { rawInputFromAudits } from './from-audits';

export interface PipelineOptions {
  weights?: EngineWeights;
}

/**
 * Run the full pipeline: ingestion → normalize → features → dimensions → scoring → report.
 * Deterministic and stateless.
 */
export function runPipeline(raw: RawInput, options: PipelineOptions = {}): MaturityReport {
  const weights = options.weights ?? DEFAULT_WEIGHTS;

  const model = normalize(raw);
  const features = extractAllFeatures(model);
  const dimensionResults = runAllDimensions(model, features);

  const overallScore = Math.min(100, Math.max(0, weightedScore(dimensionResults, weights)));
  const variance = varianceOfDimensionScores(dimensionResults);
  const overallConf = overallConfidence(dimensionResults);
  const level = scoreToLevel(overallScore);
  const varianceFlagResult = varianceFlag(variance);

  const dimensionScores: Record<string, number> = {};
  const dimensionConfidence: Record<string, number> = {};
  const allIssues: MaturityReport['issues'] = [];
  for (const r of dimensionResults) {
    dimensionScores[r.dimension] = r.rawScore;
    dimensionConfidence[r.dimension] = r.confidence;
    allIssues.push(...r.issues);
  }

  const recommendations = buildRecommendations(dimensionResults, level);

  return {
    overallScore,
    level,
    overallConfidence: overallConf,
    dimensionScores,
    dimensionConfidence,
    variance,
    varianceFlag: varianceFlagResult,
    issues: allIssues,
    recommendations,
  };
}
