import type { PatternEntry, DerivedRule, ExternalKnowledgeEntry } from './types';
import { uuidV4 } from './utils';

const CONFIDENCE_THRESHOLD = 0.3;
const MIN_OCCURRENCES = 3;
/** Applied on top of frequency-based confidence when a pattern matches external knowledge. */
const EXTERNAL_VALIDATION_BOOST = 0.15;

const COMMON_MEANINGS: Record<string, string> = {
  color: 'Color token',
  spacing: 'Spacing/layout token',
  radius: 'Border radius token',
  opacity: 'Opacity token',
  brand: 'Brand-specific value',
  sys: 'System/semantic level token',
  comp: 'Component-specific token',
  default: 'Default state',
  hover: 'Hover interaction state',
  focus: 'Focus interaction state',
  active: 'Active/pressed state',
  disabled: 'Disabled state',
  loading: 'Loading/async state',
  selected: 'Selected state',
  error: 'Error state',
  success: 'Success state',
  warning: 'Warning state',
  subtle: 'Low-emphasis variant',
  btn: 'Button component',
  input: 'Input component',
  icon: 'Icon component',
};

export class RuleDeriver {
  /**
   * Derives rules from accumulated patterns.
   * Pass externalKnowledge to boost confidence on industry-validated terms.
   */
  derive(
    patterns: PatternEntry[],
    externalKnowledge: ExternalKnowledgeEntry[] = []
  ): DerivedRule[] {
    const totalOccurrences = patterns.reduce((s, p) => s + p.occurrences, 0);

    // Build a set of all known states/tags from external knowledge for fast lookup
    const externalTerms = new Set<string>();
    for (const entry of externalKnowledge) {
      entry.knownStates.forEach(s => externalTerms.add(s.toLowerCase()));
      entry.tags.forEach(t => externalTerms.add(t.toLowerCase()));
    }

    const rules: DerivedRule[] = [];

    for (const pattern of patterns) {
      if (pattern.occurrences < MIN_OCCURRENCES) continue;
      const baseConfidence = totalOccurrences > 0
        ? pattern.occurrences / totalOccurrences
        : 0;
      if (baseConfidence < CONFIDENCE_THRESHOLD) continue;

      const externallyValidated = externalTerms.has(pattern.value.toLowerCase());
      const confidence = externallyValidated
        ? Math.min(1.0, baseConfidence + EXTERNAL_VALIDATION_BOOST)
        : baseConfidence;

      rules.push({
        id: uuidV4(),
        pattern: pattern.value,
        meaning: this.inferMeaning(pattern, externalKnowledge),
        position: pattern.type === 'structure' ? 'any' : pattern.type,
        scope: pattern.scope,
        confidence,
        externallyValidated,
        derivedAt: new Date().toISOString(),
        confirmedByUser: false,
      });
    }

    return rules;
  }

  private inferMeaning(
    pattern: PatternEntry,
    externalKnowledge: ExternalKnowledgeEntry[]
  ): string {
    const key = pattern.value.toLowerCase();

    // Try to find a richer meaning from external knowledge state lists
    for (const entry of externalKnowledge) {
      const match = entry.knownStates.find(s => s.toLowerCase() === key);
      if (match && entry.componentType) {
        return `${this.capitalize(match)} state (${entry.componentType})`;
      }
    }

    return COMMON_MEANINGS[key] ?? `Segment: "${pattern.value}"`;
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
