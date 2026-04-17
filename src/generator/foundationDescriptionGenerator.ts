/**
 * Foundation Collection — Deterministic Description Generator
 *
 * Implements the 4-slot formula:
 *   [S1: Semantic role] [S2: Resolved value] [S3: Alias chain] [S4: Usage context]
 *
 * Each group (spacing, sizing, radius, colours, typography, elevation, strokes, grid)
 * has its own generator that strictly follows the spec in the Token Description Strategy doc.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FoundationVariable {
  id: string;
  name: string;
  description: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  scopes: string[];
  valuesByMode: Record<string, unknown>;
  variableCollectionId: string;
}

export interface AliasInfo {
  isAlias: boolean;
  targetName?: string;
}

export interface GenerateResult {
  varId: string;
  name: string;
  description: string;
  skipped: boolean;
  skipReason?: string;
  validationErrors?: string[];
}

export interface RunReport {
  summary: string;
  generated: Array<{ name: string; description: string }>;
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
}

// ── Alias resolution helpers ──────────────────────────────────────────────────

export function resolveAlias(
  variable: FoundationVariable,
  varMap: Record<string, FoundationVariable>
): AliasInfo {
  const modeId = Object.keys(variable.valuesByMode)[0];
  const val = variable.valuesByMode[modeId] as any;
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    const target = varMap[val.id];
    return { isAlias: true, targetName: target?.name ?? val.id };
  }
  return { isAlias: false };
}

export function resolveLeafValue(
  variable: FoundationVariable,
  varMap: Record<string, FoundationVariable>,
  depth = 0
): unknown {
  if (depth > 10) return null;
  const modeId = Object.keys(variable.valuesByMode)[0];
  const val = variable.valuesByMode[modeId] as any;
  if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
    const target = varMap[val.id];
    if (target) return resolveLeafValue(target, varMap, depth + 1);
    return null;
  }
  return val;
}

// ── Value formatting helpers ──────────────────────────────────────────────────

function fmtFloat(val: unknown): string | null {
  if (typeof val === 'number') return `${val}px`;
  return null;
}

// ── Group routers ─────────────────────────────────────────────────────────────

type GroupGenerator = (
  variable: FoundationVariable,
  varMap: Record<string, FoundationVariable>
) => string;

const GROUP_GENERATORS: Record<string, GroupGenerator> = {
  spacing: genSpacing,
  sizing: genSizing,
  radius: genRadius,
  colours: genColours,
  typography: genTypography,
  elevation: genElevation,
  strokes: genStrokes,
  grid: genGrid,
};

// ── spacing ───────────────────────────────────────────────────────────────────

const SPACING_STEP_LABEL: Record<number, string> = {
  0: 'Zero',
  1: 'Smallest',
  2: 'Extra-small',
  3: 'Small',
  4: 'Medium',
  5: 'Standard',
  6: 'Large',
  7: 'Extra-large',
  8: 'Largest',
};

function spacingStepLabel(step: number): string {
  if (step <= 8) return SPACING_STEP_LABEL[step] ?? `${step}× base`;
  return `${step}× base`;
}

function genSpacing(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  // path: spacing/[component|layout]/[step]
  const segments = v.name.split('/');
  const subGroup = segments[1] ?? '';
  const stepStr = segments[2] ?? '0';
  const step = parseInt(stepStr, 10);
  const label = spacingStepLabel(step);

  // S1
  const s1 = `${label} spacing step.`;

  // S2 — resolved leaf px value
  const leaf = resolveLeafValue(v, varMap);
  const px = fmtFloat(leaf);
  const s2 = px ? `${px} base.` : null;

  // S3 — alias target
  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias
    ? `Aliases ${alias.targetName} (responsive).`
    : null;

  // S4
  let s4: string;
  if (subGroup === 'component') {
    s4 = 'Use for internal component gaps: icon-to-label, input padding, list-item rows.';
  } else {
    s4 = 'Use for layout-level spacing: section gaps, content margins, vertical rhythm.';
  }

  const parts = [s1, s2, s3, s4].filter(Boolean) as string[];

  // Anti-pattern sentence for step 0
  if (step === 0) parts.push('Use to explicitly zero out inherited spacing.');

  return parts.join(' ');
}

// ── sizing ────────────────────────────────────────────────────────────────────

const SIZING_S1: Record<string, string> = {
  'input-height': 'Standard height for interactive controls.',
  'viewport': 'Reference viewport width for layout calculations.',
  'minimum-tappable-area': 'Minimum touch target size for accessibility compliance.',
};

const SIZING_S4: Record<string, string> = {
  'input-height': 'Apply to buttons, text inputs, select menus, and any tappable control.',
  'viewport': 'Use as the baseline for container max-widths and fluid grid calculations.',
  'minimum-tappable-area':
    'Apply as the minimum width and height of all interactive elements. Never go below this value.',
};

function genSizing(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  const key = v.name.split('/').slice(1).join('/'); // e.g. "input-height"

  const s1 = SIZING_S1[key] ?? 'Sizing token.';

  const leaf = resolveLeafValue(v, varMap);
  const px = fmtFloat(leaf);
  const s2 = px ? `${px} base.` : null;

  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias ? `Aliases ${alias.targetName} (responsive).` : null;

  const s4 = SIZING_S4[key] ?? 'Apply to interactive controls and containers.';

  return [s1, s2, s3, s4].filter(Boolean).join(' ');
}

// ── radius ────────────────────────────────────────────────────────────────────

const RADIUS_S1: Record<string, string> = {
  zero: 'No border radius (0px).',
  'extra-small': 'Minimal border radius (6px).',
  small: 'Small border radius.',
  medium: 'Medium border radius.',
  large: 'Large border radius.',
  'extra-large': 'Extra-large border radius.',
  full: 'Full/pill border radius (999px).',
};

const RADIUS_S4: Record<string, string> = {
  zero: 'Use for sharp-cornered surfaces: table cells, full-bleed images, code blocks.',
  'extra-small': 'Use for inline elements: chips, badges, compact tags.',
  small: 'Use for inline elements: chips, badges, compact tags.',
  medium: 'Use for standard UI surfaces: cards, modals, panels.',
  large: 'Use for prominent surfaces: sheets, drawers, hero containers.',
  'extra-large': 'Use for prominent surfaces: sheets, drawers, hero containers.',
  full: 'Use for pill shapes: toggle tracks, avatar containers, lozenges.',
};

function genRadius(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  const key = v.name.split('/').slice(1).join('/'); // e.g. "medium"

  const s1 = RADIUS_S1[key] ?? 'Border radius token.';

  const leaf = resolveLeafValue(v, varMap);
  const px = fmtFloat(leaf);

  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias
    ? `Aliases ${alias.targetName}.`
    : 'Raw value — not aliased.';

  const s4 = RADIUS_S4[key] ?? 'Use for UI surfaces.';

  // S1 for 'zero' and 'full' already contains the px value — skip s2 to avoid repetition
  const omitS2 = key === 'zero' || key === 'full' || key === 'extra-small';
  const s2 = !omitS2 && px ? `${px}.` : null;

  return [s1, s2, s3, s4].filter(Boolean).join(' ');
}

// ── colours ───────────────────────────────────────────────────────────────────

function coloursS1(name: string): string {
  const parts = name.split('/');
  // e.g. colours/basic/background-card or colours/functional/success-default
  const subGroup = parts[1] ?? '';
  const tokenKey = parts.slice(2).join('/');

  switch (subGroup) {
    case 'basic': {
      if (tokenKey.startsWith('background')) {
        const modifier = tokenKey.replace(/^background-?/, '').trim();
        return modifier
          ? `Default ${modifier} background surface color.`
          : 'Default background surface color.';
      }
      if (tokenKey.startsWith('text')) {
        const modifier = tokenKey.replace(/^text-?/, '').trim();
        return modifier ? `Default ${modifier} text color.` : 'Default text color.';
      }
      if (tokenKey.startsWith('border')) {
        const modifier = tokenKey.replace(/^border-?/, '').trim();
        return modifier ? `Default ${modifier} border color.` : 'Default border color.';
      }
      if (tokenKey.startsWith('icon')) {
        const modifier = tokenKey.replace(/^icon-?/, '').trim();
        return modifier ? `Default ${modifier} icon fill color.` : 'Default icon fill color.';
      }
      return 'Default color token.';
    }
    case 'shades':
      return `Brand shade color at ${tokenKey} tone.`;
    case 'interaction-states': {
      if (tokenKey.startsWith('hover')) return 'Color applied to interactive elements on hover.';
      if (tokenKey.startsWith('pressed')) return 'Color applied to interactive elements on press.';
      if (tokenKey.startsWith('focus')) return 'Color for focus ring and keyboard-navigation indicators.';
      if (tokenKey.startsWith('disabled')) return 'Color for disabled-state elements.';
      return 'Interaction state color.';
    }
    case 'functional': {
      if (tokenKey.startsWith('success')) return 'Semantic success/positive-feedback color.';
      if (tokenKey.startsWith('error')) return 'Semantic error/destructive-action color.';
      if (tokenKey.startsWith('warning')) return 'Semantic warning/caution color.';
      if (tokenKey.startsWith('info')) return 'Semantic informational color.';
      return 'Functional semantic color.';
    }
    default:
      return 'Color token.';
  }
}

function coloursS4(scopes: string[]): string {
  if (scopes.includes('ALL_SCOPES')) return 'Applies to fills, strokes, effects, and text as needed.';
  if (scopes.includes('ALL_FILLS')) return 'Apply to surface fills, icon fills, and illustration fills.';
  if (scopes.includes('TEXT_FILL')) return 'Apply to text elements only.';
  return 'Apply as needed.';
}

function coloursPairing(name: string): string | null {
  // Only for colours/basic/*
  const parts = name.split('/');
  if (parts[1] !== 'basic') return null;
  const tokenKey = parts.slice(2).join('/');
  if (tokenKey.startsWith('background-card')) {
    return 'Pair with colours/basic/text and colours/basic/border.';
  }
  if (tokenKey.startsWith('background')) return 'Pair with colours/basic/text.';
  if (tokenKey.startsWith('text')) return 'Pair with colours/basic/background.';
  return null;
}

function genColours(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  const s1 = coloursS1(v.name);

  // S2 — skip for mode-adaptive colours

  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias ? `Aliases ${alias.targetName} (light/dark adaptive).` : null;

  const s4 = coloursS4(v.scopes);

  const pairing = coloursPairing(v.name);

  const parts = [s1, s3, s4, pairing].filter(Boolean) as string[];
  return parts.join(' ');
}

// ── typography ────────────────────────────────────────────────────────────────

const TYPOGRAPHY_PROP_LABEL: Record<string, string> = {
  size: 'Font size',
  'line-height': 'Line height',
  weight: 'Font weight',
  'letter-spacing': 'Letter spacing',
  'paragraph-spacing': 'Paragraph spacing',
  'paragraph-indent': 'Paragraph indent',
  'font-family': 'Font family',
};

const TYPOGRAPHY_SCALE_USAGE: Record<string, string> = {
  display: 'hero headings and page-level titles only',
  'title-L': 'primary section headings',
  'title-M': 'secondary section headings and card titles',
  'title-S': 'tertiary headings and modal titles',
  subtitle: 'supporting text beneath headings',
  paragraph: 'long-form body copy and editorial text',
  'body-L': 'primary body text in content-heavy layouts',
  'body-M-bold': 'emphasized body text, labels, and UI copy',
  'body-M-regular': 'default body text and form labels',
  'link-M-bold': 'prominent inline links and CTAs',
  'link-M-regular': 'standard inline links',
  'body-S-bold': 'captions, metadata, and secondary labels',
  'body-S-regular': 'fine print, timestamps, and helper text',
  'link-S-regular': 'supporting inline links and footnotes',
  'microcopy-bold': 'micro-UI labels: badges, chips, counters',
  'microcopy-regular': 'the smallest readable text in the system',
};

function genTypography(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  // path: typography/[scale-level]/[property]
  const parts = v.name.split('/');
  const scaleLevel = parts[1] ?? '';
  const prop = parts[2] ?? '';

  const propLabel = TYPOGRAPHY_PROP_LABEL[prop] ?? prop;
  const s1 = `${propLabel} for ${scaleLevel} text style.`;

  // S2 — resolved value if not mode-adaptive
  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias
    ? `Aliases ${alias.targetName} (responsive).`
    : null;

  const usageContext = TYPOGRAPHY_SCALE_USAGE[scaleLevel] ?? scaleLevel;
  const s4 = `Apply to ${usageContext}.`;

  return [s1, s3, s4].filter(Boolean).join(' ');
}

// ── elevation ─────────────────────────────────────────────────────────────────

const ELEVATION_LEVEL_META: Record<string, { metaphor: string; surfaces: string }> = {
  'level-0': {
    metaphor: 'flat',
    surfaces: 'flat surfaces with no elevation: list items, table rows, inline elements',
  },
  'level-1': {
    metaphor: 'subtle',
    surfaces: 'slightly raised surfaces: cards, list containers, input fields',
  },
  'level-2': {
    metaphor: 'raised',
    surfaces: 'raised interactive surfaces: buttons, chips, hover states',
  },
  'level-3': {
    metaphor: 'floating',
    surfaces: 'floating overlay surfaces: dropdowns, tooltips, snackbars',
  },
  'level-4': {
    metaphor: 'prominent',
    surfaces: 'prominent overlays: drawers, side sheets, navigation rails',
  },
  'level-5': {
    metaphor: 'modal',
    surfaces: 'modal dialogs and full-screen overlays',
  },
  'level-6': {
    metaphor: 'top',
    surfaces: 'top-most surfaces: toasts, onboarding coachmarks',
  },
  'app-bar-top': {
    metaphor: 'sticky',
    surfaces: 'top app bar / sticky header',
  },
  'app-bar-bottom': {
    metaphor: 'sticky',
    surfaces: 'bottom navigation bar',
  },
  FAB: {
    metaphor: 'action',
    surfaces: 'floating action button',
  },
};

function elevationS1(level: string, prop: string, metaphor: string): string {
  const levelLabel = `${metaphor} elevation (${level} level)`;
  switch (prop) {
    case 'colour': return `Shadow color for ${levelLabel}.`;
    case 'x': return `Horizontal shadow offset for ${levelLabel}.`;
    case 'y': return `Vertical shadow offset for ${levelLabel}.`;
    case 'blur': return `Shadow blur radius for ${levelLabel}.`;
    case 'spread': return `Shadow spread radius for ${levelLabel}.`;
    default: return `Elevation property for ${levelLabel}.`;
  }
}

function genElevation(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  // path: elevation/[level]/[property]
  const parts = v.name.split('/');
  const level = parts[1] ?? '';
  const prop = parts[2] ?? '';

  const meta = ELEVATION_LEVEL_META[level];
  const metaphor = meta?.metaphor ?? level;
  const surfaces = meta?.surfaces ?? level;

  const s1 = elevationS1(level, prop, metaphor);

  // S2 — numeric value only, skip colour (mode-adaptive)
  const isColour = prop === 'colour' || v.resolvedType === 'COLOR';
  let s2: string | null = null;
  if (!isColour) {
    const leaf = resolveLeafValue(v, varMap);
    const px = fmtFloat(leaf);
    if (px) s2 = `${px}.`;
  }

  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias ? `Aliases ${alias.targetName} (light/dark adaptive).` : null;

  const s4 = `Apply to ${surfaces}.`;

  return [s1, s2, s3, s4].filter(Boolean).join(' ');
}

// ── strokes ───────────────────────────────────────────────────────────────────

function genStrokes(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  // path: strokes/[1|2|3]
  const key = v.name.split('/')[1] ?? '1';
  const ordinal = key; // "1", "2", "3"

  const s1 = `${ordinal}px border width.`;

  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias ? `Aliases ${alias.targetName}.` : 'Raw value.';

  const s4 = 'Apply to input borders, card outlines, dividers, and focus rings.';
  const extra =
    key === '2' ? 'Use for emphasized borders and active/selected states.' : null;

  return [s1, s3, s4, extra].filter(Boolean).join(' ');
}

// ── grid ──────────────────────────────────────────────────────────────────────

const GRID_META: Record<string, { s1: string; s4: string }> = {
  margins: {
    s1: 'Outer page margin for the layout grid.',
    s4: 'Apply as the left/right padding on the outermost page container.',
  },
  gutters: {
    s1: 'Column gutter width for the layout grid.',
    s4: 'Apply as the gap between grid columns.',
  },
  'margins-overflow': {
    s1: 'Extended margin for overflow card layouts.',
    s4: 'Use for card grids that bleed slightly beyond the standard page margin.',
  },
};

function genGrid(v: FoundationVariable, varMap: Record<string, FoundationVariable>): string {
  const key = v.name.split('/').slice(1).join('/'); // e.g. "margins"
  const meta = GRID_META[key] ?? {
    s1: 'Layout grid token.',
    s4: 'Apply to grid layout containers.',
  };

  const s1 = meta.s1;

  const alias = resolveAlias(v, varMap);
  const s3 = alias.isAlias ? `Aliases ${alias.targetName} (responsive).` : null;

  const s4 = meta.s4;
  const note =
    'Not directly bindable in Figma — reference value for code and grid plugins only.';

  return [s1, s3, s4, note].filter(Boolean).join(' ');
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateDescription(
  description: string,
  variable: FoundationVariable,
  varMap: Record<string, FoundationVariable>
): string[] {
  const errors: string[] = [];
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length < 2) errors.push('Too short: fewer than 2 sentences.');
  if (sentences.length > 5) errors.push('Too long: more than 5 sentences.'); // 4 + optional pairing

  // S1 must not contain the token name or collection name
  const s1 = sentences[0] ?? '';
  const tokenLeaf = variable.name.split('/').pop() ?? '';
  if (s1.toLowerCase().includes(tokenLeaf.toLowerCase())) {
    errors.push(`S1 contains token name fragment "${tokenLeaf}".`);
  }

  // S2 unit check
  const s2Candidates = sentences.filter(
    s => /\d/.test(s) && !/aliases/i.test(s) && !/apply/i.test(s) && !/pair/i.test(s)
  );
  for (const s of s2Candidates) {
    if (/\d/.test(s) && !/px|rgba|%/.test(s)) {
      errors.push(`Numeric value in "${s}" is missing a unit suffix.`);
    }
  }

  // Colour group: no raw hex
  if (variable.name.startsWith('colours/')) {
    if (/#[0-9a-fA-F]{3,6}/.test(description)) {
      errors.push('Colour token description contains a raw hex value.');
    }
  }

  // S4 must contain at least one concrete UI element name
  const uiTerms = [
    'button', 'input', 'card', 'modal', 'chip', 'badge', 'icon', 'text', 'border',
    'divider', 'heading', 'link', 'label', 'table', 'dropdown', 'drawer', 'sheet',
    'toast', 'tooltip', 'surface', 'container', 'grid', 'gap', 'padding', 'radius',
    'focus', 'ring', 'outline', 'fill', 'stroke', 'shadow', 'overlay', 'header',
    'navigation', 'toggle', 'avatar', 'lozenge', 'tappable', 'control',
  ];
  const lastSentences = sentences.slice(-2).join(' ').toLowerCase();
  const hasUITerm = uiTerms.some(t => lastSentences.includes(t));
  if (!hasUITerm) errors.push('S4 has no concrete UI element name.');

  // No duplicate sentences
  const seen = new Set<string>();
  for (const s of sentences) {
    if (seen.has(s)) errors.push(`Duplicate sentence: "${s}"`);
    seen.add(s);
  }

  return errors;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function generateFoundationDescription(
  variable: FoundationVariable,
  varMap: Record<string, FoundationVariable>
): { description: string; validationErrors: string[] } {
  const topGroup = variable.name.split('/')[0];
  const generator = GROUP_GENERATORS[topGroup];

  if (!generator) {
    return {
      description: '',
      validationErrors: [`Unknown group "${topGroup}" — no generator found.`],
    };
  }

  const description = generator(variable, varMap);
  const validationErrors = validateDescription(description, variable, varMap);

  return { description, validationErrors };
}

/**
 * Run the full generation pass over the foundation collection variables.
 * Returns a dry-run report; does NOT write to Figma.
 *
 * @param variables  All variables from the foundation collection
 * @param force      When true, generate for variables that already have descriptions
 */
export function generateFoundationDescriptions(
  variables: FoundationVariable[],
  varMap: Record<string, FoundationVariable>,
  force = false
): GenerateResult[] {
  const results: GenerateResult[] = [];

  for (const v of variables) {
    // Skip if description already exists and not forced
    if (!force && v.description && v.description.trim().length > 0) {
      results.push({
        varId: v.id,
        name: v.name,
        description: v.description,
        skipped: true,
        skipReason: 'existing description',
      });
      continue;
    }

    const { description, validationErrors } = generateFoundationDescription(v, varMap);

    if (!description) {
      results.push({
        varId: v.id,
        name: v.name,
        description: '',
        skipped: false,
        validationErrors,
      });
      continue;
    }

    results.push({
      varId: v.id,
      name: v.name,
      description,
      skipped: false,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    });
  }

  return results;
}

export function buildRunReport(results: GenerateResult[]): RunReport {
  const generated: Array<{ name: string; description: string }> = [];
  const skipped: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const r of results) {
    if (r.skipped) {
      skipped.push(r.name);
    } else if (!r.description) {
      failed.push({ name: r.name, error: (r.validationErrors ?? ['no description generated']).join('; ') });
    } else {
      generated.push({ name: r.name, description: r.description });
      if (r.validationErrors && r.validationErrors.length > 0) {
        // Log warnings but still consider it generated
        console.warn(`[foundation-gen] Validation warnings for ${r.name}:`, r.validationErrors);
      }
    }
  }

  const summary = `${generated.length} generated, ${skipped.length} skipped (existing), ${failed.length} failed`;

  return { summary, generated, skipped, failed };
}
