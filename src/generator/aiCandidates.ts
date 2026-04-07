import type { UsageProfile } from '../usage-types';

/**
 * Determines whether a variable should be flagged for AI-enhanced description
 * instead of relying solely on rule-based generation.
 */
export function shouldUseAI(profile: UsageProfile): boolean {
  // Never use AI for these — rule-based is definitive
  if (profile.position === 'unused') return false;
  if (profile.position === 'primitive') return false;
  if (profile.position === 'brand-override') return false;

  // Mixed node types with no dominant usage (< 70% concentration)
  const nodeTypes = Object.keys(profile.byNodeType);
  if (nodeTypes.length > 1 && profile.totalBindings > 0) {
    const top = Math.max(...Object.values(profile.byNodeType));
    if (top / profile.totalBindings < 0.7) return true;
  }

  // Semantic variable with very few bindings (important but underused — AI adds value)
  if (profile.position === 'semantic' && profile.totalBindings < 3) return true;

  // Multiple different properties (e.g. fills + strokes on same variable — unusual)
  const properties = Object.keys(profile.byProperty);
  if (properties.length > 2) return true;

  return false;
}
