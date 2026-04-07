import type { VariableRecord, UsageProfile } from '../usage-types';

// Maps Figma node types to readable labels
const NODE_LABELS: Record<string, string> = {
  FRAME: 'layout containers and surfaces',
  TEXT: 'text elements',
  RECTANGLE: 'shapes and decorative elements',
  INSTANCE: 'component instances',
  VECTOR: 'icons and vector shapes',
  ELLIPSE: 'circular shapes',
  COMPONENT: 'component definitions',
  SECTION: 'canvas sections',
};

// Maps boundVariable property keys to readable labels
const PROPERTY_LABELS: Record<string, string> = {
  fills: 'fill color',
  strokes: 'stroke / border color',
  cornerRadius: 'corner radius',
  topLeftRadius: 'corner radius',
  topRightRadius: 'corner radius',
  bottomLeftRadius: 'corner radius',
  bottomRightRadius: 'corner radius',
  paddingLeft: 'horizontal padding',
  paddingRight: 'horizontal padding',
  paddingTop: 'vertical padding',
  paddingBottom: 'vertical padding',
  itemSpacing: 'gap between items',
  counterAxisSpacing: 'gap between items',
  fontSize: 'font size',
  fontWeight: 'font weight',
  lineHeight: 'line height',
  letterSpacing: 'letter spacing',
  paragraphSpacing: 'paragraph spacing',
  fontFamily: 'font family',
  opacity: 'opacity',
  effects: 'shadow / blur effect',
};

export interface RuleResult {
  description: string;
  confidence: number;
}

export function generateRuleBasedDescription(
  variable: VariableRecord,
  profile: UsageProfile,
  collectionNotes?: Record<string, string>
): RuleResult {
  const parts: string[] = [];

  // 1. Unused signal — definitive
  if (profile.position === 'unused') {
    return {
      description: 'Currently unused — not bound to any node and not referenced by other tokens.',
      confidence: 0.9,
    };
  }

  // 2. Position signal
  if (profile.position === 'primitive') {
    parts.push('Primitive value — not intended for direct use in components.');
  } else if (profile.position === 'brand-override') {
    parts.push('Brand-specific override.');
  }

  // 3. Primary usage from bindings
  if (profile.totalBindings > 0) {
    const topNodeType = topEntry(profile.byNodeType);
    const topProperty = topEntry(profile.byProperty);
    const nodeLabel = NODE_LABELS[topNodeType] || topNodeType.toLowerCase();
    const propLabel = PROPERTY_LABELS[topProperty] || topProperty;

    parts.push(
      `Applied as ${propLabel} on ${nodeLabel} (${profile.totalBindings} binding${profile.totalBindings !== 1 ? 's' : ''}).`
    );
  }

  // 4. DS vs UI context
  if (profile.dsCount > 0 && profile.uiCount > 0) {
    parts.push(
      `Used in both DS component definitions (${profile.dsCount}) and UI screens (${profile.uiCount}).`
    );
  } else if (profile.dsCount > 0) {
    parts.push(`Used exclusively inside component definitions (${profile.dsCount} bindings).`);
  } else if (profile.uiCount > 0) {
    parts.push(
      `Applied directly in UI screens across ${profile.pages.length} page${profile.pages.length !== 1 ? 's' : ''}.`
    );
  }

  // 5. Alias chain context
  if (profile.aliasedFrom.length > 0) {
    const shown = profile.aliasedFrom.slice(0, 2).join(', ');
    const extra = profile.aliasedFrom.length > 2 ? ` +${profile.aliasedFrom.length - 2} more` : '';
    parts.push(`Referenced by: ${shown}${extra}.`);
  }
  if (profile.aliasesTo.length > 0) {
    parts.push(`Resolves to: ${profile.aliasesTo[0]}.`);
  }

  // 6. Collection-level notes from user context
  if (collectionNotes?.[variable.variableCollectionId]) {
    parts.push(collectionNotes[variable.variableCollectionId]);
  }

  const description = parts.join(' ').trim() || 'No usage data available.';
  const confidence = profile.totalBindings > 5 ? 0.85 : profile.totalBindings > 0 ? 0.7 : 0.5;

  return { description, confidence };
}

function topEntry(record: Record<string, number>): string {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? '';
}
