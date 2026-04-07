/**
 * Scoring engine: weighted global score, confidence adjustment, level mapping, variance.
 * Spec §8, §9, §10, §12.
 */

import type { DimensionResult, MaturityReport, EngineWeights } from './types';
import { DEFAULT_WEIGHTS, VARIANCE_THRESHOLD_TAU } from './constants';

export function weightedScore(
  results: DimensionResult[],
  weights: EngineWeights = DEFAULT_WEIGHTS
): number {
  let total = 0;
  const wMap = weights as unknown as Record<string, number>;
  for (const r of results) {
    const w = wMap[r.dimension];
    if (w != null) total += w * r.rawScore;
  }
  return Math.round(total * 100) / 100;
}

export function varianceOfDimensionScores(results: DimensionResult[]): number {
  const scores = results.map((r) => r.rawScore);
  if (scores.length === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return scores.reduce((acc, x) => acc + (x - mean) ** 2, 0) / scores.length;
}

export function overallConfidence(results: DimensionResult[]): number {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + r.confidence, 0);
  return Math.round((sum / results.length) * 100) / 100;
}

/** Optional: confidence-adjusted dimension score S'_d = S_d * Conf_d */
export function confidenceAdjustedScores(results: DimensionResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) {
    out[r.dimension] = Math.round(r.rawScore * r.confidence * 100) / 100;
  }
  return out;
}

/** Spec §12: map overall score to level 0–5 */
export function scoreToLevel(score: number): number {
  if (score < 20) return 0;
  if (score < 40) return 1;
  if (score < 60) return 2;
  if (score < 75) return 3;
  if (score < 90) return 4;
  return 5;
}

/** Spec §10: variance stability flag */
export function varianceFlag(variance: number): MaturityReport['varianceFlag'] | undefined {
  if (variance > VARIANCE_THRESHOLD_TAU) return 'structurally_unstable';
  return undefined;
}

export function buildRecommendations(
  results: DimensionResult[],
  level: number
): string[] {
  const recs: string[] = [];
  for (const r of results) {
    if (r.rawScore < 50) {
      recs.push(`Improve ${r.dimension}: current score ${r.rawScore.toFixed(0)}/100.`);
    }
    if (r.issues.length > 0) {
      r.issues.slice(0, 2).forEach((i) => recs.push(`[${r.dimension}] ${i.message}`));
    }
  }
  if (level <= 2) {
    recs.push('Overall maturity is low; prioritize description coverage and token adoption.');
  }
  return recs;
}
