/**
 * Token Maturity Scorer
 * Tasks 1–5: extractTokenSignals, buildReverseIndex, computeAlignmentSignals,
 *            detectGaps, scoreToken
 *
 * Pure domain module — no Figma globals, no UI code.
 * Consumed by code.ts via the RUN_MATURITY_ANALYSIS message handler.
 */

// ============================================================================
// Types
// ============================================================================

export interface TokenSignals {
  namingDepth: number;
  hasDescription: boolean;
  descriptionLength: number;
  scopeCount: number;
  hasSpecificScopes: boolean;
  modeCount: number;
  allModesPopulated: boolean;
  collectionTier: 'primitive' | 'semantic' | 'other';
  isAlias: boolean;
}

export interface UsageEntry {
  component: string;
  variantValues: Record<string, string>;
  slot: string;
  property: string;
}

export interface ReverseIndexEntry {
  usages: UsageEntry[];
  inferredStates: string[];
  inferredSlotTypes: string[];
  componentCount: number;
  hardcodedAlternatives: number;
}

export type ReverseIndex = Record<string, ReverseIndexEntry>;

export interface AlignmentSignals {
  descriptionUsageAlignment: number;
  scopeUsageAlignment: number;
  aiParseability: number;
}

export type GapSeverity = 'high' | 'medium' | 'low';

export interface Gap {
  type: string;
  severity: GapSeverity;
  message: string;
  suggestion: string;
}

export interface ScoringWeights {
  namingDepth: number;
  descriptionQuality: number;
  descriptionUsageAlignment: number;
  scopeUsageAlignment: number;
  aiParseability: number;
  modeCoverage: number;
  collectionTier: number;
}

export interface ScoreResult {
  variableId: string;
  variableName: string;
  collectionName: string;
  score: number;
  tier: 'good' | 'fair' | 'needs-work';
  gaps: Gap[];
  signals: TokenSignals;
  alignment: AlignmentSignals;
  dimensions: Record<string, number>;
}

// Minimal shape of a Figma Variable as seen in the plugin worker
export interface FigmaVariableShape {
  id: string;
  name: string;
  description?: string;
  scopes?: string[];
  valuesByMode?: Record<string, unknown>;
  variableCollectionId?: string;
  resolvedType?: string;
}

// Shape of the Component Libraries JSON produced by the sister scan plugin
export interface ComponentLibraryJSON {
  componentSets?: ComponentSetData[];
}

export interface ComponentSetData {
  name: string;
  variants?: VariantData[];
}

export interface VariantData {
  variantValues?: Record<string, string>;
  layerTree?: LayerNode[];
}

export interface LayerNode {
  name: string;
  fills?: FillData[];
  strokes?: StrokeData[];
  children?: LayerNode[];
}

export interface FillData {
  isTokenBound?: boolean;
  token?: { name: string };
  raw?: unknown;
}

export interface StrokeData {
  isTokenBound?: boolean;
  token?: { name: string };
}

// ============================================================================
// Task 1 — extractTokenSignals
// ============================================================================

export function extractTokenSignals(
  variable: FigmaVariableShape,
  collectionName: string
): TokenSignals {
  const namingDepth = (variable.name || '').split('/').length;

  const hasDescription = !!(variable.description && variable.description.trim().length > 0);
  const descriptionLength = hasDescription ? variable.description!.trim().length : 0;

  const scopes: string[] = variable.scopes || [];
  const scopeCount = scopes.length;
  const hasSpecificScopes = scopeCount > 0 && scopes.indexOf('ALL_SCOPES') === -1;

  const modeKeys = Object.keys(variable.valuesByMode || {});
  const modeCount = modeKeys.length;
  const allModesPopulated =
    modeKeys.length > 0 &&
    modeKeys.every(k => {
      const v = (variable.valuesByMode || {})[k];
      return v !== null && v !== undefined;
    });

  let collectionTier: 'primitive' | 'semantic' | 'other' = 'other';
  if (collectionName && collectionName.charAt(0) === '.') {
    collectionTier = 'primitive';
  } else if (collectionName && collectionName.indexOf('Semantic') !== -1) {
    collectionTier = 'semantic';
  }

  const firstModeVal = modeKeys.length ? (variable.valuesByMode || {})[modeKeys[0]] : null;
  const isAlias = !!(
    firstModeVal &&
    typeof firstModeVal === 'object' &&
    (firstModeVal as Record<string, unknown>).type === 'VARIABLE_ALIAS'
  );

  return {
    namingDepth,
    hasDescription,
    descriptionLength,
    scopeCount,
    hasSpecificScopes,
    modeCount,
    allModesPopulated,
    collectionTier,
    isAlias,
  };
}

// ============================================================================
// Task 2 — buildReverseIndex
// ============================================================================

export function buildReverseIndex(componentLibraryJSON: ComponentLibraryJSON): ReverseIndex {
  const index: ReverseIndex = {};

  function ensureEntry(tokenName: string): ReverseIndexEntry {
    if (!index[tokenName]) {
      index[tokenName] = {
        usages: [],
        inferredStates: [],
        inferredSlotTypes: [],
        componentCount: 0,
        hardcodedAlternatives: 0,
      };
    }
    return index[tokenName];
  }

  function addUsage(
    tokenName: string,
    componentName: string,
    variantValues: Record<string, string>,
    slotName: string,
    property: string
  ): void {
    const entry = ensureEntry(tokenName);
    entry.usages.push({
      component: componentName,
      variantValues: variantValues || {},
      slot: slotName || '',
      property,
    });
    entry.componentCount = entry.usages.length;
  }

  function walkLayers(
    layers: LayerNode[],
    componentName: string,
    variantValues: Record<string, string>
  ): void {
    if (!layers || !layers.length) return;
    for (const layer of layers) {
      // Fills
      if (layer.fills && layer.fills.length) {
        for (const fill of layer.fills) {
          if (fill.isTokenBound && fill.token && fill.token.name) {
            addUsage(fill.token.name, componentName, variantValues, layer.name, 'fill');
          } else if (!fill.isTokenBound && fill.raw) {
            ensureEntry('__hardcoded__').hardcodedAlternatives++;
          }
        }
      }
      // Strokes
      if (layer.strokes && layer.strokes.length) {
        for (const stroke of layer.strokes) {
          if (stroke.isTokenBound && stroke.token && stroke.token.name) {
            addUsage(stroke.token.name, componentName, variantValues, layer.name, 'stroke');
          }
        }
      }
      // Recurse
      if (layer.children && layer.children.length) {
        walkLayers(layer.children, componentName, variantValues);
      }
    }
  }

  const sets = (componentLibraryJSON && componentLibraryJSON.componentSets) || [];
  for (const set of sets) {
    const variants = set.variants || [];
    for (const variant of variants) {
      walkLayers(variant.layerTree || [], set.name, variant.variantValues || {});
    }
  }

  // Compute inferredStates and inferredSlotTypes
  for (const name of Object.keys(index)) {
    const entry = index[name];
    const states: string[] = [];
    const slotTypes: string[] = [];
    for (const usage of entry.usages) {
      const vv = usage.variantValues || {};
      if (vv['State'] && states.indexOf(vv['State']) === -1) states.push(vv['State']);
      if (vv['Disabled'] && states.indexOf('Disabled') === -1) states.push('Disabled');
      const slotType = (usage.slot || '').toLowerCase().indexOf('icon') !== -1 ? 'icon' : 'frame';
      if (slotTypes.indexOf(slotType) === -1) slotTypes.push(slotType);
    }
    entry.inferredStates = states;
    entry.inferredSlotTypes = slotTypes;
  }

  return index;
}

// ============================================================================
// Task 3 — computeAlignmentSignals
// ============================================================================

export function computeAlignmentSignals(
  variable: FigmaVariableShape,
  signals: TokenSignals,
  reverseIndexEntry: ReverseIndexEntry | null
): AlignmentSignals {
  // descriptionUsageAlignment
  let descriptionUsageAlignment = 0.0;
  if (reverseIndexEntry && reverseIndexEntry.componentCount > 0) {
    if (!signals.hasDescription) {
      descriptionUsageAlignment = 0.1;
    } else {
      const desc = (variable.description || '').toLowerCase();
      const descWords = desc.split(/\W+/).filter(w => w.length > 2);

      const usageContext: string[] = [];
      reverseIndexEntry.usages.forEach(u => usageContext.push(u.component.toLowerCase()));
      reverseIndexEntry.inferredStates.forEach(s => usageContext.push(s.toLowerCase()));

      const usageWords = usageContext
        .join(' ')
        .split(/\W+/)
        .filter(w => w.length > 2);

      let overlap = 0;
      for (const word of descWords) {
        if (usageWords.indexOf(word) !== -1) overlap++;
      }
      descriptionUsageAlignment = Math.min(
        1.0,
        overlap / Math.max(descWords.length, usageWords.length, 1)
      );
    }
  }

  // scopeUsageAlignment
  let scopeUsageAlignment = 0.5;
  if (reverseIndexEntry && reverseIndexEntry.componentCount > 0) {
    const scopes: string[] = variable.scopes || [];
    if (!scopes.length || scopes.indexOf('ALL_SCOPES') !== -1) {
      scopeUsageAlignment = 0.3;
    } else {
      const propToScope: Record<string, string> = {
        fill: 'FILL_COLOR',
        stroke: 'STROKE_COLOR',
        'text.fill': 'TEXT_FILL',
      };
      const actualProps: string[] = [];
      reverseIndexEntry.usages.forEach(u => {
        if (actualProps.indexOf(u.property) === -1) actualProps.push(u.property);
      });
      let matches = 0;
      for (const prop of actualProps) {
        const expectedScope = propToScope[prop];
        if (expectedScope && scopes.indexOf(expectedScope) !== -1) matches++;
      }
      scopeUsageAlignment = actualProps.length ? matches / actualProps.length : 0.5;
    }
  }

  // aiParseability
  const nameClarity =
    signals.namingDepth >= 3 ? 1.0 : signals.namingDepth === 2 ? 0.6 : 0.2;
  const descQuality = !signals.hasDescription
    ? 0
    : signals.descriptionLength < 20
    ? 0.5
    : 1.0;
  const scopeSpecificity = !signals.hasSpecificScopes
    ? 0
    : signals.scopeCount === 1
    ? 0.5
    : 1.0;
  const aiParseability =
    nameClarity * 0.35 + descQuality * 0.4 + scopeSpecificity * 0.25;

  return { descriptionUsageAlignment, scopeUsageAlignment, aiParseability };
}

// ============================================================================
// Task 4 — detectGaps
// ============================================================================

export function detectGaps(
  variable: FigmaVariableShape,
  signals: TokenSignals,
  alignmentSignals: AlignmentSignals,
  reverseIndexEntry: ReverseIndexEntry | null
): Gap[] {
  const gaps: Gap[] = [];

  // 1. Orphan
  if (!reverseIndexEntry || reverseIndexEntry.componentCount === 0) {
    gaps.push({
      type: 'orphan',
      severity: 'high',
      message: `Token "${variable.name}" is not used in any component`,
      suggestion:
        'Verify this token is still needed. If yes, apply it to a component layer.',
    });
  }

  // 2. Missing description
  if (!signals.hasDescription && reverseIndexEntry && reverseIndexEntry.componentCount > 0) {
    const components: string[] = [];
    reverseIndexEntry.usages.forEach(u => {
      if (components.indexOf(u.component) === -1) components.push(u.component);
    });
    const topComps = components.slice(0, 2).join(', ');
    const states = (reverseIndexEntry.inferredStates || []).join(', ') || 'all states';
    const slotType = (reverseIndexEntry.inferredSlotTypes || ['element'])[0];
    gaps.push({
      type: 'missingDescription',
      severity: 'high',
      message: `No description — token is used in ${components.length} component(s)`,
      suggestion: `Use for ${slotType} in ${topComps} (${states}).`,
    });
  }

  // 3. Scope mismatch
  if (reverseIndexEntry && alignmentSignals.scopeUsageAlignment < 0.5) {
    const actualProps: string[] = [];
    reverseIndexEntry.usages.forEach(u => {
      if (actualProps.indexOf(u.property) === -1) actualProps.push(u.property);
    });
    gaps.push({
      type: 'scopeMismatch',
      severity: 'medium',
      message: 'Scope does not cover all actual usages',
      suggestion: `Token is used as: ${actualProps.join(', ')}. Add matching scopes.`,
    });
  }

  // 4. Hardcoded competitor
  if (reverseIndexEntry && reverseIndexEntry.hardcodedAlternatives > 0) {
    gaps.push({
      type: 'hardcodedCompetitor',
      severity: 'medium',
      message: `${reverseIndexEntry.hardcodedAlternatives} hardcoded color(s) found where this token should be used`,
      suggestion: 'Replace hardcoded values with this token in the component layer tree.',
    });
  }

  // 5. Description mismatch
  if (
    signals.hasDescription &&
    reverseIndexEntry &&
    alignmentSignals.descriptionUsageAlignment < 0.3
  ) {
    const usedIn: string[] = [];
    reverseIndexEntry.usages.forEach(u => {
      if (usedIn.indexOf(u.component) === -1) usedIn.push(u.component);
    });
    gaps.push({
      type: 'descriptionMismatch',
      severity: 'low',
      message: 'Description may not reflect actual usage',
      suggestion: `Token is used in: ${usedIn.slice(0, 3).join(', ')}. Update description.`,
    });
  }

  // 6. Weak scope
  if (!signals.hasSpecificScopes && reverseIndexEntry && reverseIndexEntry.componentCount > 0) {
    const propToScope: Record<string, string> = {
      fill: 'FILL_COLOR',
      stroke: 'STROKE_COLOR',
      'text.fill': 'TEXT_FILL',
    };
    const inferredScopes: string[] = [];
    reverseIndexEntry.usages.forEach(u => {
      const s = propToScope[u.property];
      if (s && inferredScopes.indexOf(s) === -1) inferredScopes.push(s);
    });
    gaps.push({
      type: 'weakScope',
      severity: 'low',
      message: 'No specific scopes defined',
      suggestion: `Add scopes: ${inferredScopes.join(', ') || 'based on usage patterns'}`,
    });
  }

  return gaps;
}

// ============================================================================
// Task 5 — scoreToken
// ============================================================================

const DEFAULT_WEIGHTS: ScoringWeights = {
  namingDepth: 0.15,
  descriptionQuality: 0.20,
  descriptionUsageAlignment: 0.20,
  scopeUsageAlignment: 0.15,
  aiParseability: 0.15,
  modeCoverage: 0.10,
  collectionTier: 0.05,
};

export function scoreToken(
  variable: FigmaVariableShape,
  collectionName: string,
  reverseIndexEntry: ReverseIndexEntry | null,
  rubric?: ScoringWeights | null
): ScoreResult {
  const weights: ScoringWeights = rubric || DEFAULT_WEIGHTS;

  const signals = extractTokenSignals(variable, collectionName);
  const alignment = computeAlignmentSignals(variable, signals, reverseIndexEntry);
  const gaps = detectGaps(variable, signals, alignment, reverseIndexEntry);

  const dim: Record<string, number> = {};
  dim['namingDepth'] = signals.namingDepth >= 3 ? 1.0 : signals.namingDepth === 2 ? 0.6 : 0.2;
  dim['descriptionQuality'] = !signals.hasDescription
    ? 0
    : signals.descriptionLength < 20
    ? 0.5
    : 1.0;
  dim['descriptionUsageAlignment'] = alignment.descriptionUsageAlignment;
  dim['scopeUsageAlignment'] = alignment.scopeUsageAlignment;
  dim['aiParseability'] = alignment.aiParseability;
  dim['modeCoverage'] = signals.allModesPopulated
    ? 1.0
    : signals.modeCount > 1
    ? 0.5
    : 0.2;
  dim['collectionTier'] =
    signals.collectionTier === 'semantic'
      ? 1.0
      : signals.collectionTier === 'primitive'
      ? 0.7
      : 0.4;

  let total = 0;
  for (const k of Object.keys(weights) as (keyof ScoringWeights)[]) {
    if (dim[k] !== undefined) {
      total += dim[k] * weights[k];
    }
  }

  const finalScore = Math.round(total * 100);
  const tier: 'good' | 'fair' | 'needs-work' =
    finalScore >= 80 ? 'good' : finalScore >= 60 ? 'fair' : 'needs-work';

  return {
    variableId: variable.id,
    variableName: variable.name,
    collectionName,
    score: finalScore,
    tier,
    gaps,
    signals,
    alignment,
    dimensions: dim,
  };
}
