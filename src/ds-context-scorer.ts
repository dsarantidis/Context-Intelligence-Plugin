/**
 * DS Context Maturity Scorer
 *
 * File-level maturity assessment: 10 context points across Variables (60 pts)
 * and Styles (40 pts), totaling 0–100.
 *
 * Pure domain module — no Figma globals, no UI code.
 */

// ============================================================================
// Types
// ============================================================================

export interface DSVariable {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  resolvedType: string;
  codeSyntax: { WEB?: string; ANDROID?: string; iOS?: string };
  valuesByMode: Record<string, unknown>;
  variableCollectionId: string;
}

export interface DSCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  variableIds: string[];
}

export interface DSStyle {
  id: string;
  name: string;
  description: string;
  type: 'PAINT' | 'TEXT' | 'EFFECT';
}

/** Optional design rules (from Context Rules tab) used to boost context quality when names match */
export interface DesignRule {
  pattern: string;
  meaning: string;
}

export interface DSContextInput {
  variables: DSVariable[];
  collections: DSCollection[];
  styles: DSStyle[];
  /** Baked Context Rules: entities whose name matches a rule get a design-derived context bonus */
  designRules?: DesignRule[];
}

export interface ContextPointResult {
  id: string;
  label: string;
  layer: 'variables' | 'styles';
  weight: number;
  rawScore: number;
  maxScore: number;
  normalizedScore: number;
  weightedScore: number;
  breakdown: string[];
}

export type DSMaturityTier = 'AI-Ready' | 'Maturing' | 'Needs Work' | 'Critical';

export interface DSMaturityResult {
  overallScore: number;
  tier: DSMaturityTier;
  variablesLayerScore: number;
  stylesLayerScore: number;
  points: ContextPointResult[];
  summary: string;
}

// ============================================================================
// Helpers
// ============================================================================

/** Regex matching most emoji ranges */
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/u;

function hasEmoji(s: string): boolean {
  return EMOJI_RE.test(s);
}

function pct(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

/** Detect dominant casing pattern across leaf segments */
function detectCasing(segments: string[]): 'kebab' | 'camel' | 'pascal' | 'mixed' {
  const patterns = { kebab: 0, camel: 0, pascal: 0, other: 0 };
  for (const seg of segments) {
    const s = seg.trim();
    if (!s) continue;
    if (/^[a-z][a-z0-9-]*$/.test(s)) patterns.kebab++;
    else if (/^[a-z][a-zA-Z0-9]*$/.test(s)) patterns.camel++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(s)) patterns.pascal++;
    else patterns.other++;
  }
  const total = patterns.kebab + patterns.camel + patterns.pascal + patterns.other;
  if (total === 0) return 'mixed';
  if (patterns.kebab / total >= 0.9) return 'kebab';
  if (patterns.camel / total >= 0.9) return 'camel';
  if (patterns.pascal / total >= 0.9) return 'pascal';
  return 'mixed';
}

/** Check if a name segment is purely numeric */
function isPurelyNumeric(s: string): boolean {
  return /^\d+$/.test(s.trim());
}

function buildPoint(
  id: string, label: string, layer: 'variables' | 'styles',
  weight: number, rawScore: number, maxScore: number, breakdown: string[]
): ContextPointResult {
  const norm = maxScore > 0 ? Math.min(1, rawScore / maxScore) : 0;
  return {
    id, label, layer, weight,
    rawScore: Math.round(rawScore * 100) / 100,
    maxScore,
    normalizedScore: Math.round(norm * 100) / 100,
    weightedScore: Math.round(norm * weight * 100) / 100,
    breakdown,
  };
}

/** Match entity name against Context Rules (pattern = substring or path segment). Used for design-derived context bonus. */
function nameMatchesDesignRule(name: string, rules: DesignRule[]): boolean {
  if (!rules || rules.length === 0) return false;
  const lower = name.toLowerCase();
  const segments = name.split('/').map(s => s.toLowerCase());
  for (const r of rules) {
    const p = (r.pattern || '').trim();
    if (!p) continue;
    const pl = p.toLowerCase();
    if (lower.includes(pl) || lower.startsWith(pl) || segments.some(seg => seg === pl || seg.startsWith(pl))) return true;
  }
  return false;
}

// ============================================================================
// Context Point 1 — Token / Variable Name (weight 10)
// ============================================================================

function scoreTokenName(vars: DSVariable[]): ContextPointResult {
  if (vars.length === 0) return buildPoint('token-name', 'Token Name', 'variables', 10, 0, 10, ['No variables found']);

  const bd: string[] = [];
  let raw = 0;

  // Slash-separated grouping
  const withSlash = vars.filter(v => v.name.includes('/'));
  const allGrouped = withSlash.length === vars.length;
  if (allGrouped) { raw += 3; bd.push('+3 All names use slash-separated grouping'); }
  else bd.push(`+0 Only ${withSlash.length}/${vars.length} names use slash grouping`);

  // Consistent casing (leaf segments)
  const leafSegments = vars.map(v => {
    const parts = v.name.split('/');
    return parts[parts.length - 1];
  });
  const casing = detectCasing(leafSegments);
  if (casing !== 'mixed') { raw += 2; bd.push(`+2 Consistent casing (${casing}) across ≥90% of names`); }
  else bd.push('+0 Inconsistent casing across names');

  // No emoji
  const withEmoji = vars.filter(v => hasEmoji(v.name));
  if (withEmoji.length === 0) { raw += 2; bd.push('+2 No emoji in any variable name'); }
  else bd.push(`+0 ${withEmoji.length} variable(s) contain emoji`);

  // Semantic (not purely numeric leaf names)
  const numericLeaves = leafSegments.filter(s => isPurelyNumeric(s));
  if (numericLeaves.length === 0) { raw += 2; bd.push('+2 All names are semantic (no purely numeric names)'); }
  else bd.push(`+0 ${numericLeaves.length} variable(s) have purely numeric names`);

  // No whitespace in names
  const withWhitespace = vars.filter(v => /\s/.test(v.name));
  if (withWhitespace.length === 0) { raw += 1; bd.push('+1 No whitespace in variable names'); }
  else bd.push(`+0 ${withWhitespace.length} variable(s) have whitespace in names`);

  return buildPoint('token-name', 'Token Name', 'variables', 10, raw, 10, bd);
}

// ============================================================================
// Context Point 2 — Token Description (weight 15)
// ============================================================================

function scoreTokenDescription(vars: DSVariable[], designRules?: DesignRule[]): ContextPointResult {
  if (vars.length === 0) return buildPoint('token-description', 'Token Description', 'variables', 15, 0, 15, ['No variables found']);

  const bd: string[] = [];

  // Coverage tier
  const withDesc = vars.filter(v => v.description && v.description.trim() !== '');
  const coverage = pct(withDesc.length, vars.length);
  let coverageScore = 0;
  if (coverage >= 0.80) coverageScore = 10;
  else if (coverage >= 0.50) coverageScore = 7;
  else if (coverage >= 0.25) coverageScore = 4;
  else if (coverage >= 0.10) coverageScore = 2;
  else if (coverage > 0) coverageScore = 1;

  bd.push(`Coverage: ${(coverage * 100).toFixed(1)}% (${withDesc.length}/${vars.length}) → ${coverageScore}/10`);

  // Quality bonus (0–5) — sampled from described variables
  let qualityBonus = 0;
  if (withDesc.length > 0) {
    const sample = withDesc.slice(0, Math.min(50, withDesc.length));
    const avgLen = sample.reduce((s, v) => s + v.description.trim().length, 0) / sample.length;

    // Min 20 chars
    if (avgLen >= 20) { qualityBonus += 1; bd.push('+1 Average description length ≥ 20 chars'); }
    else bd.push(`+0 Average description length ${avgLen.toFixed(0)} < 20 chars`);

    // Usage context keywords
    const usageKeywords = /\b(use for|used for|apply to|meant for|designed for|intended for)\b/i;
    const withUsage = sample.filter(v => usageKeywords.test(v.description));
    if (pct(withUsage.length, sample.length) >= 0.3) { qualityBonus += 1.5; bd.push('+1.5 ≥30% of descriptions contain usage context'); }

    // Semantic intent keywords
    const intentKeywords = /\b(primary|secondary|surface|background|foreground|interactive|accent|neutral|brand|semantic)\b/i;
    const withIntent = sample.filter(v => intentKeywords.test(v.description));
    if (pct(withIntent.length, sample.length) >= 0.3) { qualityBonus += 1; bd.push('+1 ≥30% reference semantic intent'); }

    // Restriction keywords
    const restrictionKeywords = /\b(do not|don't|never|only for|not for|avoid|deprecated)\b/i;
    const withRestriction = sample.filter(v => restrictionKeywords.test(v.description));
    if (pct(withRestriction.length, sample.length) >= 0.1) { qualityBonus += 0.5; bd.push('+0.5 ≥10% mention usage restrictions'); }

    qualityBonus = Math.min(5, qualityBonus);
  }

  // Context Rules bonus: variables whose name matches a baked rule have design-derived context (up to +1)
  let designBonus = 0;
  if (designRules && designRules.length > 0) {
    const matching = vars.filter(v => nameMatchesDesignRule(v.name, designRules));
    const matchPct = pct(matching.length, vars.length);
    if (matchPct >= 0.5) { designBonus = 1; bd.push(`+1 ${matching.length}/${vars.length} variables match Context Rules (design-derived context)`); }
    else if (matchPct >= 0.2) { designBonus = 0.5; bd.push(`+0.5 ${matching.length}/${vars.length} variables match Context Rules`); }
    else if (matching.length > 0) bd.push(`+0 ${matching.length}/${vars.length} variables match Context Rules`);
  }

  const totalRaw = Math.min(15, coverageScore + qualityBonus + designBonus);
  return buildPoint('token-description', 'Token Description', 'variables', 15, totalRaw, 15, bd);
}

// ============================================================================
// Context Point 3 — Token Scope (weight 12)
// ============================================================================

function scoreTokenScope(vars: DSVariable[]): ContextPointResult {
  if (vars.length === 0) return buildPoint('token-scope', 'Token Scope', 'variables', 12, 0, 12, ['No variables found']);

  const bd: string[] = [];
  let raw = 0;

  // Empty scopes %
  const emptyScopes = vars.filter(v => !v.scopes || v.scopes.length === 0);
  const emptyPct = pct(emptyScopes.length, vars.length);
  if (emptyPct <= 0.05) { raw += 8; bd.push(`+8 Only ${(emptyPct * 100).toFixed(1)}% have empty scopes (≤5%)`); }
  else if (emptyPct <= 0.20) { raw += 6; bd.push(`+6 ${(emptyPct * 100).toFixed(1)}% have empty scopes (6–20%)`); }
  else if (emptyPct <= 0.50) { raw += 3; bd.push(`+3 ${(emptyPct * 100).toFixed(1)}% have empty scopes (21–50%)`); }
  else bd.push(`+0 ${(emptyPct * 100).toFixed(1)}% have empty scopes (>50%)`);

  // ALL_SCOPES specificity bonus
  const allScopesVars = vars.filter(v => v.scopes && v.scopes.length === 1 && v.scopes[0] === 'ALL_SCOPES');
  const allScopesPct = pct(allScopesVars.length, vars.length);
  if (allScopesPct <= 0.20) { raw += 2; bd.push(`+2 Only ${(allScopesPct * 100).toFixed(1)}% use ALL_SCOPES (≤20%)`); }
  else bd.push(`+0 ${(allScopesPct * 100).toFixed(1)}% use ALL_SCOPES (>20%)`);

  // COLOR variables scoped to fill/stroke types
  const colorVars = vars.filter(v => v.resolvedType === 'COLOR');
  if (colorVars.length > 0) {
    const fillStrokeScopes = ['FILL_COLOR', 'STROKE_COLOR', 'SHAPE_FILL', 'FRAME_FILL', 'TEXT_FILL'];
    const colorScoped = colorVars.filter(v => v.scopes && v.scopes.some(s => fillStrokeScopes.includes(s)));
    if (pct(colorScoped.length, colorVars.length) >= 0.5) {
      raw += 2;
      bd.push(`+2 ${colorScoped.length}/${colorVars.length} COLOR variables scoped to fill/stroke types`);
    } else {
      bd.push(`+0 Only ${colorScoped.length}/${colorVars.length} COLOR variables scoped to fill/stroke`);
    }
  }

  return buildPoint('token-scope', 'Token Scope', 'variables', 12, raw, 12, bd);
}

// ============================================================================
// Context Point 4 — Token Code Syntax (weight 8)
// ============================================================================

function scoreTokenCodeSyntax(vars: DSVariable[]): ContextPointResult {
  if (vars.length === 0) return buildPoint('token-code-syntax', 'Token Code Syntax', 'variables', 8, 0, 8, ['No variables found']);

  const bd: string[] = [];
  let raw = 0;

  const withWeb = vars.filter(v => v.codeSyntax && v.codeSyntax.WEB);
  const withAndroid = vars.filter(v => v.codeSyntax && v.codeSyntax.ANDROID);
  const withIOS = vars.filter(v => v.codeSyntax && v.codeSyntax.iOS);

  const webPct = pct(withWeb.length, vars.length);
  if (webPct >= 0.70) { raw += 4; bd.push(`+4 ${(webPct * 100).toFixed(1)}% have WEB syntax (≥70%)`); }
  else if (webPct >= 0.30) { raw += 2; bd.push(`+2 ${(webPct * 100).toFixed(1)}% have WEB syntax (30–69%)`); }
  else bd.push(`+0 ${(webPct * 100).toFixed(1)}% have WEB syntax (<30%)`);

  const androidPct = pct(withAndroid.length, vars.length);
  if (androidPct >= 0.70) { raw += 2; bd.push(`+2 ${(androidPct * 100).toFixed(1)}% have ANDROID syntax (≥70%)`); }
  else bd.push(`+0 ${(androidPct * 100).toFixed(1)}% have ANDROID syntax`);

  const iosPct = pct(withIOS.length, vars.length);
  if (iosPct >= 0.70) { raw += 2; bd.push(`+2 ${(iosPct * 100).toFixed(1)}% have iOS syntax (≥70%)`); }
  else bd.push(`+0 ${(iosPct * 100).toFixed(1)}% have iOS syntax`);

  return buildPoint('token-code-syntax', 'Token Code Syntax', 'variables', 8, raw, 8, bd);
}

// ============================================================================
// Context Point 5 — Collection Name (weight 5, raw max 8 normalized)
// ============================================================================

function scoreCollectionName(collections: DSCollection[]): ContextPointResult {
  if (collections.length === 0) return buildPoint('collection-name', 'Collection Name', 'variables', 5, 0, 8, ['No collections found']);

  const bd: string[] = [];
  let raw = 0;
  const names = collections.map(c => c.name);

  // No default names
  const defaultPattern = /^(Variable )?Collection\s?\d*$/i;
  const hasDefaults = names.some(n => defaultPattern.test(n.trim()));
  if (!hasDefaults) { raw += 2; bd.push('+2 No default collection names'); }
  else bd.push('+0 Default collection name(s) found ("Collection", "Collection 1", etc.)');

  // No duplicate names
  const unique = new Set(names.map(n => n.trim().toLowerCase()));
  if (unique.size === names.length) { raw += 2; bd.push('+2 No duplicate collection names'); }
  else bd.push(`+0 ${names.length - unique.size} duplicate collection name(s)`);

  // No emoji
  const withEmoji = names.filter(n => hasEmoji(n));
  if (withEmoji.length === 0) { raw += 1; bd.push('+1 No emoji in collection names'); }
  else bd.push(`+0 ${withEmoji.length} collection(s) have emoji`);

  // Consistent convention
  const casing = detectCasing(names);
  // Also check for dot-prefix consistency
  const dotPrefixed = names.filter(n => n.startsWith('.'));
  const hasDotConsistency = dotPrefixed.length === 0 || dotPrefixed.length === names.length;
  if (casing !== 'mixed' || hasDotConsistency) { raw += 2; bd.push('+2 Consistent naming convention'); }
  else bd.push('+0 Inconsistent naming convention');

  // No whitespace
  const withWhitespace = names.filter(n => /^\s|\s$/.test(n));
  if (withWhitespace.length === 0) { raw += 1; bd.push('+1 No leading/trailing whitespace'); }
  else bd.push(`+0 ${withWhitespace.length} collection(s) have leading/trailing whitespace`);

  // Raw max is 8, weight is 5 → normalization handles this
  return buildPoint('collection-name', 'Collection Name', 'variables', 5, raw, 8, bd);
}

// ============================================================================
// Context Point 6 — Mode Names (weight 10)
// ============================================================================

function scoreModeNames(collections: DSCollection[]): ContextPointResult {
  const allModes = collections.flatMap(c => c.modes.map(m => m.name));
  if (allModes.length === 0) return buildPoint('mode-names', 'Mode Names', 'variables', 10, 0, 10, ['No modes found']);

  const bd: string[] = [];
  let raw = 0;

  // No emoji
  const withEmoji = allModes.filter(n => hasEmoji(n));
  if (withEmoji.length === 0) { raw += 3; bd.push('+3 No emoji in any mode name'); }
  else bd.push(`+0 ${withEmoji.length} mode(s) contain emoji`);

  // No "Mode 1" default
  const defaultPattern = /^Mode\s*\d+$/i;
  const hasDefaults = allModes.some(n => defaultPattern.test(n.trim()));
  if (!hasDefaults) { raw += 2; bd.push('+2 No default mode names ("Mode 1")'); }
  else bd.push('+0 Default mode name(s) found');

  // Semantic names — describe dimension (light/dark, size, device, etc.)
  const semanticPatterns = /\b(light|dark|theme|mobile|tablet|desktop|small|medium|large|default|brand|compact|dense|regular|rtl|ltr|high.contrast|inverted|day|night|individual|premium|corporate)\b/i;
  const semanticModes = allModes.filter(n => semanticPatterns.test(n));
  if (pct(semanticModes.length, allModes.length) >= 0.5) { raw += 3; bd.push(`+3 ≥50% of mode names are semantically descriptive`); }
  else if (pct(semanticModes.length, allModes.length) >= 0.25) { raw += 1; bd.push(`+1 Some mode names are semantically descriptive`); }
  else bd.push('+0 Mode names lack semantic clarity');

  // Consistent convention
  const casing = detectCasing(allModes);
  if (casing !== 'mixed') { raw += 2; bd.push(`+2 Consistent naming convention (${casing})`); }
  else bd.push('+0 Inconsistent naming convention across modes');

  return buildPoint('mode-names', 'Mode Names', 'variables', 10, raw, 10, bd);
}

// ============================================================================
// Context Point 7 — Style Name (weight 8)
// ============================================================================

function scoreStyleName(styles: DSStyle[]): ContextPointResult {
  if (styles.length === 0) return buildPoint('style-name', 'Style Name', 'styles', 8, 0, 8, ['No styles found']);

  const bd: string[] = [];
  let raw = 0;
  const names = styles.map(s => s.name);
  const leafNames = names.map(n => {
    const parts = n.split('/');
    return parts[parts.length - 1].trim();
  });

  // Semantic role-based names (not value-based like "32px Bold")
  const valueBased = /^\d+(\.\d+)?(px|pt|rem|em)?\s*(\/\s*\d+)?\s*(bold|regular|medium|light|thin|semibold|extrabold)?$/i;
  const valueNames = leafNames.filter(n => valueBased.test(n));
  if (pct(valueNames.length, leafNames.length) <= 0.1) { raw += 3; bd.push('+3 Names describe roles, not raw values'); }
  else bd.push(`+0 ${valueNames.length} style(s) use value-based names`);

  // No Figma defaults
  const defaultPattern = /^(Text Style|Paint Style|Effect Style|Grid Style)\s*\d*$/i;
  const hasDefaults = names.some(n => defaultPattern.test(n.trim()));
  if (!hasDefaults) { raw += 2; bd.push('+2 No Figma default style names'); }
  else bd.push('+0 Default style name(s) found');

  // Consistent size/weight convention
  const casing = detectCasing(leafNames);
  if (casing !== 'mixed') { raw += 2; bd.push(`+2 Consistent naming convention (${casing})`); }
  else bd.push('+0 Inconsistent naming convention');

  // No ambiguous single-word names
  const ambiguous = leafNames.filter(n => !n.includes(' ') && n.length <= 4 && !/\d/.test(n));
  if (ambiguous.length === 0) { raw += 1; bd.push('+1 No ambiguous single-word names'); }
  else bd.push(`+0 ${ambiguous.length} ambiguous short name(s)`);

  return buildPoint('style-name', 'Style Name', 'styles', 8, raw, 8, bd);
}

// ============================================================================
// Context Point 8 — Style Description (weight 12)
// ============================================================================

function scoreStyleDescription(styles: DSStyle[], designRules?: DesignRule[]): ContextPointResult {
  if (styles.length === 0) return buildPoint('style-description', 'Style Description', 'styles', 12, 0, 12, ['No styles found']);

  const bd: string[] = [];

  const withDesc = styles.filter(s => s.description && s.description.trim() !== '');
  const coverage = pct(withDesc.length, styles.length);
  let coverageScore = 0;
  if (coverage >= 0.80) coverageScore = 10;
  else if (coverage >= 0.50) coverageScore = 7;
  else if (coverage >= 0.25) coverageScore = 4;
  else if (coverage >= 0.10) coverageScore = 2;
  else if (coverage > 0) coverageScore = 1;

  bd.push(`Coverage: ${(coverage * 100).toFixed(1)}% (${withDesc.length}/${styles.length}) → ${coverageScore}/10`);

  // Quality bonus (0–2)
  let qualityBonus = 0;
  if (withDesc.length > 0) {
    const sample = withDesc.slice(0, Math.min(30, withDesc.length));
    const avgLen = sample.reduce((s, v) => s + v.description.trim().length, 0) / sample.length;

    if (avgLen >= 20) { qualityBonus += 1; bd.push('+1 Average description ≥ 20 chars'); }

    const usageKeywords = /\b(use for|pair with|apply to|heading|body|caption|elevation|shadow)\b/i;
    const withUsage = sample.filter(v => usageKeywords.test(v.description));
    if (pct(withUsage.length, sample.length) >= 0.3) { qualityBonus += 1; bd.push('+1 ≥30% specify usage context or pairing'); }
  }

  // Context Rules bonus: styles whose name matches a baked rule (up to +1)
  let designBonus = 0;
  if (designRules && designRules.length > 0) {
    const matching = styles.filter(s => nameMatchesDesignRule(s.name, designRules));
    const matchPct = pct(matching.length, styles.length);
    if (matchPct >= 0.5) { designBonus = 1; bd.push(`+1 ${matching.length}/${styles.length} styles match Context Rules (design-derived context)`); }
    else if (matchPct >= 0.2) { designBonus = 0.5; bd.push(`+0.5 ${matching.length}/${styles.length} styles match Context Rules`); }
    else if (matching.length > 0) bd.push(`+0 ${matching.length}/${styles.length} styles match Context Rules`);
  }

  const totalRaw = Math.min(12, coverageScore + qualityBonus + designBonus);
  return buildPoint('style-description', 'Style Description', 'styles', 12, totalRaw, 12, bd);
}

// ============================================================================
// Context Point 9 — Style Folder Structure (weight 10)
// ============================================================================

function scoreStyleFolderStructure(styles: DSStyle[]): ContextPointResult {
  if (styles.length === 0) return buildPoint('style-folder-structure', 'Style Folders', 'styles', 10, 0, 10, ['No styles found']);

  const bd: string[] = [];
  let raw = 0;

  // Folder usage %
  const withFolder = styles.filter(s => s.name.includes('/'));
  const folderPct = pct(withFolder.length, styles.length);
  if (folderPct >= 0.80) { raw += 6; bd.push(`+6 ${(folderPct * 100).toFixed(1)}% use folder grouping (≥80%)`); }
  else if (folderPct >= 0.50) { raw += 4; bd.push(`+4 ${(folderPct * 100).toFixed(1)}% use folder grouping (50–79%)`); }
  else bd.push(`+0 ${(folderPct * 100).toFixed(1)}% use folder grouping (<50%)`);

  // Folder names describe category
  const folderNames = withFolder.map(s => s.name.split('/')[0].trim().toLowerCase());
  const uniqueFolders = [...new Set(folderNames)];
  const categoryPatterns = /^(typography|type|text|color|colours?|elevation|shadow|effect|grid|layout|spacing|border|radius|opacity|motion|icon|brand)/i;
  const categorized = uniqueFolders.filter(f => categoryPatterns.test(f));
  if (uniqueFolders.length > 0 && pct(categorized.length, uniqueFolders.length) >= 0.5) {
    raw += 2; bd.push(`+2 Folder names describe style categories`);
  } else if (uniqueFolders.length > 0) {
    bd.push(`+0 Folder names don't clearly describe categories`);
  }

  // No orphaned single styles outside folders
  const withoutFolder = styles.filter(s => !s.name.includes('/'));
  if (withoutFolder.length === 0) { raw += 2; bd.push('+2 No orphaned styles outside folders'); }
  else bd.push(`+0 ${withoutFolder.length} style(s) without folder grouping`);

  return buildPoint('style-folder-structure', 'Style Folders', 'styles', 10, raw, 10, bd);
}

// ============================================================================
// Context Point 10 — Style Group Consistency (weight 10)
// ============================================================================

function scoreStyleGroupConsistency(styles: DSStyle[]): ContextPointResult {
  if (styles.length === 0) return buildPoint('style-group-consistency', 'Style Consistency', 'styles', 10, 0, 10, ['No styles found']);

  const bd: string[] = [];
  let raw = 0;

  // Group by type
  const byType: Record<string, DSStyle[]> = {};
  for (const s of styles) {
    if (!byType[s.type]) byType[s.type] = [];
    byType[s.type].push(s);
  }
  const types = Object.keys(byType);

  // All types use folders
  const typesWithFolders = types.filter(t => byType[t].some(s => s.name.includes('/')));
  if (typesWithFolders.length === types.length) {
    raw += 4; bd.push('+4 All style types use folder grouping');
  } else {
    const missing = types.filter(t => !typesWithFolders.includes(t));
    bd.push(`+0 ${missing.join(', ')} style type(s) lack folder grouping`);
  }

  // Consistent casing across all style names
  const allLeafNames = styles.map(s => {
    const parts = s.name.split('/');
    return parts[parts.length - 1].trim();
  });
  const casing = detectCasing(allLeafNames);
  if (casing !== 'mixed') { raw += 3; bd.push(`+3 Consistent casing across all style types (${casing})`); }
  else bd.push('+0 Inconsistent casing across style types');

  // No orphan types (a type where NONE use folders while others do)
  if (types.length > 1) {
    const typeFolderRatios = types.map(t => ({
      type: t,
      ratio: pct(byType[t].filter(s => s.name.includes('/')).length, byType[t].length),
    }));
    const hasOrphan = typeFolderRatios.some(r => r.ratio === 0) && typeFolderRatios.some(r => r.ratio > 0);
    if (!hasOrphan) { raw += 3; bd.push('+3 No orphan style types (all types equally organized)'); }
    else {
      const orphans = typeFolderRatios.filter(r => r.ratio === 0).map(r => r.type);
      bd.push(`+0 Orphan type(s): ${orphans.join(', ')} have no folder structure`);
    }
  } else {
    raw += 3; bd.push('+3 Single style type — no cross-type inconsistency');
  }

  return buildPoint('style-group-consistency', 'Style Consistency', 'styles', 10, raw, 10, bd);
}

// ============================================================================
// Main scorer
// ============================================================================

export function scoreDSContextMaturity(input: DSContextInput): DSMaturityResult {
  const designRules = input.designRules;
  const points: ContextPointResult[] = [
    // Variables layer (60 pts)
    scoreTokenName(input.variables),
    scoreTokenDescription(input.variables, designRules),
    scoreTokenScope(input.variables),
    scoreTokenCodeSyntax(input.variables),
    scoreCollectionName(input.collections),
    scoreModeNames(input.collections),
    // Styles layer (40 pts)
    scoreStyleName(input.styles),
    scoreStyleDescription(input.styles, designRules),
    scoreStyleFolderStructure(input.styles),
    scoreStyleGroupConsistency(input.styles),
  ];

  const overallScore = Math.round(points.reduce((sum, p) => sum + p.weightedScore, 0) * 100) / 100;
  const variablesLayerScore = Math.round(points.filter(p => p.layer === 'variables').reduce((s, p) => s + p.weightedScore, 0) * 100) / 100;
  const stylesLayerScore = Math.round(points.filter(p => p.layer === 'styles').reduce((s, p) => s + p.weightedScore, 0) * 100) / 100;

  let tier: DSMaturityTier;
  if (overallScore >= 80) tier = 'AI-Ready';
  else if (overallScore >= 60) tier = 'Maturing';
  else if (overallScore >= 35) tier = 'Needs Work';
  else tier = 'Critical';

  const summary = `DS Context Maturity: ${overallScore}/100 (${tier}). Variables: ${variablesLayerScore}/60, Styles: ${stylesLayerScore}/40.`;

  return { overallScore, tier, variablesLayerScore, stylesLayerScore, points, summary };
}
