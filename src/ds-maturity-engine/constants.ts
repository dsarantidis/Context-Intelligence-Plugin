/**
 * Design System Context Maturity Engine — Constants (spec §7, §10).
 */

import type { EngineWeights } from './types';

/** Ideal description length for semantic density (spec §7.3) */
export const L_IDEAL_DESCRIPTION = 80;

/** Max naming depth std dev for normalization (spec §7.2) */
export const SIGMA_MAX_DEPTH = 2;

/** Variance threshold τ: above this, flag system as unstable (spec §10) */
export const VARIANCE_THRESHOLD_TAU = 400; // e.g. Var of 20²

/** Default dimension weights; must sum to 1 (spec §8) */
export const DEFAULT_WEIGHTS: EngineWeights = {
  completeness: 0.20,
  naming: 0.20,
  semantic: 0.15,
  variant: 0.15,
  token: 0.15,
  structural: 0.15,
};

/** Completeness sub-weights (spec §7.1): description, variant, token, guideline */
export const COMPLETENESS_WEIGHTS = {
  description: 0.35,
  variant: 0.25,
  token: 0.25,
  guideline: 0.15,
};

/** Naming sub-weights (spec §7.2) */
export const NAMING_WEIGHTS = {
  regex: 0.5,
  depthConsistency: 0.3,
  noDuplicate: 0.2,
};

/** Variant penalty weights (spec §7.4) */
export const VARIANT_PENALTY_WEIGHTS = {
  excessAxes: 0.4,
  explosion: 0.35,
  redundancy: 0.25,
};

/** Structural graph weights (spec §7.6): orphan, cycle, centralization */
export const STRUCTURAL_WEIGHTS = {
  noOrphan: 0.5,
  noCycle: 0.3,
  centralization: 0.2,
};

/** Max variant axes before excess penalty (spec §7.4) */
export const MAX_IDEAL_VARIANT_AXES = 4;
