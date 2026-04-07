/**
 * Feature extraction layer: Component + CanonicalModel → FeatureVector.
 * Spec §5: structural, semantic, variant, token features.
 */

import type { CanonicalModel, Component, FeatureVector } from './types';

function getGraphDegree(componentId: string, model: CanonicalModel): number {
  let degree = 0;
  for (const r of model.relationships) {
    if (r.sourceId === componentId || r.targetId === componentId) degree++;
  }
  return degree;
}

export function extractFeatures(component: Component, model: CanonicalModel): FeatureVector {
  const namingDepth = component.namespace.length || 1;
  const childCount = component.children.length;
  const dependencyCount = component.tokenBindings.length + component.children.length;
  const graphDegree = getGraphDegree(component.id, model);

  const hasDescription = component.description != null && component.description.trim().length > 0 ? 1 : 0;
  const descriptionLength = component.description ? component.description.trim().length : 0;
  const guidelinePresence = 0 as 0 | 1; // Placeholder: set if we have guideline links

  const variantAxesCount = component.variantAxes.length;
  const variantCombinationsCount = component.variantCombinationsCount ?? 1;
  const idealCombinations = Math.min(
    variantAxesCount * 3,
    variantAxesCount === 0 ? 1 : Math.pow(3, variantAxesCount)
  );
  const explosionFactor = idealCombinations > 0
    ? Math.min(1, variantCombinationsCount / idealCombinations)
    : 0;
  const redundancyRatio = 0; // Placeholder: need semantic duplicate detection

  const totalStylable = component.totalStylableProperties ?? 0;
  const tokenBound = component.tokenBoundPropertiesCount ?? component.tokenBindings.length;
  const hardcoded = component.hardcodedPropertyCount ?? Math.max(0, totalStylable - tokenBound);
  const tokenUsageRatio = totalStylable > 0 ? tokenBound / totalStylable : 0;

  return {
    namingDepth,
    childCount,
    dependencyCount,
    graphDegree,
    hasDescription: hasDescription as 0 | 1,
    descriptionLength,
    guidelinePresence,
    variantAxesCount,
    variantCombinationsCount,
    redundancyRatio,
    explosionFactor,
    tokenBoundProperties: tokenBound,
    totalStylableProperties: totalStylable,
    hardcodedPropertyCount: hardcoded,
    tokenUsageRatio,
  };
}

export function extractAllFeatures(model: CanonicalModel): Map<string, FeatureVector> {
  const map = new Map<string, FeatureVector>();
  for (const c of model.components) {
    map.set(c.id, extractFeatures(c, model));
  }
  return map;
}
