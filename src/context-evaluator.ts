/**
 * Context Maturity Protocol (CMP)
 * 
 * Pre-processing layer that evaluates whether there is enough context
 * to generate a reliable suggestion. Prevents hallucinated / low-quality
 * auto-generated descriptions when the underlying data is thin.
 *
 * Scoring dimensions:
 *   1. Data Density   – How many concrete data points exist?
 *   2. Semantic Alignment – Does the naming follow conventions we can parse?
 *   3. Ambiguity Score – Is there only one reasonable interpretation?
 *
 * Actions returned:
 *   PROCEED  (≥ 0.7) – Enough context; generate suggestion automatically.
 *   AUGMENT  (0.4–0.7) – Partial context; generate suggestion but flag it.
 *   CLARIFY  (< 0.4) – Insufficient context; show Missing Context Report.
 */

// ============================================================================
// Types
// ============================================================================

export type MaturityAction = 'PROCEED' | 'AUGMENT' | 'CLARIFY';

export type MaturityLevel = 'high' | 'medium' | 'low';

export interface ContextScore {
  /** 0.0 – 1.0 overall maturity */
  score: number;
  /** Human-readable label */
  level: MaturityLevel;
  /** What should the system do? */
  action: MaturityAction;
  /** Individual dimension scores (0–1) */
  dimensions: {
    dataDensity: number;
    semanticAlignment: number;
    ambiguity: number;
  };
  /** Specific things that are missing */
  missingElements: string[];
  /** Confidence note shown to user */
  confidenceNote: string;
}

/** Flat bag of signals the evaluator inspects */
export interface EvaluationContext {
  // Identity
  name: string;
  entityType: 'Variable' | 'Style' | 'Component';

  // Data-density signals
  hasDescription: boolean;
  hasDocumentation: boolean;
  hasDocumentationLink: boolean;

  // Naming signals
  namingDepth: number;          // slash-separated segments (e.g. colors/primary/500 → 3)
  followsNamingConvention: boolean;

  // Variable-specific
  resolvedType?: string;        // COLOR | FLOAT | STRING | BOOLEAN
  modeCount?: number;           // how many modes are defined
  hasValueInAllModes?: boolean;
  collectionName?: string;
  colorHex?: string;            // extracted value for COLOR vars

  // Style-specific
  styleType?: string;           // PAINT | TEXT | EFFECT
  paintCount?: number;          // number of paints in a PaintStyle
  hasSolidPaint?: boolean;

  // Component-specific
  hasVariants?: boolean;
  variantCount?: number;
  propertyCount?: number;
  propertiesWithDescriptions?: number;
  variantsWithDescriptions?: number;
  hasLayerNames?: boolean;

  // Design-derived rules (from Bake Rules): improves maturity when entity matches
  designRulesMatch?: string;   // meaning of first matching rule
  designRulesCount?: number;   // number of rules that matched
}

// ============================================================================
// Evaluator
// ============================================================================

export class ContextEvaluator {

  // ── Thresholds (tunable) ────────────────────────────────────────────
  private static readonly PROCEED_THRESHOLD = 0.7;
  private static readonly AUGMENT_THRESHOLD = 0.4;

  // ── Weights per dimension ───────────────────────────────────────────
  private static readonly W_DENSITY   = 0.45;
  private static readonly W_SEMANTIC  = 0.35;
  private static readonly W_AMBIGUITY = 0.20;

  // ── Known naming conventions (regex) ────────────────────────────────
  private static readonly NAMING_PATTERNS = [
    // kebab-case segments:  colors/primary-500
    /^[a-z][a-z0-9-]*$/,
    // camelCase segments:  colorsPrimary500
    /^[a-z][a-zA-Z0-9]*$/,
    // PascalCase segments:  ColorsPrimary500
    /^[A-Z][a-zA-Z0-9]*$/,
    // lowercase with spaces:  "Primary 500"
    /^[A-Za-z][A-Za-z0-9 ]*$/,
  ];

  // ====================================================================
  // Public API
  // ====================================================================

  /**
   * Evaluate a single entity's context and return its maturity score.
   */
  evaluate(ctx: EvaluationContext): ContextScore {
    const dataDensity       = this.scoreDensity(ctx);
    const semanticAlignment = this.scoreSemantic(ctx);
    const ambiguity         = this.scoreAmbiguity(ctx);

    const score = (
      dataDensity       * ContextEvaluator.W_DENSITY +
      semanticAlignment * ContextEvaluator.W_SEMANTIC +
      ambiguity         * ContextEvaluator.W_AMBIGUITY
    );

    const level  = this.levelFromScore(score);
    const action = this.actionFromScore(score);
    const missingElements = this.collectMissing(ctx);
    const confidenceNote  = this.buildConfidenceNote(level, action, missingElements);

    return {
      score: Math.round(score * 100) / 100,
      level,
      action,
      dimensions: {
        dataDensity:       Math.round(dataDensity * 100) / 100,
        semanticAlignment: Math.round(semanticAlignment * 100) / 100,
        ambiguity:         Math.round(ambiguity * 100) / 100,
      },
      missingElements,
      confidenceNote,
    };
  }

  // ====================================================================
  // Dimension: Data Density (0–1)
  // ====================================================================

  private scoreDensity(ctx: EvaluationContext): number {
    let points = 0;
    let max    = 0;

    // Universal signals
    max += 3;
    if (ctx.hasDescription) points += 3;            // most important

    max += 1;
    if (ctx.hasDocumentation) points += 1;

    max += 1;
    if (ctx.hasDocumentationLink) points += 1;

    max += 2;
    if (ctx.namingDepth >= 2) points += 1;
    if (ctx.namingDepth >= 3) points += 2;

    // Design-derived rules (baked from scans): real usage data improves data density
    max += 1;
    if (ctx.designRulesMatch) points += 1;

    // Variable-specific
    if (ctx.entityType === 'Variable') {
      max += 2;
      if (ctx.resolvedType) points += 1;            // know the type
      if (ctx.modeCount && ctx.modeCount > 0) points += 0.5;
      if (ctx.hasValueInAllModes) points += 0.5;

      max += 1;
      if (ctx.collectionName) points += 1;

      // COLOR variables get bonus for having a resolved hex
      if (ctx.resolvedType === 'COLOR') {
        max += 1;
        if (ctx.colorHex) points += 1;
      }
    }

    // Style-specific
    if (ctx.entityType === 'Style') {
      max += 1;
      if (ctx.styleType) points += 1;

      if (ctx.styleType === 'PAINT') {
        max += 1;
        if (ctx.hasSolidPaint) points += 0.5;
        if (ctx.paintCount && ctx.paintCount > 0) points += 0.5;
      }
    }

    // Component-specific
    if (ctx.entityType === 'Component') {
      max += 2;
      if (ctx.hasVariants) points += 1;
      if (ctx.variantCount && ctx.variantCount > 0) points += 1;

      max += 2;
      if (ctx.propertyCount && ctx.propertyCount > 0) points += 1;
      if (ctx.propertiesWithDescriptions && ctx.propertiesWithDescriptions > 0) points += 1;

      max += 1;
      if (ctx.hasLayerNames) points += 1;
    }

    return max > 0 ? Math.min(1, points / max) : 0;
  }

  // ====================================================================
  // Dimension: Semantic Alignment (0–1)
  // ====================================================================

  private scoreSemantic(ctx: EvaluationContext): number {
    let score = 0;

    // Naming convention adherence
    if (ctx.followsNamingConvention) {
      score += 0.5;
    }

    // Depth of naming hierarchy (slash-separated)
    // Deeper names → more semantic context (e.g. "colors/brand/primary/500")
    const depth = ctx.namingDepth;
    if (depth >= 3) score += 0.3;
    else if (depth >= 2) score += 0.2;
    else if (depth >= 1) score += 0.1;

    // Collection / group name provides semantic context
    if (ctx.collectionName || ctx.styleType) {
      score += 0.2;
    }

    // Design-derived rule match: entity aligns with real design usage (semantic alignment)
    if (ctx.designRulesMatch) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  // ====================================================================
  // Dimension: Ambiguity (0 = very ambiguous, 1 = unambiguous)
  // ====================================================================

  private scoreAmbiguity(ctx: EvaluationContext): number {
    let score = 1.0; // start optimistic

    // Short, single-segment names are ambiguous
    if (ctx.namingDepth <= 1 && ctx.name.length < 6) {
      score -= 0.4;
    } else if (ctx.namingDepth <= 1) {
      score -= 0.2;
    }

    // Generic names are ambiguous
    const generic = /^(color|text|style|token|var|value|item|element|thing|default|new|test|temp)$/i;
    const leaf = ctx.name.split('/').pop() || ctx.name;
    if (generic.test(leaf.trim())) {
      score -= 0.3;
    }

    // No resolved type = more ambiguity
    if (ctx.entityType === 'Variable' && !ctx.resolvedType) {
      score -= 0.2;
    }

    // Missing collection / style group = more ambiguity
    if (!ctx.collectionName && !ctx.styleType) {
      score -= 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }

  // ====================================================================
  // Helpers
  // ====================================================================

  private levelFromScore(score: number): MaturityLevel {
    if (score >= ContextEvaluator.PROCEED_THRESHOLD) return 'high';
    if (score >= ContextEvaluator.AUGMENT_THRESHOLD) return 'medium';
    return 'low';
  }

  private actionFromScore(score: number): MaturityAction {
    if (score >= ContextEvaluator.PROCEED_THRESHOLD) return 'PROCEED';
    if (score >= ContextEvaluator.AUGMENT_THRESHOLD) return 'AUGMENT';
    return 'CLARIFY';
  }

  private collectMissing(ctx: EvaluationContext): string[] {
    const missing: string[] = [];

    if (!ctx.hasDescription) missing.push('Description is missing');
    if (!ctx.hasDocumentation && ctx.entityType === 'Component') missing.push('Documentation not found');
    if (!ctx.hasDocumentationLink && ctx.entityType === 'Component') missing.push('No documentation link');
    if (ctx.namingDepth < 2) missing.push('Name lacks hierarchical structure (use slashes e.g. category/name)');
    if (!ctx.followsNamingConvention) missing.push('Name does not follow a standard convention');

    if (ctx.entityType === 'Variable') {
      if (!ctx.resolvedType) missing.push('Variable type is unknown');
      if (ctx.modeCount === 0) missing.push('No modes defined');
      if (!ctx.hasValueInAllModes) missing.push('Values missing in some modes');
    }

    if (ctx.entityType === 'Component') {
      if (!ctx.hasVariants && ctx.variantCount === 0) missing.push('No variants defined');
      if (ctx.propertyCount === 0) missing.push('No component properties');
      if (ctx.propertiesWithDescriptions === 0 && (ctx.propertyCount ?? 0) > 0) {
        missing.push('Properties have no descriptions');
      }
    }

    return missing;
  }

  private buildConfidenceNote(level: MaturityLevel, action: MaturityAction, missing: string[]): string {
    switch (action) {
      case 'PROCEED':
        return 'High confidence — enough context to generate a reliable suggestion.';
      case 'AUGMENT':
        return `Medium confidence — suggestion generated but ${missing.length} context gap${missing.length !== 1 ? 's' : ''} detected. Review before applying.`;
      case 'CLARIFY':
        return `Low confidence — ${missing.length} critical context gap${missing.length !== 1 ? 's' : ''} found. Please provide more information.`;
    }
  }

  // ====================================================================
  // Static helpers for building EvaluationContext from Figma objects
  // ====================================================================

  /**
   * Match entity name against baked design rules (pattern = substring or path segment).
   * Returns first match's meaning and total match count for maturity scoring.
   */
  static matchDesignRules(name: string, rules: { pattern: string; meaning: string }[]): { meaning: string; count: number } | null {
    if (!rules || rules.length === 0) return null;
    const lower = name.toLowerCase();
    const segments = name.split('/').map(s => s.toLowerCase());
    let firstMeaning: string | null = null;
    let count = 0;
    for (const r of rules) {
      const p = (r.pattern || '').trim();
      if (!p) continue;
      const pl = p.toLowerCase();
      const matches = lower.includes(pl) || lower.startsWith(pl) || segments.some(seg => seg === pl || seg.startsWith(pl));
      if (matches) {
        if (firstMeaning == null) firstMeaning = r.meaning || '';
        count++;
      }
    }
    return firstMeaning != null ? { meaning: firstMeaning, count } : null;
  }

  /**
   * Build context for a Variable.
   */
  static fromVariable(variable: Variable, collectionName: string, colorHex?: string, designRules?: { pattern: string; meaning: string }[]): EvaluationContext {
    const nameParts = variable.name.split('/');
    const modeIds = Object.keys(variable.valuesByMode);
    const allModesHaveValue = modeIds.every(m => {
      const v = variable.valuesByMode[m];
      return v !== undefined && v !== null;
    });

    const ctx: EvaluationContext = {
      name: variable.name,
      entityType: 'Variable',
      hasDescription: !!(variable.description && variable.description.trim()),
      hasDocumentation: false,
      hasDocumentationLink: false,
      namingDepth: nameParts.length,
      followsNamingConvention: ContextEvaluator.checkNaming(nameParts),
      resolvedType: variable.resolvedType,
      modeCount: modeIds.length,
      hasValueInAllModes: allModesHaveValue,
      collectionName,
      colorHex,
    };
    const match = designRules && designRules.length ? ContextEvaluator.matchDesignRules(variable.name, designRules) : null;
    if (match) {
      ctx.designRulesMatch = match.meaning;
      ctx.designRulesCount = match.count;
    }
    return ctx;
  }

  /**
   * Build context for a Style.
   */
  static fromStyle(style: BaseStyle, colorHex?: string, designRules?: { pattern: string; meaning: string }[]): EvaluationContext {
    const nameParts = style.name.split('/');
    let paintCount: number | undefined;
    let hasSolidPaint: boolean | undefined;

    if (style.type === 'PAINT') {
      const ps = style as PaintStyle;
      paintCount = ps.paints.length;
      hasSolidPaint = ps.paints.some(p => p.type === 'SOLID');
    }

    const ctx: EvaluationContext = {
      name: style.name,
      entityType: 'Style',
      hasDescription: !!(style.description && style.description.trim()),
      hasDocumentation: false,
      hasDocumentationLink: false,
      namingDepth: nameParts.length,
      followsNamingConvention: ContextEvaluator.checkNaming(nameParts),
      styleType: style.type,
      paintCount,
      hasSolidPaint,
      colorHex,
    };
    const match = designRules && designRules.length ? ContextEvaluator.matchDesignRules(style.name, designRules) : null;
    if (match) {
      ctx.designRulesMatch = match.meaning;
      ctx.designRulesCount = match.count;
    }
    return ctx;
  }

  /**
   * Build context for a Component / Component Set.
   */
  static fromComponent(node: SceneNode, designRules?: { pattern: string; meaning: string }[]): EvaluationContext {
    const nameParts = node.name.split('/');
    let hasVariants = false;
    let variantCount = 0;
    let propertyCount = 0;
    let propertiesWithDescriptions = 0;
    let hasDocLink = false;

    if (node.type === 'COMPONENT_SET') {
      hasVariants = true;
      variantCount = (node as ComponentSetNode).children.length;
    }

    if ('componentPropertyDefinitions' in node) {
      const defs = (node as any).componentPropertyDefinitions as Record<string, any>;
      if (defs) {
        const entries = Object.values(defs);
        propertyCount = entries.length;
        propertiesWithDescriptions = entries.filter((d: any) => d.description && d.description.trim()).length;
      }
    }

    if ('documentationLinks' in node) {
      hasDocLink = ((node as any).documentationLinks || []).length > 0;
    }

    const hasDesc = 'description' in node && !!(node as any).description?.trim();

    const ctx: EvaluationContext = {
      name: node.name,
      entityType: 'Component',
      hasDescription: hasDesc,
      hasDocumentation: hasDesc,           // treat description as documentation for components
      hasDocumentationLink: hasDocLink,
      namingDepth: nameParts.length,
      followsNamingConvention: ContextEvaluator.checkNaming(nameParts),
      hasVariants,
      variantCount,
      propertyCount,
      propertiesWithDescriptions,
      hasLayerNames: true,                 // we assume layer names exist; scanner refines this
    };
    const match = designRules && designRules.length ? ContextEvaluator.matchDesignRules(node.name, designRules) : null;
    if (match) {
      ctx.designRulesMatch = match.meaning;
      ctx.designRulesCount = match.count;
    }
    return ctx;
  }

  /**
   * Check whether all name segments follow a recognisable convention.
   */
  private static checkNaming(segments: string[]): boolean {
    return segments.every(seg =>
      ContextEvaluator.NAMING_PATTERNS.some(pat => pat.test(seg.trim()))
    );
  }
}
