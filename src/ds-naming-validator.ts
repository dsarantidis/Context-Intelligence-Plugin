/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Design System Naming & Structure Validator
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Encodes the strict Design System rules:
 *
 *  1. Hierarchy: Core (Primitive) → Semantic → Component/Scheme
 *  2. Color Naming: Numeric scales 50–980, functional keywords, tone modifiers
 *  3. Interaction States: [Theme].[Interactive States].[State].[Category].[Token]
 *  4. Typography & Layout: T-shirt sizing, dimensions, breakpoint grids
 *
 * This module is a **pure domain module** — no Figma globals, no UI code.
 * It receives a token name + collection name + resolved type and returns
 * a list of violations.
 *
 * All violations carry a severity and a machine-readable ruleId so the
 * UI can display them consistently alongside other issues.
 */

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

export interface NamingViolation {
  /** Machine-readable rule ID (e.g. "hierarchy.missing-tier") */
  ruleId: string;
  /** Human-readable rule category */
  category: string;
  /** Severity of the violation */
  severity: 'critical' | 'warning' | 'info';
  /** Human-readable violation message */
  message: string;
  /** Actionable suggestion for how to fix */
  suggestion: string;
  /** Weight for scoring (0–40) */
  weight: number;
}

/** Input for the validator — the information available from a Figma variable */
export interface TokenInput {
  /** Full slash-separated name (e.g. "neutral/500") */
  name: string;
  /** Collection name (e.g. "Core", "Semantic", "Component") */
  collectionName: string;
  /** Resolved type: COLOR | FLOAT | STRING | BOOLEAN */
  resolvedType: string;
  /** Number of modes this variable has */
  modeCount: number;
  /** Mode names (e.g. ["Light", "Dark", "Light Inverted"]) */
  modeNames: string[];
  /** Whether the variable has a description */
  hasDescription: boolean;
}

/** Input for style validation */
export interface StyleInput {
  /** Full slash-separated name */
  name: string;
  /** Style type: PAINT | TEXT | EFFECT */
  styleType: string;
  /** Whether the style has a description */
  hasDescription: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// Constants — The Design System Grammar
// ════════════════════════════════════════════════════════════════════════════

/** Recognized collection tiers for the 3-tier hierarchy */
const HIERARCHY_TIERS = {
  core: ['core', 'primitive', 'primitives', 'base', 'foundations', 'foundation'],
  semantic: ['semantic', 'semantics', 'alias', 'aliases', 'system', 'theme'],
  component: ['component', 'components', 'scheme', 'schemes', 'specific'],
};

/** Valid numeric scale values for color tokens */
const VALID_COLOR_SCALES = [
  50, 100, 150, 200, 250, 300, 350, 400, 450, 500,
  550, 600, 650, 700, 750, 800, 850, 900, 950, 980,
];

/** Functional color keywords (semantic level) */
const FUNCTIONAL_COLOR_KEYWORDS = [
  'success', 'error', 'warning', 'information', 'info',
  'danger', 'caution', 'positive', 'negative', 'neutral',
];

/** Tone modifiers */
const TONE_MODIFIERS = [
  'dim', 'bright', 'recessive', 'inverse', 'inverted',
  'muted', 'vivid', 'subtle', 'strong',
];

/** Semantic color categories */
const SEMANTIC_COLOR_CATEGORIES = [
  'background', 'foreground', 'surface', 'border', 'stroke',
  'overlay', 'shadow', 'icon', 'text', 'brand',
  'on-surface', 'on-primary', 'on-secondary',
];

/** Recognized modes */
const RECOGNIZED_MODES = [
  'mode 1', 'mode 2', 'light', 'dark',
  'light inverted', 'dark inverted',
  'high contrast', 'default',
];

/** Interaction states */
const INTERACTION_STATES = [
  'hover', 'pressed', 'focus', 'disabled', 'visited',
  'active', 'selected', 'dragged',
];

/** Typography size descriptors (t-shirt sizing) */
const TYPOGRAPHY_SIZES = [
  'title-l', 'title-m', 'title-s',
  'body-l', 'body-m', 'body-s',
  'label-l', 'label-m', 'label-s',
  'caption', 'microcopy', 'overline',
  'headline-l', 'headline-m', 'headline-s',
  'display-l', 'display-m', 'display-s',
];

/** Breakpoint names for grid/layout tokens */
const BREAKPOINT_NAMES = [
  's mobile', 's-mobile', 'mobile',
  'm tablet', 'm-tablet', 'tablet',
  'l laptop', 'l-laptop', 'laptop',
  'xl desktop', 'xl-desktop', 'desktop',
];

// ════════════════════════════════════════════════════════════════════════════
// 1. Hierarchy & Structure Validator
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate the 3-tier hierarchy rule.
 *
 * The collection name must map to one of: Core, Semantic, Component.
 * The token's naming pattern must be consistent with its tier:
 *   - Core: named by property + intensity (e.g. neutral/500)
 *   - Semantic: named by function (e.g. Background/Surface/Surface Dim)
 *   - Component: named by component context
 */
function validateHierarchy(input: TokenInput): NamingViolation[] {
  const violations: NamingViolation[] = [];
  const collLower = input.collectionName.toLowerCase().trim();
  const segments = input.name.split('/').map(s => s.trim());

  // Detect which tier this collection belongs to
  const tier = detectTier(collLower);

  if (!tier) {
    violations.push({
      ruleId: 'hierarchy.unknown-tier',
      category: 'Hierarchy & Structure',
      severity: 'warning',
      message: `Collection "${input.collectionName}" does not map to a recognized hierarchy tier (Core / Semantic / Component).`,
      suggestion: `Rename the collection to include one of: Core, Semantic, or Component (e.g. "Core Colors", "Semantic Brand").`,
      weight: 20,
    });
  }

  // Core tokens: must have property + intensity naming
  if (tier === 'core') {
    if (input.resolvedType === 'COLOR') {
      // Expect: [ColorFamily]/[Scale] — e.g. neutral/500
      const leaf = segments[segments.length - 1];
      const scaleNum = parseInt(leaf, 10);
      const hasValidScale = !isNaN(scaleNum) && VALID_COLOR_SCALES.includes(scaleNum);
      const isSourceKeyword = /source/i.test(leaf);

      if (!hasValidScale && !isSourceKeyword && segments.length < 2) {
        violations.push({
          ruleId: 'hierarchy.core-color-naming',
          category: 'Hierarchy & Structure',
          severity: 'warning',
          message: `Core color token "${input.name}" should follow the pattern [ColorFamily]/[Scale] (e.g. neutral/500, brand/Primary Brand Color/100).`,
          suggestion: `Use a numeric scale (50–980) as the last segment, where 500 is typically the source color.`,
          weight: 15,
        });
      }
    }

    if (input.resolvedType === 'FLOAT') {
      // Core numeric: should include a dimension reference
      const nameL = input.name.toLowerCase();
      if (!nameL.includes('dimension') && !nameL.includes('size') && !nameL.includes('spacing') &&
          !nameL.includes('radius') && !nameL.includes('opacity') && !nameL.includes('elevation') &&
          segments.length < 2) {
        violations.push({
          ruleId: 'hierarchy.core-numeric-naming',
          category: 'Hierarchy & Structure',
          severity: 'info',
          message: `Core numeric token "${input.name}" should be named by property and value (e.g. dimensions/4, spacing/8).`,
          suggestion: `Prefix with the property category: dimensions, spacing, radius, opacity, or elevation.`,
          weight: 10,
        });
      }
    }
  }

  // Semantic tokens: must be named by function
  if (tier === 'semantic') {
    if (input.resolvedType === 'COLOR') {
      const firstSeg = segments[0].toLowerCase();
      const hasFunctionalRoot = SEMANTIC_COLOR_CATEGORIES.some(cat =>
        firstSeg.includes(cat)
      ) || FUNCTIONAL_COLOR_KEYWORDS.some(kw =>
        firstSeg.includes(kw)
      );

      if (!hasFunctionalRoot && segments.length >= 1) {
        violations.push({
          ruleId: 'hierarchy.semantic-color-naming',
          category: 'Hierarchy & Structure',
          severity: 'warning',
          message: `Semantic color token "${input.name}" should start with a functional category (e.g. Background, Foreground, Surface, Border).`,
          suggestion: `Rename to [Function]/[Context] pattern: Background/Surface/Surface Dim, Foreground/Brand, etc.`,
          weight: 20,
        });
      }
    }
  }

  return violations;
}

function detectTier(collectionName: string): 'core' | 'semantic' | 'component' | null {
  for (const [tier, keywords] of Object.entries(HIERARCHY_TIERS)) {
    if (keywords.some(kw => collectionName.includes(kw))) {
      return tier as 'core' | 'semantic' | 'component';
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Color Naming Conventions (The Scale Rule)
// ════════════════════════════════════════════════════════════════════════════

function validateColorNaming(input: TokenInput): NamingViolation[] {
  if (input.resolvedType !== 'COLOR') return [];

  const violations: NamingViolation[] = [];
  const segments = input.name.split('/').map(s => s.trim());
  const nameLower = input.name.toLowerCase();
  const tier = detectTier(input.collectionName.toLowerCase().trim());

  // ── Scale validation for Core tier ──────────────────────────────────
  if (tier === 'core') {
    const leaf = segments[segments.length - 1];
    const scaleNum = parseInt(leaf, 10);

    if (!isNaN(scaleNum)) {
      // Check if scale is in the recognized range
      if (!VALID_COLOR_SCALES.includes(scaleNum)) {
        // Find nearest valid scale
        const nearest = VALID_COLOR_SCALES.reduce((prev, curr) =>
          Math.abs(curr - scaleNum) < Math.abs(prev - scaleNum) ? curr : prev
        );
        violations.push({
          ruleId: 'color.invalid-scale',
          category: 'Color Naming',
          severity: 'warning',
          message: `Scale value "${scaleNum}" is not in the standard 50–980 range. Nearest standard value: ${nearest}.`,
          suggestion: `Use standard scale values: 50, 100, 150, 200, ..., 900, 950, 980. The value 500 is typically the source color.`,
          weight: 10,
        });
      }
    }
  }

  // ── Tone modifier validation ────────────────────────────────────────
  if (tier === 'semantic') {
    const leaf = segments[segments.length - 1].toLowerCase();
    const hasToneModifier = TONE_MODIFIERS.some(tm => leaf.includes(tm));
    const parentSeg = segments.length >= 2 ? segments[segments.length - 2].toLowerCase() : '';

    // If a tone modifier is used, it should be the leaf, not mixed into a parent
    if (!hasToneModifier && segments.length >= 3) {
      for (let i = 0; i < segments.length - 1; i++) {
        const segL = segments[i].toLowerCase();
        if (TONE_MODIFIERS.some(tm => segL === tm)) {
          violations.push({
            ruleId: 'color.misplaced-tone-modifier',
            category: 'Color Naming',
            severity: 'info',
            message: `Tone modifier "${segments[i]}" should be the last segment in the token path, not in the middle.`,
            suggestion: `Move the modifier to the leaf: "${segments.filter((_, idx) => idx !== i).join('/')}/${segments[i]}".`,
            weight: 8,
          });
        }
      }
    }
  }

  // ── Functional keyword validation ───────────────────────────────────
  if (tier === 'semantic' || tier === 'component') {
    const hasState = FUNCTIONAL_COLOR_KEYWORDS.some(kw => nameLower.includes(kw));
    const hasCategory = SEMANTIC_COLOR_CATEGORIES.some(cat => nameLower.includes(cat));

    if (!hasState && !hasCategory && segments.length >= 2) {
      violations.push({
        ruleId: 'color.missing-functional-keyword',
        category: 'Color Naming',
        severity: 'info',
        message: `Semantic/component color "${input.name}" lacks a functional keyword or category.`,
        suggestion: `Include a functional term (Success, Error, Warning, Information) or category (Background, Foreground, Surface, Border).`,
        weight: 8,
      });
    }
  }

  return violations;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Interaction States Mapping
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate the interaction-state naming pattern:
 * [Theme].[Interactive States].[State].[Category].[Token]
 */
function validateInteractionStates(input: TokenInput): NamingViolation[] {
  const violations: NamingViolation[] = [];
  const nameLower = input.name.toLowerCase();
  const segments = input.name.split('/').map(s => s.trim());
  const segmentsLower = segments.map(s => s.toLowerCase());

  // Check if this token is an interactive state token
  const hasInteractiveMarker = segmentsLower.some(s =>
    s.includes('interactive') || s.includes('interaction') || s.includes('state')
  );
  const hasStateKeyword = segmentsLower.some(s =>
    INTERACTION_STATES.includes(s)
  );

  if (!hasInteractiveMarker && !hasStateKeyword) return []; // Not an interaction token

  // If it has a state keyword but not the proper structure
  if (hasStateKeyword && !hasInteractiveMarker) {
    violations.push({
      ruleId: 'interaction.missing-interactive-segment',
      category: 'Interaction States',
      severity: 'warning',
      message: `Token "${input.name}" contains a state keyword but lacks the "Interactive States" path segment.`,
      suggestion: `Follow the pattern: [Theme]/Interactive States/[State]/[Category]/[Token] (e.g. White/Interactive States/Hover/Neutral/Background/Container).`,
      weight: 15,
    });
  }

  // Validate the full structure: [Theme].[Interactive States].[State].[Category].[Token]
  if (hasInteractiveMarker) {
    const interactiveIdx = segmentsLower.findIndex(s =>
      s.includes('interactive') || s.includes('interaction')
    );

    // Must have theme before Interactive States
    if (interactiveIdx === 0) {
      violations.push({
        ruleId: 'interaction.missing-theme',
        category: 'Interaction States',
        severity: 'info',
        message: `Token "${input.name}" starts with Interactive States but should have a theme prefix.`,
        suggestion: `Add a theme prefix: [Theme]/Interactive States/... (e.g. White/Interactive States/..., Dark/Interactive States/...).`,
        weight: 10,
      });
    }

    // Must have state after Interactive States
    if (interactiveIdx >= 0 && interactiveIdx < segments.length - 1) {
      const stateSegment = segmentsLower[interactiveIdx + 1];
      const isValidState = INTERACTION_STATES.includes(stateSegment);

      if (!isValidState) {
        violations.push({
          ruleId: 'interaction.invalid-state',
          category: 'Interaction States',
          severity: 'warning',
          message: `"${segments[interactiveIdx + 1]}" is not a recognized interaction state.`,
          suggestion: `Use one of: ${INTERACTION_STATES.join(', ')}.`,
          weight: 12,
        });
      }
    }

    // Must have enough depth: Theme + Interactive States + State + Category + Token = 5
    if (segments.length < 4) {
      violations.push({
        ruleId: 'interaction.insufficient-depth',
        category: 'Interaction States',
        severity: 'info',
        message: `Interactive state token "${input.name}" has only ${segments.length} segments; expected at least 5.`,
        suggestion: `Full pattern: [Theme]/[Interactive States]/[State]/[Category]/[Token].`,
        weight: 8,
      });
    }
  }

  return violations;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Mode Validation
// ════════════════════════════════════════════════════════════════════════════

function validateModes(input: TokenInput): NamingViolation[] {
  const violations: NamingViolation[] = [];

  // Every token should belong to at least one mode
  if (input.modeCount === 0) {
    violations.push({
      ruleId: 'mode.no-modes',
      category: 'Mode-Specific',
      severity: 'critical',
      message: `Token "${input.name}" has no modes defined. Every token must belong to at least one mode for automatic theming.`,
      suggestion: `Define the token in at least one mode (e.g. Light, Dark).`,
      weight: 25,
    });
  }

  // Mode name recognition disabled — custom mode names (e.g. foundation) are valid

  // Semantic/component tokens should ideally have multiple modes
  const tier = detectTier(input.collectionName.toLowerCase().trim());
  if ((tier === 'semantic' || tier === 'component') && input.resolvedType === 'COLOR' && input.modeCount < 2) {
    violations.push({
      ruleId: 'mode.single-mode-semantic',
      category: 'Mode-Specific',
      severity: 'info',
      message: `Semantic/component color token "${input.name}" only has ${input.modeCount} mode. Multi-theme support requires at least 2 modes (e.g. Light + Dark).`,
      suggestion: `Add a second mode (e.g. Dark) to enable automatic theming.`,
      weight: 10,
    });
  }

  return violations;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Typography & Layout Validation
// ════════════════════════════════════════════════════════════════════════════

function validateTypographyAndLayout(input: TokenInput | StyleInput): NamingViolation[] {
  const violations: NamingViolation[] = [];
  const nameLower = input.name.toLowerCase();
  const segments = input.name.split('/').map(s => s.trim().toLowerCase());

  // ── Typography size descriptors ─────────────────────────────────────
  const isTextStyle = ('styleType' in input && input.styleType === 'TEXT') ||
    nameLower.includes('text') || nameLower.includes('typo') ||
    nameLower.includes('font') || nameLower.includes('title') ||
    nameLower.includes('body') || nameLower.includes('label') ||
    nameLower.includes('heading') || nameLower.includes('display');

  if (isTextStyle) {
    const hasSizeDescriptor = TYPOGRAPHY_SIZES.some(size => {
      const sizeParts = size.split('-');
      // Match "title-L", "title L", "Title/L" etc.
      return segments.some(seg =>
        seg === size || seg.replace(/[-_\s]/g, '') === size.replace(/-/g, '')
      ) || (sizeParts.length === 2 && segments.some(seg =>
        seg.includes(sizeParts[0]) && seg.includes(sizeParts[1])
      ));
    });

    const hasRawNumber = segments.some(seg => /^\d+$/.test(seg));

    if (!hasSizeDescriptor && !hasRawNumber) {
      violations.push({
        ruleId: 'typography.missing-size-descriptor',
        category: 'Typography & Layout',
        severity: 'info',
        message: `Typography token "${input.name}" should use t-shirt sizing or descriptors (title-L, body-M, microcopy, etc.).`,
        suggestion: `Include a size descriptor: title-L, title-M, title-S, body-L, body-M, body-S, label-L, label-M, label-S, microcopy.`,
        weight: 8,
      });
    }
  }

  // ── Dimensions (numeric tokens in Core) ─────────────────────────────
  const isNumeric = ('resolvedType' in input && (input as TokenInput).resolvedType === 'FLOAT');
  const isCoreDimension = isNumeric && nameLower.includes('dimension');

  if (isCoreDimension) {
    const leaf = segments[segments.length - 1];
    const dimValue = parseInt(leaf, 10);
    if (isNaN(dimValue)) {
      violations.push({
        ruleId: 'layout.dimension-not-numeric',
        category: 'Typography & Layout',
        severity: 'warning',
        message: `Dimension token "${input.name}" should end with a numeric value (e.g. dimensions/4 for 16px).`,
        suggestion: `Use a numeric leaf: Core/dimensions/4, Core/dimensions/8, etc.`,
        weight: 10,
      });
    }
  }

  // ── Grid / Breakpoint tokens ────────────────────────────────────────
  const isGridToken = nameLower.includes('grid') || nameLower.includes('breakpoint') ||
    nameLower.includes('layout') || nameLower.includes('container');

  if (isGridToken) {
    const hasBreakpoint = BREAKPOINT_NAMES.some(bp =>
      segments.some(seg => seg.includes(bp.replace(/\s+/g, '-')) || seg.includes(bp))
    );

    if (!hasBreakpoint && segments.length >= 2) {
      violations.push({
        ruleId: 'layout.missing-breakpoint',
        category: 'Typography & Layout',
        severity: 'info',
        message: `Grid/layout token "${input.name}" should specify a device breakpoint.`,
        suggestion: `Define per device: S Mobile, M Tablet, L Laptop, XL Desktop.`,
        weight: 8,
      });
    }
  }

  return violations;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. General Naming Quality
// ════════════════════════════════════════════════════════════════════════════

function validateGeneralNaming(input: TokenInput | StyleInput): NamingViolation[] {
  const violations: NamingViolation[] = [];
  const segments = input.name.split('/').map(s => s.trim());

  // ── Minimum depth ──────────────────────────────────────────────────
  if (segments.length < 2) {
    violations.push({
      ruleId: 'naming.shallow-path',
      category: 'Naming Quality',
      severity: 'warning',
      message: `Token "${input.name}" has only ${segments.length} segment(s). Design tokens should have at least 2 levels of hierarchy.`,
      suggestion: `Use a slash-separated path: [Category]/[Name] at minimum (e.g. neutral/500, Background/Surface).`,
      weight: 12,
    });
  }

  // ── No numbers-only segments (except scale values at the leaf) ─────
  for (let i = 0; i < segments.length - 1; i++) {
    if (/^\d+$/.test(segments[i])) {
      violations.push({
        ruleId: 'naming.numeric-parent',
        category: 'Naming Quality',
        severity: 'info',
        message: `Segment "${segments[i]}" in "${input.name}" is purely numeric. Parent segments should be descriptive.`,
        suggestion: `Use descriptive names for parent segments; numeric values belong at the leaf level only.`,
        weight: 5,
      });
      break;
    }
  }

  // ── No empty segments ──────────────────────────────────────────────
  if (segments.some(s => s.length === 0)) {
    violations.push({
      ruleId: 'naming.empty-segment',
      category: 'Naming Quality',
      severity: 'warning',
      message: `Token "${input.name}" contains empty path segments (double slashes).`,
      suggestion: `Remove consecutive slashes and ensure every segment has a name.`,
      weight: 10,
    });
  }

  return violations;
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Public API — Main Validators
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate a variable/token against all design system naming rules.
 * Returns an array of violations (empty = fully compliant).
 */
export function validateToken(input: TokenInput): NamingViolation[] {
  return [
    ...validateHierarchy(input),
    ...validateColorNaming(input),
    ...validateInteractionStates(input),
    ...validateModes(input),
    ...validateTypographyAndLayout(input),
    ...validateGeneralNaming(input),
  ];
}

/**
 * Validate a style against design system naming rules.
 * Returns an array of violations (empty = fully compliant).
 */
export function validateStyle(input: StyleInput): NamingViolation[] {
  return [
    ...validateTypographyAndLayout(input),
    ...validateGeneralNaming(input),
  ];
}

/**
 * Get a summary label for a token's hierarchy tier, for display.
 */
export function getTokenTierLabel(collectionName: string): string {
  const tier = detectTier(collectionName.toLowerCase().trim());
  if (tier === 'core') return 'Core (Primitive)';
  if (tier === 'semantic') return 'Semantic';
  if (tier === 'component') return 'Component / Scheme';
  return 'Unknown Tier';
}

/**
 * Check if a color token uses a valid numeric scale.
 * Useful for quick inline checks without running the full validator.
 */
export function isValidColorScale(scaleValue: number): boolean {
  return VALID_COLOR_SCALES.includes(scaleValue);
}

/** Exported for tests / external usage */
export { detectTier, VALID_COLOR_SCALES, INTERACTION_STATES, TYPOGRAPHY_SIZES, BREAKPOINT_NAMES };
