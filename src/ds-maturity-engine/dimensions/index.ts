/**
 * Dimension analysis modules — spec §6, §7.
 * Each returns DimensionResult (dimension, rawScore 0–100, confidence, issues, evidence).
 */

import type { CanonicalModel, DimensionResult, FeatureVector } from '../types';
import {
  L_IDEAL_DESCRIPTION,
  SIGMA_MAX_DEPTH,
  COMPLETENESS_WEIGHTS,
  NAMING_WEIGHTS,
  VARIANT_PENALTY_WEIGHTS,
  STRUCTURAL_WEIGHTS,
  MAX_IDEAL_VARIANT_AXES,
} from '../constants';

// ── Helpers ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

// ── 7.1 Completeness ───────────────────────────────────────────────────────

export function completeness(
  model: CanonicalModel,
  features: Map<string, FeatureVector>
): DimensionResult {
  const n = model.components.length;
  if (n === 0) {
    return { dimension: 'completeness', rawScore: 0, confidence: 0, issues: [], evidence: [] };
  }

  let descCoverage = 0;
  let variantCoverage = 0;
  let tokenCoverage = 0;
  let guidelineCoverage = 0;
  for (const c of model.components) {
    const f = features.get(c.id);
    if (!f) continue;
    descCoverage += f.hasDescription ? 1 : 0;
    descCoverage += f.descriptionLength >= 20 ? 0.5 : 0;
    variantCoverage += f.variantAxesCount >= 0 ? 1 : 0; // present
    tokenCoverage += f.totalStylableProperties > 0 ? f.tokenUsageRatio : 1;
    guidelineCoverage += f.guidelinePresence;
  }
  const p_d = descCoverage / (n * 1.5); // normalize
  const p_v = Math.min(1, variantCoverage / n);
  const p_t = tokenCoverage / n;
  const p_g = guidelineCoverage / n;

  const rawScore = 100 * (
    COMPLETENESS_WEIGHTS.description * Math.min(1, p_d) +
    COMPLETENESS_WEIGHTS.variant * p_v +
    COMPLETENESS_WEIGHTS.token * p_t +
    COMPLETENESS_WEIGHTS.guideline * Math.min(1, p_g)
  );
  const confidence = n >= 3 ? 0.9 : n >= 1 ? 0.6 : 0.3;
  return {
    dimension: 'completeness',
    rawScore: Math.round(rawScore * 100) / 100,
    confidence,
    issues: [],
    evidence: [`p_d=${(p_d * 100).toFixed(0)}%`, `p_t=${(p_t * 100).toFixed(0)}%`],
  };
}

// ── 7.2 Naming consistency ─────────────────────────────────────────────────

export function naming(
  model: CanonicalModel,
  features: Map<string, FeatureVector>
): DimensionResult {
  const n = model.components.length;
  if (n === 0) {
    return { dimension: 'naming', rawScore: 0, confidence: 0, issues: [], evidence: [] };
  }

  const depths = model.components.map((c) => {
    const f = features.get(c.id);
    return f ? f.namingDepth : 1;
  });
  const sigmaDepth = stdDev(depths);
  const sigmaNorm = Math.min(1, sigmaDepth / SIGMA_MAX_DEPTH);
  const rRegex = 0.8; // Placeholder: conformity to naming regex
  const dDup = 0;     // Placeholder: duplicate name ratio

  const rawScore = 100 * (
    NAMING_WEIGHTS.regex * rRegex +
    NAMING_WEIGHTS.depthConsistency * (1 - sigmaNorm) +
    NAMING_WEIGHTS.noDuplicate * (1 - dDup)
  );
  return {
    dimension: 'naming',
    rawScore: Math.round(rawScore * 100) / 100,
    confidence: n >= 3 ? 0.85 : 0.5,
    issues: [],
    evidence: [`σ_depth=${sigmaDepth.toFixed(2)}`, `σ_norm=${sigmaNorm.toFixed(2)}`],
  };
}

// ── 7.3 Semantic density ───────────────────────────────────────────────────

export function semanticDensity(
  model: CanonicalModel,
  features: Map<string, FeatureVector>
): DimensionResult {
  const n = model.components.length;
  if (n === 0) {
    return { dimension: 'semantic', rawScore: 0, confidence: 0, issues: [], evidence: [] };
  }

  const densities: number[] = [];
  for (const c of model.components) {
    const f = features.get(c.id);
    if (!f) continue;
    const density = Math.min(1, f.descriptionLength / L_IDEAL_DESCRIPTION);
    densities.push(density);
  }
  const meanDensity = mean(densities);
  const coverageRatio = densities.length / n;
  const rawScore = 100 * meanDensity * coverageRatio;
  return {
    dimension: 'semantic',
    rawScore: Math.round(rawScore * 100) / 100,
    confidence: n >= 3 ? 0.8 : 0.5,
    issues: [],
    evidence: [`mean_density=${meanDensity.toFixed(2)}`, `coverage=${(coverageRatio * 100).toFixed(0)}%`],
  };
}

// ── 7.4 Variant architecture ────────────────────────────────────────────────

export function variantArchitecture(
  model: CanonicalModel,
  features: Map<string, FeatureVector>
): DimensionResult {
  const n = model.components.length;
  if (n === 0) {
    return { dimension: 'variant', rawScore: 0, confidence: 0, issues: [], evidence: [] };
  }

  const w1 = VARIANT_PENALTY_WEIGHTS.excessAxes;
  const w2 = VARIANT_PENALTY_WEIGHTS.explosion;
  const w3 = VARIANT_PENALTY_WEIGHTS.redundancy;

  const scores: number[] = [];
  for (const c of model.components) {
    const f = features.get(c.id);
    if (!f) continue;
    const excessAxes = Math.max(0, f.variantAxesCount - MAX_IDEAL_VARIANT_AXES) / Math.max(1, f.variantAxesCount);
    const explosion = Math.min(1, f.explosionFactor);
    const redundancy = f.redundancyRatio;
    const penalty = w1 * excessAxes + w2 * explosion + w3 * redundancy;
    const v = Math.max(0, 1 - penalty);
    scores.push(v);
  }
  const rawScore = 100 * mean(scores);
  return {
    dimension: 'variant',
    rawScore: Math.round(rawScore * 100) / 100,
    confidence: n >= 3 ? 0.75 : 0.5,
    issues: [],
    evidence: [`mean_v=${mean(scores).toFixed(2)}`],
  };
}

// ── 7.5 Token adoption ──────────────────────────────────────────────────────

export function tokenAdoption(
  model: CanonicalModel,
  features: Map<string, FeatureVector>
): DimensionResult {
  const n = model.components.length;
  if (n === 0) {
    return { dimension: 'token', rawScore: 0, confidence: 0, issues: [], evidence: [] };
  }

  const ratios: number[] = [];
  let totalHardcoded = 0;
  let totalStylable = 0;
  for (const c of model.components) {
    const f = features.get(c.id);
    if (!f) continue;
    if (f.totalStylableProperties > 0) {
      ratios.push(f.tokenUsageRatio);
      totalHardcoded += f.hardcodedPropertyCount;
      totalStylable += f.totalStylableProperties;
    }
  }
  const meanRatio = ratios.length > 0 ? mean(ratios) : 0;
  const h = totalStylable > 0 ? totalHardcoded / totalStylable : 0;
  const rawScore = 100 * meanRatio * (1 - h);
  return {
    dimension: 'token',
    rawScore: Math.round(rawScore * 100) / 100,
    confidence: n >= 3 ? 0.85 : 0.5,
    issues: [],
    evidence: [`token_ratio=${(meanRatio * 100).toFixed(0)}%`, `hardcoded_penalty=${(h * 100).toFixed(0)}%`],
  };
}

// ── 7.6 Structural graph ───────────────────────────────────────────────────

export function structuralGraph(model: CanonicalModel): DimensionResult {
  const n = model.components.length;
  if (n === 0) {
    return { dimension: 'structural', rawScore: 0, confidence: 0, issues: [], evidence: [] };
  }

  const hasParent = new Set<string>();
  const hasChild = new Set<string>();
  for (const r of model.relationships) {
    if (r.type === 'contains' || r.type === 'instanceOf') {
      hasParent.add(r.targetId);
      hasChild.add(r.sourceId);
    }
  }
  const componentIds = new Set(model.components.map((c) => c.id));
  let orphans = 0;
  for (const id of componentIds) {
    if (!hasParent.has(id) && !hasChild.has(id)) orphans++;
  }
  const OR = componentIds.size > 0 ? orphans / componentIds.size : 0;
  const CR = 0; // Placeholder: cycle ratio (would need cycle detection)
  const CI = 0.5; // Placeholder: centralization index 0–1

  const rawScore = 100 * (
    STRUCTURAL_WEIGHTS.noOrphan * (1 - OR) +
    STRUCTURAL_WEIGHTS.noCycle * (1 - CR) +
    STRUCTURAL_WEIGHTS.centralization * CI
  );
  return {
    dimension: 'structural',
    rawScore: Math.round(rawScore * 100) / 100,
    confidence: n >= 3 ? 0.7 : 0.4,
    issues: [],
    evidence: [`OR=${(OR * 100).toFixed(0)}%`],
  };
}

// ── Run all dimensions ──────────────────────────────────────────────────────

export function runAllDimensions(
  model: CanonicalModel,
  features: Map<string, FeatureVector>
): DimensionResult[] {
  return [
    completeness(model, features),
    naming(model, features),
    semanticDensity(model, features),
    variantArchitecture(model, features),
    tokenAdoption(model, features),
    structuralGraph(model),
  ];
}
