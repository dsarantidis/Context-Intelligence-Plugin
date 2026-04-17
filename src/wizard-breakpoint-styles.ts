/**
 * Breakpoint / typography text styles — list + token options for the Foundation wizard.
 * Text style names use folder segments (e.g. …/.breakpoint/…/typography/…/Style).
 */

export interface WizardTextStyleSnapshot {
  id: string;
  name: string;
  /** Folder path without the leaf style name (segments joined by /). */
  folderPath: string;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  lineHeightDisplay: string;
  letterSpacingDisplay: string;
  /** Current variable binding ids per field (if any). */
  bindings: Partial<Record<VariableBindableTextField, string>>;
  /** Resolved token display for bound fields (default mode), e.g. fontSize → "72px". */
  resolvedByField?: Partial<Record<VariableBindableTextField, string>>;
}

const BIND_FIELDS: VariableBindableTextField[] = [
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent',
];

/** Normalize Figma style path: spaces around slashes, duplicate slashes (folder quirks). */
function normalizeStylePathForMatch(styleName: string): string {
  return styleName
    .replace(/\s*\/\s*/g, '/')
    .replace(/\/+/g, '/')
    .trim()
    .toLowerCase();
}

/**
 * True if the text style path is breakpoint + typography (e.g. …/breakpoint/typography/display/…
 * or …/.breakpoint/typography/…). Matches folder layouts like "breakpoint / typography / title-L".
 */
export function isBreakpointTypographyStyleName(styleName: string): boolean {
  const normalized = normalizeStylePathForMatch(styleName);
  if (
    normalized.includes('breakpoint/typography') ||
    normalized.includes('.breakpoint/typography')
  ) {
    return true;
  }
  const parts = normalized.split('/').map(p => p.trim());
  const hasBreakpoint = parts.some(
    p => p === '.breakpoint' || p === 'breakpoint' || p === 'breakpoints',
  );
  const hasTypography = parts.some(p => p === 'typography');
  return hasBreakpoint && hasTypography;
}

function letterSpacingToDisplay(ls: LetterSpacing): string {
  const u = ls.unit === 'PERCENT' ? '%' : 'px';
  return `${ls.value}${u}`;
}

function lineHeightToDisplay(lh: LineHeight): string {
  if (lh.unit === 'AUTO') return 'Auto';
  if (lh.unit === 'PERCENT') return `${lh.value}%`;
  return `${lh.value}px`;
}

export function snapshotTextStyle(style: TextStyle): WizardTextStyleSnapshot {
  const name = style.name;
  const lastSlash = name.lastIndexOf('/');
  const folderPath = lastSlash > 0 ? name.slice(0, lastSlash) : '';

  const bv = style.boundVariables || {};
  const bindings: Partial<Record<VariableBindableTextField, string>> = {};
  for (const f of BIND_FIELDS) {
    const a = bv[f as keyof typeof bv];
    if (a && typeof a === 'object' && 'id' in a) bindings[f] = (a as VariableAlias).id;
  }

  return {
    id: style.id,
    name,
    folderPath,
    fontFamily: style.fontName.family,
    fontStyle: style.fontName.style,
    fontSize: style.fontSize,
    lineHeightDisplay: lineHeightToDisplay(style.lineHeight),
    letterSpacingDisplay: letterSpacingToDisplay(style.letterSpacing),
    bindings,
  };
}

/** One row in a token slot dropdown (may point to .core or another collection). */
export interface TypographyTokenDropdownChoice {
  id: string;
  name: string;
  resolvedValueDisplay: string;
}

export interface TypographyTokenOption {
  id: string;
  name: string;
  resolvedType: 'FLOAT' | 'STRING' | 'BOOLEAN' | 'COLOR';
  /**
   * Path prefix for the style folder (…/typography/display) when the variable lives
   * under breakpoint → typography → &lt;style&gt; → …
   */
  styleGroupPath?: string;
  /** Human-readable value for the collection default mode (aliases resolved). */
  resolvedValueDisplay?: string;
  /**
   * When the breakpoint variable aliases into another group (e.g. .core font/weight),
   * all variables in that folder + the selected alias target id.
   */
  dropdownChoices?: TypographyTokenDropdownChoice[];
  /** Variable id the alias points to (first hop), or this variable’s id for name-folder fallback. */
  dropdownSelectedId?: string;
}

function isVariableAliasValue(val: unknown): val is VariableAlias {
  return (
    typeof val === 'object' &&
    val !== null &&
    (val as VariableAlias).type === 'VARIABLE_ALIAS' &&
    typeof (val as VariableAlias).id === 'string'
  );
}

/**
 * True if any folder segment (not the leaf) marks a line-height group, e.g.
 * …/line-heights/body/120 — leaf `120` must still be line-height, not px.
 */
function pathHasLineHeightGroupSegment(parts: string[]): boolean {
  if (parts.length < 2) return false;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (
      p.includes('line-height') ||
      p === 'line-heights' ||
      p === 'leading' ||
      p.includes('lineheight') ||
      p === 'lh'
    )
      return true;
  }
  return false;
}

/**
 * Format FLOAT for typography variable names (e.g. font-size → 72px).
 * Uses {@link leafSemanticKey} so numeric leaves (e.g. …/line-heights/120) match line-height rules.
 * Exported for scan / issue `sourceValue` in code.ts (same rules as wizard labels).
 */
export function formatTypographicFloatDisplay(varName: string, n: number): string {
  const slot = leafSemanticKey(varName);
  if (slot === 'fontWeight') return String(n);
  if (slot === 'fontSize') return `${n}px`;
  if (slot === 'lineHeight') {
    if (n > 0 && n <= 2.5) return String(n);
    const rounded = Math.round(n);
    if (Math.abs(n - rounded) < 1e-6 && rounded >= 50 && rounded <= 250) return String(rounded);
    return `${n}px`;
  }
  if (slot === 'paragraphSpacing' || slot === 'paragraphIndent') return `${n}px`;
  if (slot === 'letterSpacing') {
    const full = varName.toLowerCase();
    if (full.includes('percent') || full.includes('%')) return `${n}%`;
    const abs = Math.abs(n);
    if (abs <= 12 && Math.abs(n - Math.round(n * 2) / 2) < 1e-6) return String(n);
    return `${n}px`;
  }
  return `${n}px`;
}

function rgbToHex(c: RGB): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return (
    '#' +
    [r, g, b]
      .map(x => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

function formatVariablePrimitiveDisplay(variable: Variable, raw: unknown): string {
  if (variable.resolvedType === 'FLOAT' && typeof raw === 'number') {
    return formatTypographicFloatDisplay(variable.name, raw);
  }
  if (variable.resolvedType === 'STRING' && typeof raw === 'string') return raw;
  if (variable.resolvedType === 'BOOLEAN' && typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (variable.resolvedType === 'COLOR' && typeof raw === 'object' && raw !== null && 'r' in (raw as RGB)) {
    return rgbToHex(raw as RGB);
  }
  return String(raw);
}

/**
 * Resolved display string for a variable in the given mode (follows VARIABLE_ALIAS, depth-capped).
 */
export async function resolveVariableValueDisplay(
  variable: Variable,
  modeId: string,
  depth = 0,
): Promise<string> {
  if (depth > 24) return '…';
  const modes = variable.valuesByMode as Record<string, unknown>;
  const keys = Object.keys(modes);
  if (keys.length === 0) return '—';
  const effectiveMode = modeId && modeId in modes ? modeId : keys[0];
  const raw = modes[effectiveMode];
  if (raw === undefined || raw === null) return '—';
  if (isVariableAliasValue(raw)) {
    const next = await figma.variables.getVariableByIdAsync(raw.id);
    if (!next) return '(missing variable)';
    return resolveVariableValueDisplay(next, modeId, depth + 1);
  }
  return formatVariablePrimitiveDisplay(variable, raw);
}

/**
 * Fill `resolvedByField` on each snapshot from bound variables (default mode of `.breakpoint`).
 */
export async function enrichBreakpointTextStyleSnapshots(
  snapshots: WizardTextStyleSnapshot[],
  modeId: string,
): Promise<void> {
  await Promise.all(
    snapshots.map(async snap => {
      const rb: Partial<Record<VariableBindableTextField, string>> = {};
      await Promise.all(
        BIND_FIELDS.map(async f => {
          const vid = snap.bindings[f];
          if (!vid) return;
          const variable = await figma.variables.getVariableByIdAsync(vid);
          if (variable) rb[f] = await resolveVariableValueDisplay(variable, modeId);
        }),
      );
      if (Object.keys(rb).length) snap.resolvedByField = rb;
    }),
  );
}

/**
 * Style group derived only from variables (each folder under …/typography/&lt;style&gt;/…).
 */
export interface BreakpointTypographyStyleGroup {
  id: string;
  label: string;
  folderPath: string;
  tokens: TypographyTokenOption[];
}

/**
 * Path prefix up to and including the segment after `typography` (the style group folder),
 * e.g. `breakpoint/typography/display` from `breakpoint/typography/display/font-size`.
 */
function variableStyleGroupPath(variableName: string): string | null {
  const n = normalizeStylePathForMatch(variableName);
  const parts = n.split('/').filter(Boolean);
  const tyI = parts.indexOf('typography');
  if (tyI < 0) return null;
  let bpI = -1;
  for (let i = 0; i < tyI; i++) {
    if (parts[i] === 'breakpoint' || parts[i] === '.breakpoint' || parts[i] === 'breakpoints') {
      bpI = i;
      break;
    }
  }
  if (bpI < 0) return null;
  if (tyI + 1 >= parts.length) return null;
  return parts.slice(0, tyI + 2).join('/');
}

function isFontSizeLikeTokenName(name: string): boolean {
  const leaf = (name.split('/').pop() || name).toLowerCase();
  return leaf.includes('font-size') || leaf.endsWith('-size') || /\bfont-size\b/.test(name.toLowerCase());
}

function parsePxFromResolvedDisplay(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/px/gi, '').replace(/,/g, '').trim());
  return !Number.isNaN(n) && n > 0 ? n : null;
}

/** Sort tokens: font-size by px value, then others by path. */
function sortTokensWithinStyleGroup(tokens: TypographyTokenOption[]): void {
  tokens.sort((a, b) => {
    const aPx = isFontSizeLikeTokenName(a.name) ? parsePxFromResolvedDisplay(a.resolvedValueDisplay) : null;
    const bPx = isFontSizeLikeTokenName(b.name) ? parsePxFromResolvedDisplay(b.resolvedValueDisplay) : null;
    if (aPx != null && bPx != null) return aPx - bPx;
    if (aPx != null) return -1;
    if (bPx != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

function representativeFontSizePxForGroup(g: BreakpointTypographyStyleGroup): number {
  for (const t of g.tokens) {
    if (isFontSizeLikeTokenName(t.name)) {
      const px = parsePxFromResolvedDisplay(t.resolvedValueDisplay);
      if (px != null) return px;
    }
  }
  return -1;
}

/** Group token options that have a `styleGroupPath` into cards for the wizard UI. */
export function groupTypographyTokensByStyle(
  tokens: TypographyTokenOption[],
): BreakpointTypographyStyleGroup[] {
  const map = new Map<string, TypographyTokenOption[]>();
  for (const t of tokens) {
    const p = t.styleGroupPath;
    if (!p) continue;
    if (!map.has(p)) map.set(p, []);
    map.get(p)!.push(t);
  }
  const out: BreakpointTypographyStyleGroup[] = [];
  for (const [folderPath, tok] of map) {
    const parts = folderPath.split('/');
    const label = parts[parts.length - 1] || folderPath;
    sortTokensWithinStyleGroup(tok);
    out.push({ id: folderPath, label, folderPath, tokens: tok });
  }
  out.sort((a, b) => representativeFontSizePxForGroup(b) - representativeFontSizePxForGroup(a));
  return out;
}

function parentFolderPathForVariableName(name: string): string {
  const i = name.lastIndexOf('/');
  return i >= 0 ? name.slice(0, i) : '';
}

/**
 * Same typography “slot” as the breakpoint variable row (aligns with .core token names).
 * Uses path segments so `…/weight/400` still classifies as fontWeight.
 */
function leafSemanticKey(name: string): string {
  const full = name.toLowerCase();
  const parts = name.split('/').map(p => p.toLowerCase());
  const leaf = (parts[parts.length - 1] || '').toLowerCase();
  const seg = (re: RegExp) => parts.some(p => re.test(p));
  if (full.includes('font-family') || seg(/^family$/) || seg(/font-family/)) return 'fontFamily';
  if (full.includes('font-weight') || seg(/^weight$/) || seg(/font-weight/) || /\/weight\//.test(full))
    return 'fontWeight';
  if (full.includes('font-size') || seg(/^size$/) || seg(/font-size/) || /\/size\//.test(full))
    return 'fontSize';
  if (pathHasLineHeightGroupSegment(parts)) return 'lineHeight';
  if (full.includes('line-height') || seg(/line-height/) || seg(/leading/) || seg(/lineheight/))
    return 'lineHeight';
  if (
    full.includes('letter-spacing') ||
    (full.includes('letter') && full.includes('spacing')) ||
    seg(/letter-spacing/)
  )
    return 'letterSpacing';
  if (full.includes('paragraph-spacing') || seg(/paragraph-spacing/)) return 'paragraphSpacing';
  if (full.includes('paragraph-indent') || full.includes('indent') || seg(/paragraph-indent/))
    return 'paragraphIndent';
  if (full.includes('font-style') || seg(/^style$/) || seg(/font-style/)) return 'fontStyle';
  return leaf;
}

/** Direct FLOAT primitive for a mode (does not follow VARIABLE_ALIAS). */
function floatPrimitiveForVariable(variable: Variable, modeId: string): number | null {
  const modes = variable.valuesByMode as Record<string, unknown>;
  const keys = Object.keys(modes);
  if (keys.length === 0) return null;
  const eff = modeId && modeId in modes ? modeId : keys[0];
  const raw = modes[eff];
  if (isVariableAliasValue(raw)) return null;
  if (variable.resolvedType === 'FLOAT' && typeof raw === 'number') return raw;
  return null;
}

/**
 * Best `.core` folder that groups line-height FLOATs (prefers paths containing `line-heights`).
 */
function findCoreLineHeightsParentPath(allVars: Variable[], coreCollId: string): string | null {
  const candidates = allVars.filter(
    v =>
      v.variableCollectionId === coreCollId &&
      v.resolvedType === 'FLOAT' &&
      leafSemanticKey(v.name || '') === 'lineHeight',
  );
  if (candidates.length === 0) return null;
  const byParent = new Map<string, Variable[]>();
  for (const v of candidates) {
    const p = parentFolderPathForVariableName(v.name || '');
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(v);
  }
  let best: string | null = null;
  let bestScore = -1;
  for (const [p, list] of byParent) {
    const pl = p.toLowerCase();
    let score = list.length;
    if (pl.includes('line-heights')) score += 1000;
    else if (pl.includes('line-height')) score += 100;
    else if (pl.includes('leading')) score += 50;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** First VARIABLE_ALIAS target in the default mode (e.g. breakpoint → .core token). */
function firstAliasTargetId(variable: Variable, modeId: string): string | null {
  const modes = variable.valuesByMode as Record<string, unknown>;
  const keys = Object.keys(modes);
  if (keys.length === 0) return null;
  const eff = modeId && modeId in modes ? modeId : keys[0];
  const raw = modes[eff];
  if (isVariableAliasValue(raw)) return raw.id;
  return null;
}

/**
 * Dropdown = variables in the same collection + folder + semantic leaf as the alias target,
 * or the same inside .breakpoint when there is no alias. Never mix collections by path string alone.
 */
async function buildDropdownChoicesForVariable(
  v: Variable,
  breakpointModeId: string,
  allVars: Variable[],
  modeByCollectionId: Map<string, string>,
  coreCollectionId: string | null,
): Promise<{ choices: TypographyTokenDropdownChoice[]; selectedId: string }> {
  const modeFor = (variable: Variable): string =>
    modeByCollectionId.get(variable.variableCollectionId) ?? breakpointModeId;

  const selfDisplay = await resolveVariableValueDisplay(v, modeFor(v));

  const hopId = firstAliasTargetId(v, modeFor(v));
  if (hopId) {
    const hop = await figma.variables.getVariableByIdAsync(hopId);
    if (hop) {
      const parent = parentFolderPathForVariableName(hop.name || '');
      const hopColl = hop.variableCollectionId;
      const semantic = leafSemanticKey(v.name || '');
      if (parent.length > 0) {
        const baseFilter = (o: Variable) =>
          o.variableCollectionId === hopColl &&
          o.resolvedType === v.resolvedType &&
          parentFolderPathForVariableName(o.name || '') === parent;
        let opts = allVars.filter(o => baseFilter(o) && leafSemanticKey(o.name || '') === semantic);
        if (opts.length === 0) {
          opts = allVars.filter(baseFilter);
        }
        if (opts.length > 0) {
          const displays = await Promise.all(opts.map(o => resolveVariableValueDisplay(o, modeFor(o))));
          const choices: TypographyTokenDropdownChoice[] = opts.map((o, i) => ({
            id: o.id,
            name: o.name || '',
            resolvedValueDisplay: displays[i],
          }));
          choices.sort((a, b) => a.name.localeCompare(b.name));
          if (!choices.some(c => c.id === hopId)) {
            choices.push({
              id: hop.id,
              name: hop.name || '',
              resolvedValueDisplay: await resolveVariableValueDisplay(hop, modeFor(hop)),
            });
            choices.sort((a, b) => a.name.localeCompare(b.name));
          }
          return { choices, selectedId: hopId };
        }
      }
    }
  }

  // Raw FLOAT line-height on .breakpoint (no alias) → list siblings from `.core` line-heights group
  if (
    coreCollectionId &&
    leafSemanticKey(v.name || '') === 'lineHeight' &&
    v.resolvedType === 'FLOAT' &&
    !hopId
  ) {
    const vMode = modeFor(v);
    const vFloat = floatPrimitiveForVariable(v, vMode);
    if (vFloat != null) {
      const lhParent = findCoreLineHeightsParentPath(allVars, coreCollectionId);
      if (lhParent) {
        const opts = allVars.filter(
          o =>
            o.variableCollectionId === coreCollectionId &&
            o.resolvedType === 'FLOAT' &&
            parentFolderPathForVariableName(o.name || '') === lhParent &&
            leafSemanticKey(o.name || '') === 'lineHeight',
        );
        if (opts.length > 0) {
          opts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          const displays = await Promise.all(opts.map(o => resolveVariableValueDisplay(o, modeFor(o))));
          const coreChoices: TypographyTokenDropdownChoice[] = opts.map((o, i) => ({
            id: o.id,
            name: o.name || '',
            resolvedValueDisplay: displays[i],
          }));
          let matchedCoreId: string | null = null;
          for (let i = 0; i < opts.length; i++) {
            const of = floatPrimitiveForVariable(opts[i], modeFor(opts[i]));
            if (of != null && Math.abs(of - vFloat) < 1e-5) {
              matchedCoreId = opts[i].id;
              break;
            }
          }
          if (matchedCoreId == null) {
            const selfTrim = selfDisplay.trim();
            for (let i = 0; i < opts.length; i++) {
              if (displays[i].trim() === selfTrim) {
                matchedCoreId = opts[i].id;
                break;
              }
            }
          }
          if (matchedCoreId != null) {
            return { choices: coreChoices, selectedId: matchedCoreId };
          }
          // Raw value does not match any .core line-height token — show actual value, not first token.
          return {
            choices: [
              {
                id: v.id,
                name: v.name || '',
                resolvedValueDisplay: selfDisplay,
              },
              ...coreChoices,
            ],
            selectedId: v.id,
          };
        }
      }
    }
  }

  const parent = parentFolderPathForVariableName(v.name || '');
  const semanticV = leafSemanticKey(v.name || '');
  if (parent.length > 0) {
    const baseFilterV = (o: Variable) =>
      o.variableCollectionId === v.variableCollectionId &&
      o.resolvedType === v.resolvedType &&
      parentFolderPathForVariableName(o.name || '') === parent;
    let opts = allVars.filter(o => baseFilterV(o) && leafSemanticKey(o.name || '') === semanticV);
    if (opts.length === 0) {
      opts = allVars.filter(baseFilterV);
    }
    if (opts.length > 0) {
      const displays = await Promise.all(opts.map(o => resolveVariableValueDisplay(o, modeFor(o))));
      const choices = opts.map((o, i) => ({
        id: o.id,
        name: o.name || '',
        resolvedValueDisplay: displays[i],
      }));
      choices.sort((a, b) => a.name.localeCompare(b.name));
      return { choices, selectedId: v.id };
    }
  }

  return {
    choices: [{ id: v.id, name: v.name || '', resolvedValueDisplay: selfDisplay }],
    selectedId: v.id,
  };
}

/**
 * Variables in `.breakpoint` on a typography path (`…/typography/…`). Each token gets
 * `styleGroupPath` when it sits under `…/typography/&lt;style&gt;/…`.
 */
export async function getBreakpointTypographyTokenOptions(): Promise<TypographyTokenOption[]> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const bp = collections.find(c => c.name === '.breakpoint') ?? null;
  if (!bp) return [];
  const defaultModeId = bp.modes[0]?.modeId;
  if (!defaultModeId) return [];

  const coreColl =
    collections.find(c => c.name === '.core') ?? collections.find(c => c.name === 'core') ?? null;
  const coreCollectionId = coreColl?.id ?? null;

  const modeByCollectionId = new Map<string, string>();
  for (const c of collections) {
    const mid = c.modes[0]?.modeId;
    if (mid) modeByCollectionId.set(c.id, mid);
  }

  const all = await figma.variables.getLocalVariablesAsync();
  const candidates: Variable[] = [];
  for (const v of all) {
    if (v.variableCollectionId !== bp.id) continue;
    const lower = v.name.toLowerCase();
    const onTypoPath =
      lower.includes('typography') || variableStyleGroupPath(v.name) !== null;
    if (!onTypoPath) continue;
    if (
      v.resolvedType !== 'FLOAT' &&
      v.resolvedType !== 'STRING' &&
      v.resolvedType !== 'BOOLEAN' &&
      v.resolvedType !== 'COLOR'
    ) {
      continue;
    }
    candidates.push(v);
  }
  const displays = await Promise.all(
    candidates.map(v =>
      resolveVariableValueDisplay(
        v,
        modeByCollectionId.get(v.variableCollectionId) ?? defaultModeId,
      ),
    ),
  );
  const dropdownMetas = await Promise.all(
    candidates.map(v =>
      buildDropdownChoicesForVariable(v, defaultModeId, all, modeByCollectionId, coreCollectionId),
    ),
  );
  const out: TypographyTokenOption[] = candidates.map((v, i) => {
    const dm = dropdownMetas[i];
    return {
      id: v.id,
      name: v.name || '',
      resolvedType: v.resolvedType,
      styleGroupPath: variableStyleGroupPath(v.name || '') ?? undefined,
      resolvedValueDisplay: displays[i],
      dropdownChoices: dm.choices.length ? dm.choices : undefined,
      dropdownSelectedId: dm.selectedId,
    };
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function fieldAcceptsResolvedType(
  field: VariableBindableTextField,
  t: 'FLOAT' | 'STRING' | 'BOOLEAN' | 'COLOR',
): boolean {
  if (t === 'COLOR' || t === 'BOOLEAN') return false;
  switch (field) {
    case 'fontFamily':
    case 'fontStyle':
      return t === 'STRING';
    case 'fontSize':
    case 'fontWeight':
    case 'lineHeight':
    case 'letterSpacing':
    case 'paragraphSpacing':
    case 'paragraphIndent':
      return t === 'FLOAT';
    default:
      return false;
  }
}

export const WIZARD_BINDABLE_TEXT_FIELDS = BIND_FIELDS;
