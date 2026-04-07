/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Context Maturity & Auto-Description Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *
 *  ┌─────────────────────┐
 *  │  ContextMaturity     │  ← Scores a design-system entity on three
 *  │  Evaluator           │    dimensions: Functional Integrity, Usage
 *  │                      │    Density, and Description Quality.
 *  └────────┬────────────┘
 *           │ score
 *  ┌────────▼────────────┐
 *  │  MaturityWorkflow    │  ← Orchestrates the decision loop:
 *  │  Orchestrator        │    Score → (auto-generate?) → re-score → emit
 *  └────────┬────────────┘
 *           │ if score < 0.5
 *  ┌────────▼────────────┐
 *  │  Auto-Description    │  ← Synthesises a purpose statement from
 *  │  Generator           │    structural signals when context is thin.
 *  └─────────────────────┘
 *
 * This module is a **pure domain module** — no Figma globals, no UI code.
 * It receives pre-extracted signals and returns deterministic output.
 * The Figma integration layer (code.ts) is responsible for extracting
 * those signals and passing them in.
 *
 * All public types are re-exported so consumers only import from here.
 */

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

/**
 * Maturity levels map to workflow actions:
 *   Mature  → no action needed
 *   Partial → generate description, flag for review
 *   Thin    → generate description, must review before applying
 */
export type MaturityLevel = 'Mature' | 'Partial' | 'Thin';

/**
 * The purpose category classifies *what kind* of entity this is,
 * allowing downstream consumers to filter / group issues.
 */
export type PurposeCategory =
  | 'design-token'      // color, spacing, sizing, opacity …
  | 'typography'        // text style, font family
  | 'visual-effect'     // shadow, blur, layer effect
  | 'ui-component'      // button, card, input …
  | 'layout-primitive'  // frame, section, auto-layout container
  | 'variant'           // a single variant of a component set
  | 'unknown';

/**
 * Signals extracted from a single design-system entity.
 * The caller (code.ts) builds this from Figma API data;
 * the engine never touches Figma globals directly.
 */
export interface EntitySignals {
  // ── Identity ─────────────────────────────────────────────────────────
  /** Full slash-separated name, e.g. "colors/brand/primary/500" */
  name: string;
  /** Figma node / variable / style type */
  entityType: 'Variable' | 'PaintStyle' | 'TextStyle' | 'EffectStyle'
            | 'Component' | 'ComponentSet';

  // ── Functional-Integrity signals ─────────────────────────────────────
  /** Does the entity have an explicit description / JSDoc? */
  hasDescription: boolean;
  /** The raw description text (empty string if missing) */
  descriptionText: string;
  /** Does the entity have at least one consumer / reference? */
  hasConsumers: boolean;
  /** Number of distinct consumers (instances, variable bindings, …) */
  consumerCount: number;

  // ── Usage-Density signals ────────────────────────────────────────────
  /** Collection / group / library the entity belongs to */
  collectionName: string;
  /** Number of modes (variables) or paint layers (styles) */
  modeOrLayerCount: number;
  /** Resolved type for variables (COLOR | FLOAT | STRING | BOOLEAN) */
  resolvedType?: string;
  /** Hex value for color entities */
  colorHex?: string;
  /** Number of component properties (for Component/ComponentSet) */
  propertyCount: number;
  /** Number of variant children (for ComponentSet) */
  variantCount: number;
  /** Whether a documentation link exists */
  hasDocumentationLink: boolean;

  // ── Description-Quality signals ──────────────────────────────────────
  /** Does the description explain *why* (purpose) vs *what* (impl)? */
  descriptionExplainsPurpose: boolean;
  /** Character length of description */
  descriptionLength: number;
  /** Does the name follow a recognizable naming convention? */
  followsNamingConvention: boolean;
  /** Slash-depth of the name hierarchy */
  namingDepth: number;
}

/**
 * Per-dimension breakdown returned by the evaluator.
 */
export interface DimensionScores {
  /** Does this entity have clear inputs & outputs? */
  functionalIntegrity: number;
  /** How connected is this entity to the rest of the workspace? */
  usageDensity: number;
  /** Is there a high-level explanation of purpose? */
  descriptionQuality: number;
}

/**
 * Optional MCP enrichment data fed into the engine from a local MCP server.
 * When provided, the engine uses git history and dependency data to:
 *   - Boost or penalize the reliability score
 *   - Fill the Purpose field from commit messages
 */
export interface MCPEnrichmentInput {
  /** Reliability score (0–1) from git + dependency analysis */
  reliabilityScore: number;
  /** Purpose text extracted from git commit messages */
  extractedPurpose: string | null;
  /** Whether the purpose came from git (vs. synthesized) */
  purposeFromGit: boolean;
  /** Confidence in the extracted purpose (0–1) */
  purposeConfidence: number;
  /** Number of commits that touched this entity's file */
  commitCount: number;
  /** Number of files that depend on / consume this entity */
  dependencyCount: number;
}

/**
 * The final output produced by the workflow orchestrator.
 */
export interface MaturityResult {
  /** Weighted aggregate (0.0 – 1.0) */
  score: number;
  /** Purpose statement (auto-generated when score < 0.5) */
  description: string;
  /** Classification of this entity's role */
  purposeCategory: PurposeCategory;
  /** Human-readable maturity band */
  maturityLevel: MaturityLevel;
  /** Per-dimension breakdown */
  dimensions: DimensionScores;
  /** Whether the description was auto-generated */
  wasAutoGenerated: boolean;
  /** If auto-generated, the re-evaluated score after generation */
  reEvaluatedScore?: number;
  /** Actionable gaps the user should address */
  gaps: string[];
  /** Composite score blending internal maturity + external reliability (when MCP data present) */
  compositeScore?: number;
  /** External reliability score from MCP git/dependency analysis */
  reliabilityScore?: number;
  /** Whether the purpose was sourced from git commit history */
  purposeFromGit?: boolean;
  /** Notion rule compliance ratio (0–1), present when Notion rules were checked */
  notionComplianceRatio?: number;
  /** Notion rule weighted penalty applied to this entity */
  notionPenalty?: number;
  /** Number of Notion rules violated */
  notionViolatedCount?: number;
}

/**
 * Notion rule compliance data fed into the engine from the Notion Rule Engine.
 * When provided, non-compliance penalizes the maturity score.
 */
export interface NotionRuleComplianceInput {
  /** Overall compliance ratio (0.0 – 1.0) */
  complianceRatio: number;
  /** Weighted penalty to subtract from maturity score (0.0 – 0.4) */
  weightedPenalty: number;
  /** Number of rules violated */
  violatedCount: number;
  /** Best rationale / "Why" from the most relevant violated rule */
  bestRationale: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Context Maturity Evaluator
// ════════════════════════════════════════════════════════════════════════════

/**
 * Stateless evaluator. Instantiate once, call `evaluate()` per entity.
 *
 * The three scoring dimensions are weighted:
 *   Functional Integrity : 35 %
 *   Usage Density        : 30 %
 *   Description Quality  : 35 %
 *
 * Thresholds:
 *   ≥ 0.8 → Mature
 *   ≥ 0.5 → Partial
 *   < 0.5 → Thin  (triggers auto-description)
 */
export class ContextMaturityEvaluator {

  // ── Configurable knobs ───────────────────────────────────────────────
  private static readonly W_INTEGRITY   = 0.35;
  private static readonly W_DENSITY     = 0.30;
  private static readonly W_DESCRIPTION = 0.35;

  private static readonly MATURE_THRESHOLD  = 0.8;
  private static readonly PARTIAL_THRESHOLD = 0.5;

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Score a single entity.
   * Pure function — no side effects, no Figma API calls.
   */
  evaluate(signals: EntitySignals): {
    score: number;
    dimensions: DimensionScores;
    maturityLevel: MaturityLevel;
    gaps: string[];
  } {
    const fi = this.scoreFunctionalIntegrity(signals);
    const ud = this.scoreUsageDensity(signals);
    const dq = this.scoreDescriptionQuality(signals);

    const raw =
      fi * ContextMaturityEvaluator.W_INTEGRITY +
      ud * ContextMaturityEvaluator.W_DENSITY +
      dq * ContextMaturityEvaluator.W_DESCRIPTION;

    const score = Math.round(raw * 100) / 100;
    const maturityLevel = this.levelFromScore(score);
    const gaps = this.collectGaps(signals);

    return {
      score,
      dimensions: {
        functionalIntegrity: Math.round(fi * 100) / 100,
        usageDensity:        Math.round(ud * 100) / 100,
        descriptionQuality:  Math.round(dq * 100) / 100,
      },
      maturityLevel,
      gaps,
    };
  }

  // ── Dimension 1 : Functional Integrity (0 → 1) ──────────────────────

  private scoreFunctionalIntegrity(s: EntitySignals): number {
    let pts = 0;
    let max = 0;

    // Has an explicit description at all? (highest weight)
    max += 3;
    if (s.hasDescription && s.descriptionLength > 0)  pts += 3;

    // Has at least one consumer / reference?
    max += 2;
    if (s.hasConsumers) pts += 1;
    if (s.consumerCount >= 3) pts += 1; // well-connected

    // Has a documentation link?
    max += 1;
    if (s.hasDocumentationLink) pts += 1;

    // Entity-specific structural completeness
    if (s.entityType === 'Variable') {
      max += 2;
      if (s.resolvedType) pts += 1;
      if (s.modeOrLayerCount > 0) pts += 1;
    } else if (s.entityType === 'Component' || s.entityType === 'ComponentSet') {
      max += 2;
      if (s.propertyCount > 0) pts += 1;
      if (s.entityType === 'ComponentSet' && s.variantCount > 0) pts += 1;
      if (s.entityType === 'Component') pts += 1; // standalone component is complete
    } else {
      // Styles
      max += 1;
      if (s.modeOrLayerCount > 0) pts += 1;
    }

    return max > 0 ? Math.min(1, pts / max) : 0;
  }

  // ── Dimension 2 : Usage Density (0 → 1) ─────────────────────────────

  private scoreUsageDensity(s: EntitySignals): number {
    let pts = 0;
    let max = 0;

    // Belongs to a named collection / group?
    max += 2;
    if (s.collectionName && s.collectionName.length > 0) pts += 2;

    // Naming-hierarchy depth (deeper = richer semantics)
    max += 2;
    if (s.namingDepth >= 3) pts += 2;
    else if (s.namingDepth >= 2) pts += 1;

    // Follows a recognizable naming convention?
    max += 1;
    if (s.followsNamingConvention) pts += 1;

    // Consumer count is a proxy for "how widely used"
    max += 2;
    if (s.consumerCount >= 5) pts += 2;
    else if (s.consumerCount >= 1) pts += 1;

    // Variables: has values in multiple modes?
    if (s.entityType === 'Variable') {
      max += 1;
      if (s.modeOrLayerCount >= 2) pts += 1;
    }

    // Components: has multiple properties?
    if (s.entityType === 'Component' || s.entityType === 'ComponentSet') {
      max += 1;
      if (s.propertyCount >= 2) pts += 1;
    }

    return max > 0 ? Math.min(1, pts / max) : 0;
  }

  // ── Dimension 3 : Description Quality (0 → 1) ──────────────────────

  private scoreDescriptionQuality(s: EntitySignals): number {
    // No description at all → 0
    if (!s.hasDescription || s.descriptionLength === 0) return 0;

    let score = 0;

    // Length bands (brief → adequate → thorough)
    if (s.descriptionLength >= 80) score += 0.35;
    else if (s.descriptionLength >= 40) score += 0.25;
    else if (s.descriptionLength >= 10) score += 0.10;

    // Explains *purpose* (Why) rather than just restating the name (What)?
    if (s.descriptionExplainsPurpose) {
      score += 0.40;
    }

    // Naming convention adds implicit description quality
    if (s.followsNamingConvention) score += 0.10;
    if (s.namingDepth >= 2) score += 0.05;
    if (s.namingDepth >= 3) score += 0.10;

    return Math.min(1, score);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private levelFromScore(score: number): MaturityLevel {
    if (score >= ContextMaturityEvaluator.MATURE_THRESHOLD)  return 'Mature';
    if (score >= ContextMaturityEvaluator.PARTIAL_THRESHOLD) return 'Partial';
    return 'Thin';
  }

  private collectGaps(s: EntitySignals): string[] {
    const gaps: string[] = [];

    if (!s.hasDescription) gaps.push('Missing description');
    else if (s.descriptionLength < 20) gaps.push('Description is too brief (< 20 chars)');
    if (!s.descriptionExplainsPurpose && s.hasDescription) {
      gaps.push('Description restates the name instead of explaining purpose');
    }
    if (!s.hasConsumers) gaps.push('No consumers or references found');
    if (!s.hasDocumentationLink) gaps.push('No documentation link');
    if (s.namingDepth < 2) gaps.push('Name lacks hierarchy (e.g. category/name)');
    if (!s.followsNamingConvention) gaps.push('Name does not follow a standard convention');
    if (!s.collectionName) gaps.push('Not assigned to a collection or group');

    if (s.entityType === 'Variable' && !s.resolvedType) {
      gaps.push('Variable type is unknown');
    }
    if (s.entityType === 'ComponentSet' && s.variantCount === 0) {
      gaps.push('Component set has no variant children');
    }
    if ((s.entityType === 'Component' || s.entityType === 'ComponentSet') && s.propertyCount === 0) {
      gaps.push('No component properties defined');
    }

    return gaps;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Auto-Description Generator
// ════════════════════════════════════════════════════════════════════════════

/**
 * The LLM system prompt to use when calling an external model.
 *
 * Export it so the caller can feed it into any LLM provider (OpenAI,
 * Anthropic, local model, etc.) without coupling this module to a
 * specific SDK.
 */
export const LLM_SYSTEM_PROMPT = `You are a Senior Design System Architect writing documentation for a design-system token library inside Figma.

Your job is to produce a concise **Purpose Statement** for a single design-system entity (variable, style, or component).

A Purpose Statement MUST answer THREE questions:
1. **What is it?** — One-sentence identification of the entity type and role.
2. **Why does it exist?** — The design decision or constraint it encodes.
3. **When should it be used?** — A concrete usage guideline.

Rules:
- Output ONLY the Purpose Statement — no preamble, no markdown, no headings.
- Keep it between 40 and 120 words.
- Never restate the entity's name as the entire description.
- Prefer active voice and second-person ("Use this…") for the guideline.
- If you receive a hex color, describe its visual role (e.g. "brand accent").
- If the entity has variant children, summarize the variant axis purpose.
- If context is thin, state what you can infer and note the confidence gap.`;

/**
 * Build the user-prompt that accompanies the system prompt above.
 * This is a deterministic string-builder — no LLM call happens here.
 */
export function buildLLMUserPrompt(signals: EntitySignals): string {
  const lines: string[] = [];

  lines.push(`Entity name: ${signals.name}`);
  lines.push(`Type: ${signals.entityType}`);

  if (signals.collectionName) {
    lines.push(`Collection: ${signals.collectionName}`);
  }
  if (signals.resolvedType) {
    lines.push(`Resolved type: ${signals.resolvedType}`);
  }
  if (signals.colorHex) {
    lines.push(`Color value: ${signals.colorHex}`);
  }
  if (signals.modeOrLayerCount > 0) {
    lines.push(`Modes / layers: ${signals.modeOrLayerCount}`);
  }
  if (signals.propertyCount > 0) {
    lines.push(`Component properties: ${signals.propertyCount}`);
  }
  if (signals.variantCount > 0) {
    lines.push(`Variant children: ${signals.variantCount}`);
  }
  if (signals.consumerCount > 0) {
    lines.push(`Consumer count: ${signals.consumerCount}`);
  }
  if (signals.descriptionText) {
    lines.push(`Existing description: "${signals.descriptionText}"`);
  }

  lines.push('');
  lines.push('Write a Purpose Statement for this entity.');

  return lines.join('\n');
}

/**
 * Generates a purpose-driven description **locally** (no LLM call) using
 * heuristic templates. This is the fallback / default path that runs inside
 * the Figma plugin sandbox where network calls may not be available.
 *
 * For higher-quality output, the caller can instead send
 * `{ system: LLM_SYSTEM_PROMPT, user: buildLLMUserPrompt(signals) }`
 * to an external LLM endpoint and use the response.
 */
export function generatePurposeDescription(
  signals: EntitySignals,
): string {
  const leaf = signals.name.split('/').pop() || signals.name;
  const readable = signals.name.split('/').map(s => s.replace(/[-_]/g, ' ')).join(' / ');
  const collection = signals.collectionName ? ` in the "${signals.collectionName}" collection` : '';

  // ── Variables ────────────────────────────────────────────────────────
  if (signals.entityType === 'Variable') {
    return generateVariableDescription(signals, leaf, readable, collection);
  }

  // ── Styles ───────────────────────────────────────────────────────────
  if (signals.entityType === 'PaintStyle') {
    const colorNote = signals.colorHex ? ` (${signals.colorHex})` : '';
    return `Color style "${readable}"${colorNote}${collection}. ` +
      `Defines a reusable fill or color value for consistent visual styling across the design system. ` +
      `Use this style instead of hard-coded color values to ensure theme-ability and maintainability.`;
  }

  if (signals.entityType === 'TextStyle') {
    return `Typography style "${readable}"${collection}. ` +
      `Encodes a specific typographic treatment (font family, size, weight, line-height) ` +
      `that enforces visual consistency for text elements. ` +
      `Apply this style to text layers rather than setting properties manually.`;
  }

  if (signals.entityType === 'EffectStyle') {
    return `Effect style "${readable}"${collection}. ` +
      `Captures a reusable visual effect (shadow, blur, or layer blend) ` +
      `that maintains elevation and depth consistency across the UI. ` +
      `Use this instead of per-layer effect settings.`;
  }

  // ── Components ───────────────────────────────────────────────────────
  if (signals.entityType === 'ComponentSet') {
    const variantNote = signals.variantCount > 0
      ? ` Contains ${signals.variantCount} variant${signals.variantCount !== 1 ? 's' : ''} ` +
        `exposing different visual or behavioral states.`
      : '';
    const propNote = signals.propertyCount > 0
      ? ` Configurable through ${signals.propertyCount} propert${signals.propertyCount !== 1 ? 'ies' : 'y'}.`
      : '';
    return `Component family "${readable}".${variantNote}${propNote} ` +
      `Use this component set to maintain consistency and reduce drift when building UI with this element.`;
  }

  if (signals.entityType === 'Component') {
    const propNote = signals.propertyCount > 0
      ? ` Accepts ${signals.propertyCount} propert${signals.propertyCount !== 1 ? 'ies' : 'y'} for configuration.`
      : '';
    return `UI component "${readable}"${collection}.${propNote} ` +
      `A reusable building block that encapsulates specific visual and interactive behavior. ` +
      `Prefer using this component over detached copies to ensure design-system consistency.`;
  }

  // ── Fallback ─────────────────────────────────────────────────────────
  return `Design entity "${readable}"${collection}. Purpose and usage guidelines should be documented here.`;
}

// ── Variable-specific description builder ────────────────────────────────

function generateVariableDescription(
  signals: EntitySignals,
  leaf: string,
  readable: string,
  collection: string,
): string {
  const type = (signals.resolvedType || 'unknown').toUpperCase();

  // COLOR variables
  if (type === 'COLOR') {
    const hex = signals.colorHex || '';
    const role = inferColorRole(leaf);
    return `Color token "${readable}"${collection}${hex ? ` — value ${hex}` : ''}. ` +
      `Represents ${role}. ` +
      `Use this token for ${inferColorUsage(leaf)} to ensure consistent theming across light and dark modes.`;
  }

  // FLOAT variables (spacing, sizing, radius, opacity …)
  if (type === 'FLOAT') {
    const role = inferNumericRole(leaf);
    return `Numeric token "${readable}"${collection}. ` +
      `Controls ${role}. ` +
      `Reference this token instead of hard-coded values to maintain spatial consistency at scale.`;
  }

  // STRING variables
  if (type === 'STRING') {
    return `String token "${readable}"${collection}. ` +
      `Stores a localizable or configurable text value used by the design system. ` +
      `Bind components to this token for centralized copy management.`;
  }

  // BOOLEAN variables
  if (type === 'BOOLEAN') {
    return `Boolean token "${readable}"${collection}. ` +
      `Acts as a feature flag or conditional toggle that drives visibility or behavior ` +
      `of component layers. Use to enable/disable features without structural changes.`;
  }

  // Unknown type
  const modeNote = signals.modeOrLayerCount > 1
    ? ` Defined across ${signals.modeOrLayerCount} modes for multi-theme support.`
    : '';
  return `Design token "${readable}"${collection}.${modeNote} ` +
    `Purpose and usage guidelines should be documented here.`;
}

// ── Heuristic helpers (name-based inference) ─────────────────────────────

function inferColorRole(leafName: string): string {
  const l = leafName.toLowerCase();
  // ── Brand / core palette ────────────────────────────────────────────
  if (/primary/.test(l))    return 'the primary brand color used for key interactive elements';
  if (/secondary/.test(l))  return 'a secondary brand color for supporting visual elements';
  if (/accent/.test(l))     return 'an accent color for highlights and call-to-action elements';
  if (/neutral/.test(l))    return 'a neutral palette color for surfaces, text, and borders';
  // ── Functional / semantic keywords ──────────────────────────────────
  if (/error|danger/.test(l))     return 'a semantic error/danger color for destructive states';
  if (/success|positive/.test(l)) return 'a semantic success color for positive feedback states';
  if (/warning|caution/.test(l))  return 'a semantic warning color for cautionary states';
  if (/info|information/.test(l)) return 'a semantic informational color';
  // ── Surface & layout categories ─────────────────────────────────────
  if (/background|bg/.test(l))    return 'a background surface color';
  if (/surface/.test(l))          return 'a surface-level fill color';
  if (/border|stroke/.test(l))    return 'a border/stroke color for element boundaries';
  if (/text|foreground|fg/.test(l)) return 'a foreground/text color';
  if (/overlay/.test(l))          return 'an overlay/scrim color for modals and dialogs';
  if (/shadow/.test(l))           return 'a shadow color for elevation depth';
  if (/icon/.test(l))             return 'an icon fill color';
  // ── Tone modifiers ─────────────────────────────────────────────────
  if (/dim/.test(l))              return 'a dimmed (lower-intensity) variant of its parent color';
  if (/bright/.test(l))           return 'a brightened (higher-intensity) variant of its parent color';
  if (/recessive/.test(l))        return 'a recessive (visually subdued) variant of its parent color';
  if (/inverse|inverted/.test(l)) return 'an inverted color for opposite-theme surfaces';
  // ── Interaction states ──────────────────────────────────────────────
  if (/disabled/.test(l))   return 'a muted color for disabled/non-interactive states';
  if (/hover/.test(l))      return 'an interactive hover-state color';
  if (/pressed/.test(l))    return 'an interactive pressed-state color';
  if (/focus/.test(l))      return 'a focus-ring or focus-state color';
  if (/visited/.test(l))    return 'a visited-link state color';
  // ── Numeric scale (core tier) ──────────────────────────────────────
  if (/\d{2,3}$/.test(l))   return `a palette step in the numeric color scale (value: ${l.match(/\d+$/)?.[0] || '?'})`;
  if (/source/.test(l))     return 'the source/base color of this palette (typically the 500 step)';
  return 'a color value within the design system palette';
}

function inferColorUsage(leafName: string): string {
  const l = leafName.toLowerCase();
  if (/primary/.test(l))    return 'buttons, links, and primary interactive surfaces';
  if (/secondary/.test(l))  return 'secondary buttons, tags, and supporting surfaces';
  if (/error|danger/.test(l))   return 'error messages, destructive buttons, and alert banners';
  if (/success/.test(l))    return 'success badges, confirmation dialogs, and positive indicators';
  if (/warning/.test(l))    return 'warning banners, caution icons, and alert text';
  if (/info|information/.test(l)) return 'informational banners, tooltips, and help text';
  if (/background|bg|surface/.test(l)) return 'page backgrounds, card fills, and container surfaces';
  if (/border|stroke/.test(l))  return 'dividers, input borders, and card outlines';
  if (/text|foreground|fg/.test(l)) return 'body text, headings, and label elements';
  if (/overlay/.test(l))    return 'modal scrims, dropdown overlays, and focus traps';
  if (/icon/.test(l))       return 'iconography across interactive and static elements';
  // ── Tone modifiers ─────────────────────────────────────────────────
  if (/dim/.test(l))        return 'subtle backgrounds and low-emphasis surfaces';
  if (/bright/.test(l))     return 'high-emphasis areas and call-to-action highlights';
  if (/recessive/.test(l))  return 'de-emphasized text, disabled UI, and background fills';
  if (/inverse|inverted/.test(l)) return 'inverted theme contexts (e.g. dark header on light page)';
  // ── Interaction states ──────────────────────────────────────────────
  if (/hover/.test(l))      return 'hover feedback on interactive elements';
  if (/pressed/.test(l))    return 'pressed/active feedback during user tap or click';
  if (/focus/.test(l))      return 'keyboard focus indicators for accessibility';
  if (/disabled/.test(l))   return 'greyed-out states for non-actionable elements';
  return 'the appropriate UI surfaces to maintain visual consistency';
}

function inferNumericRole(leafName: string): string {
  const l = leafName.toLowerCase();
  if (/spacing|space|gap/.test(l))    return 'spacing between elements (margin or gap)';
  if (/padding|inset/.test(l))        return 'internal padding within containers';
  if (/radius|corner/.test(l))        return 'border-radius for rounded corners';
  if (/size|width|height/.test(l))    return 'element sizing (width or height)';
  if (/opacity|alpha/.test(l))        return 'opacity / transparency levels';
  if (/elevation|shadow/.test(l))     return 'elevation depth for layered surfaces';
  if (/font-?size|text-?size/.test(l)) return 'typographic font size';
  if (/line-?height|leading/.test(l)) return 'typographic line height';
  if (/letter-?spacing|tracking/.test(l)) return 'letter-spacing / tracking';
  if (/border-?width|stroke-?width/.test(l)) return 'border or stroke thickness';
  if (/dimension/.test(l))            return 'a base dimension unit in the spatial scale (e.g. 4 = 16px)';
  if (/grid|column|gutter/.test(l))   return 'a grid layout parameter (column width, gutter, margin)';
  if (/breakpoint/.test(l))           return 'a responsive breakpoint threshold';
  return 'a numeric design-system parameter';
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Purpose-Category Classifier
// ════════════════════════════════════════════════════════════════════════════

/**
 * Classify an entity into a PurposeCategory based on its signals.
 */
export function classifyPurpose(signals: EntitySignals): PurposeCategory {
  switch (signals.entityType) {
    case 'Variable':
      return 'design-token';
    case 'PaintStyle':
      return 'design-token';
    case 'TextStyle':
      return 'typography';
    case 'EffectStyle':
      return 'visual-effect';
    case 'ComponentSet':
      return 'ui-component';
    case 'Component': {
      // Try to distinguish layout primitives from UI components
      const n = signals.name.toLowerCase();
      if (/^(frame|section|container|wrapper|layout|grid|stack|row|col)/i.test(n)) {
        return 'layout-primitive';
      }
      // If it lives inside a component set (name contains "/"), it may be a variant
      if (signals.namingDepth >= 2 && signals.variantCount === 0 && signals.propertyCount === 0) {
        return 'variant';
      }
      return 'ui-component';
    }
    default:
      return 'unknown';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Description-Quality Detector
// ════════════════════════════════════════════════════════════════════════════

/**
 * Heuristic check: does the description explain *purpose* (Why)
 * rather than just restating the entity name (What)?
 *
 * Returns `true` when the description contains purpose-signalling language.
 */
export function descriptionExplainsPurpose(
  name: string,
  description: string,
): boolean {
  if (!description || description.trim().length === 0) return false;

  const desc = description.toLowerCase();
  const leaf = (name.split('/').pop() || name).toLowerCase().replace(/[-_]/g, ' ');

  // If the description is essentially just the name, it's not purposeful
  if (desc.trim() === leaf.trim()) return false;
  if (desc.replace(/[^a-z0-9]/g, '') === leaf.replace(/[^a-z0-9]/g, '')) return false;

  // Purpose-signalling keywords
  const purposeSignals = [
    /\buse\b/,       /\bused\b/,       /\bfor\b/,
    /\bwhen\b/,      /\bensures?\b/,   /\bprovides?\b/,
    /\bcontrols?\b/, /\bdefines?\b/,   /\brepresents?\b/,
    /\bpurpose\b/,   /\brole\b/,       /\benables?\b/,
    /\bprevents?\b/, /\bmaintains?\b/,  /\bmanages?\b/,
    /\bconsisten/,   /\btheme\b/,      /\bbrand\b/,
    /\bsemantic\b/,  /\baccessib/,     /\bresponsiv/,
  ];

  return purposeSignals.some(rx => rx.test(desc));
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Workflow Orchestrator
// ════════════════════════════════════════════════════════════════════════════

/**
 * The main entry point. Runs the full evaluate → (auto-generate?) → emit
 * workflow and returns a `MaturityResult`.
 *
 * ```
 *  const engine = new MaturityEngine();
 *  const result = engine.run(signals);
 * ```
 */
export class MaturityEngine {
  private evaluator = new ContextMaturityEvaluator();

  /**
   * Execute the full maturity workflow for one entity.
   *
   * @param signals         Structural signals extracted from the Figma entity
   * @param mcpData         Optional enrichment from a local MCP server (git, deps)
   * @param notionCompliance Optional Notion rule compliance data
   */
  run(
    signals: EntitySignals,
    mcpData?: MCPEnrichmentInput,
    notionCompliance?: NotionRuleComplianceInput,
  ): MaturityResult {
    // ── Step 1: Initial evaluation ────────────────────────────────────
    // If MCP data is available, boost the signals before scoring
    const boostedSignals = mcpData
      ? this.applyMCPBoost(signals, mcpData)
      : signals;

    const initial = this.evaluator.evaluate(boostedSignals);
    const purposeCategory = classifyPurpose(signals);

    // ── Step 2: Decide on description source ──────────────────────────
    let description = signals.descriptionText;
    let wasAutoGenerated = false;
    let reEvaluatedScore: number | undefined;
    let purposeFromGit = false;

    // If MCP provides a high-confidence purpose from git, prefer it
    if (
      mcpData?.extractedPurpose &&
      mcpData.purposeFromGit &&
      mcpData.purposeConfidence >= 0.4
    ) {
      // Git commit messages contain a 'Why' — use it
      description = mcpData.extractedPurpose;
      wasAutoGenerated = true;
      purposeFromGit = true;
    } else if (initial.score < 0.5) {
      // Score is Thin → auto-generate a description
      description = generatePurposeDescription(signals);
      wasAutoGenerated = true;
    } else if (initial.maturityLevel === 'Partial') {
      // Score is 0.5–0.8 → keep existing description, but warn
      if (!description || description.trim().length === 0) {
        // Try MCP purpose first (even low confidence)
        if (mcpData?.extractedPurpose && mcpData.purposeConfidence >= 0.25) {
          description = mcpData.extractedPurpose;
          wasAutoGenerated = true;
          purposeFromGit = true;
        } else {
          description = generatePurposeDescription(signals);
          wasAutoGenerated = true;
        }
      }
    }
    // Score ≥ 0.8 → Mature, keep everything as-is

    // If the best Notion rationale provides a "Why" and we have no
    // description yet, use it to enrich the auto-generated one
    if (
      wasAutoGenerated &&
      notionCompliance?.bestRationale &&
      description
    ) {
      description = description + '\n\nDesign rule: ' + notionCompliance.bestRationale;
    }

    // ── Step 3: Re-evaluate if we generated a new description ────────
    if (wasAutoGenerated && description) {
      const enrichedSignals: EntitySignals = {
        ...boostedSignals,
        hasDescription: true,
        descriptionText: description,
        descriptionLength: description.length,
        descriptionExplainsPurpose: true,
      };
      const reEval = this.evaluator.evaluate(enrichedSignals);
      reEvaluatedScore = reEval.score;
    }

    // ── Step 4: Compute composite score (internal + external) ────────
    let compositeScore: number | undefined;
    let reliabilityScore: number | undefined;
    if (mcpData) {
      reliabilityScore = mcpData.reliabilityScore;
      // Blend: 70% internal maturity + 30% external reliability
      compositeScore = Math.round(
        (initial.score * 0.70 + mcpData.reliabilityScore * 0.30) * 100
      ) / 100;
    }

    // ── Step 5: Apply Notion rule compliance penalty ─────────────────
    let notionComplianceRatio: number | undefined;
    let notionPenalty: number | undefined;
    let notionViolatedCount: number | undefined;
    let finalScore = initial.score;

    if (notionCompliance) {
      notionComplianceRatio = notionCompliance.complianceRatio;
      notionPenalty = notionCompliance.weightedPenalty;
      notionViolatedCount = notionCompliance.violatedCount;

      // Subtract the penalty from the score (floor at 0)
      finalScore = Math.max(0, Math.round((initial.score - notionCompliance.weightedPenalty) * 100) / 100);

      // Also update composite score if present
      if (compositeScore !== undefined) {
        compositeScore = Math.max(0, Math.round((compositeScore - notionCompliance.weightedPenalty) * 100) / 100);
      }

      // Add Notion violation gaps
      if (notionCompliance.violatedCount > 0) {
        initial.gaps.push(
          `${notionCompliance.violatedCount} Notion design rule(s) violated — review compliance.`
        );
      }

      // Re-classify maturity level after penalty
      if (finalScore >= 0.8) {
        initial.maturityLevel = 'Mature' as MaturityLevel;
      } else if (finalScore >= 0.5) {
        initial.maturityLevel = 'Partial' as MaturityLevel;
      } else {
        initial.maturityLevel = 'Thin' as MaturityLevel;
      }
    }

    return {
      score: finalScore,
      description,
      purposeCategory,
      maturityLevel: initial.maturityLevel,
      dimensions: initial.dimensions,
      wasAutoGenerated,
      reEvaluatedScore,
      gaps: initial.gaps,
      compositeScore,
      reliabilityScore,
      purposeFromGit,
      notionComplianceRatio,
      notionPenalty,
      notionViolatedCount,
    };
  }

  /**
   * Convenience: evaluate only (no auto-generation), useful for
   * progress dashboards or batch scoring.
   */
  evaluateOnly(signals: EntitySignals): {
    score: number;
    dimensions: DimensionScores;
    maturityLevel: MaturityLevel;
    gaps: string[];
  } {
    return this.evaluator.evaluate(signals);
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Boost EntitySignals with external MCP data before scoring.
   *
   * Git data provides evidence of:
   *   - consumers (commits by others = implicit review)
   *   - usage density (dependency count → consumerCount boost)
   */
  private applyMCPBoost(
    signals: EntitySignals,
    mcp: MCPEnrichmentInput,
  ): EntitySignals {
    return {
      ...signals,
      // If local signals show zero consumers but git shows dependencies, boost
      hasConsumers: signals.hasConsumers || mcp.dependencyCount > 0,
      consumerCount: Math.max(signals.consumerCount, mcp.dependencyCount),
      // If git has a purpose and entity has no description, inject it
      hasDescription: signals.hasDescription || (mcp.extractedPurpose !== null && mcp.purposeConfidence >= 0.4),
      descriptionText: signals.hasDescription
        ? signals.descriptionText
        : (mcp.extractedPurpose || signals.descriptionText),
      descriptionLength: signals.hasDescription
        ? signals.descriptionLength
        : (mcp.extractedPurpose?.length || signals.descriptionLength),
      descriptionExplainsPurpose: signals.descriptionExplainsPurpose || mcp.purposeFromGit,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Signal Extraction Helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Known naming-convention patterns.
 * Exported so callers can reuse the same check.
 */
const NAMING_PATTERNS = [
  /^[a-z][a-z0-9-]*$/,                 // kebab-case (e.g. title-l, body-m)
  /^[a-z][a-zA-Z0-9]*$/,               // camelCase
  /^[A-Z][a-zA-Z0-9]*$/,               // PascalCase (e.g. Surface, Background)
  /^[A-Za-z][A-Za-z0-9 ]*$/,           // Title Case with spaces (e.g. "Primary Brand Color")
  /^\d{1,4}$/,                          // Numeric scale values (e.g. 50, 100, 500, 980)
  /^[A-Z][A-Za-z0-9 ]+[A-Z][a-z]+$/,  // Multi-word Title Case (e.g. "Surface Dim")
  /^Mode \d+$/i,                        // Mode names (e.g. "Mode 1")
  /^[SMLX]{1,2} [A-Za-z]+$/,           // Breakpoint names (e.g. "S Mobile", "XL Desktop")
];

/**
 * Check whether all slash-separated segments follow a recognizable
 * naming convention.
 */
export function checkNamingConvention(name: string): boolean {
  const segments = name.split('/');
  return segments.every(seg =>
    NAMING_PATTERNS.some(pat => pat.test(seg.trim()))
  );
}

/**
 * Build `EntitySignals` from a Figma Variable (call from code.ts).
 *
 * This is a convenience factory — it keeps the Figma-specific extraction
 * logic close to the types so code.ts stays thin.
 */
export function signalsFromVariable(
  variable: { name: string; description: string; resolvedType: string; valuesByMode: Record<string, any> },
  collectionName: string,
  colorHex?: string,
  consumerCount: number = 0,
): EntitySignals {
  const parts = variable.name.split('/');
  const desc = variable.description || '';

  return {
    name: variable.name,
    entityType: 'Variable',
    hasDescription: desc.trim().length > 0,
    descriptionText: desc,
    hasConsumers: consumerCount > 0,
    consumerCount,
    collectionName,
    modeOrLayerCount: Object.keys(variable.valuesByMode).length,
    resolvedType: variable.resolvedType,
    colorHex,
    propertyCount: 0,
    variantCount: 0,
    hasDocumentationLink: false,
    descriptionExplainsPurpose: descriptionExplainsPurpose(variable.name, desc),
    descriptionLength: desc.length,
    followsNamingConvention: checkNamingConvention(variable.name),
    namingDepth: parts.length,
  };
}

/**
 * Build `EntitySignals` from a Figma style (PaintStyle / TextStyle / EffectStyle).
 */
export function signalsFromStyle(
  style: { name: string; description: string; type: string; paints?: any[] },
  colorHex?: string,
  consumerCount: number = 0,
): EntitySignals {
  const parts = style.name.split('/');
  const desc = style.description || '';

  const entityType =
    style.type === 'PAINT'  ? 'PaintStyle'  as const :
    style.type === 'TEXT'   ? 'TextStyle'   as const :
                              'EffectStyle' as const;

  return {
    name: style.name,
    entityType,
    hasDescription: desc.trim().length > 0,
    descriptionText: desc,
    hasConsumers: consumerCount > 0,
    consumerCount,
    collectionName: '',
    modeOrLayerCount: style.paints ? style.paints.length : 0,
    resolvedType: undefined,
    colorHex,
    propertyCount: 0,
    variantCount: 0,
    hasDocumentationLink: false,
    descriptionExplainsPurpose: descriptionExplainsPurpose(style.name, desc),
    descriptionLength: desc.length,
    followsNamingConvention: checkNamingConvention(style.name),
    namingDepth: parts.length,
  };
}

/**
 * Build `EntitySignals` from a Figma component or component set.
 */
export function signalsFromComponent(
  node: {
    name: string;
    type: string;
    description?: string;
    documentationLinks?: { uri: string }[];
    componentPropertyDefinitions?: Record<string, any>;
    children?: any[];
  },
  consumerCount: number = 0,
): EntitySignals {
  const parts = node.name.split('/');
  const desc = node.description || '';
  const entityType = node.type === 'COMPONENT_SET' ? 'ComponentSet' as const : 'Component' as const;
  const propDefs = node.componentPropertyDefinitions || {};
  const propCount = Object.keys(propDefs).length;
  const variantCount = node.type === 'COMPONENT_SET' && node.children
    ? node.children.filter((c: any) => c.type === 'COMPONENT').length
    : 0;

  return {
    name: node.name,
    entityType,
    hasDescription: desc.trim().length > 0,
    descriptionText: desc,
    hasConsumers: consumerCount > 0,
    consumerCount,
    collectionName: '',
    modeOrLayerCount: 0,
    resolvedType: undefined,
    colorHex: undefined,
    propertyCount: propCount,
    variantCount,
    hasDocumentationLink: (node.documentationLinks || []).length > 0,
    descriptionExplainsPurpose: descriptionExplainsPurpose(node.name, desc),
    descriptionLength: desc.length,
    followsNamingConvention: checkNamingConvention(node.name),
    namingDepth: parts.length,
  };
}
