/**
 * Setup Wizard — Foundation Onboarding
 *
 * Ported from "The Bridge" plugin (Design System Set up Plugin).
 * Provides: tonal palette generation, full config apply,
 * architecture detection, and foundation token value resolution.
 *
 * All functions are called from code.ts message handlers.
 * Pure Figma-sandbox code — no DOM, no fetch.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RGB { r: number; g: number; b: number; a?: number }

export interface PaletteStop {
  h: number; s: number; l: number;
  hex: string;
  rgb: { r: number; g: number; b: number };
}

export interface TonalPaletteResult {
  sourceShade: number;
  sourceHSL: { h: number; s: number; l: number };
  palette: Record<string, PaletteStop>;
  offset: number;
}

/** Keys for optional per-shade hex overrides (100–900) on wizard-generated scales. */
export type WizardPaletteLaneKey =
  | 'brand'
  | 'brand-second'
  | 'neutral'
  | 'functional-success'
  | 'functional-warning'
  | 'functional-danger'
  | 'functional-info';

export interface WizardConfig {
  primaryColor: string;
  secondaryColors?: Array<{ name: string; hex: string; paletteOverrides?: Record<string, string> }>;
  neutralColor?: string;
  functionalColors?: {
    success?: string;
    warning?: string;
    danger?: string;
    info?: string;
  };
  fontFamily: string;
  /** Optional second family; written to `font-family/secondary` in `.core`. */
  fontFamilySecondary?: string;
  isVariableFont?: boolean;
  /** Optional second hex for the primary brand; maps to accent-style `brand` variables in `.core` (see `isSecondBrandLane`). */
  secondaryBrandColor?: string;
  /** When false, skip writing generated palettes to `.core` (typography / font-family only). Default true. */
  applyColorTokens?: boolean;
  /**
   * Optional per-shade hex overrides for generated 9-stop scales (keys "100"…"900").
   * When set for a lane, those stops are written instead of the auto-generated hex.
   */
  paletteOverrides?: Partial<Record<WizardPaletteLaneKey, Record<string, string>>>;
  /** Kept for backward compat — no longer exposed in the wizard UI. */
  cornerStrategy?: 'sharp' | 'soft' | 'rounded' | 'pill';
  typeScale?: string;
  baseSize?: number;
  lineHeight?: number;
  density?: string;
  elevation?: string;
  animationSpeed?: string;
  tokenMappings?: Record<string, string>;
  activeSchemes?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Color utilities
// ─────────────────────────────────────────────────────────────────────────────

export function hexToFigmaRGB(hex: string): RGB {
  hex = hex.replace(/^#/, '');
  if (!/^[0-9A-Fa-f]+$/.test(hex)) throw new Error(`Invalid hex: "${hex}"`);
  let r: number, g: number, b: number, a = 1;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
  } else if (hex.length === 8) {
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
    a = parseInt(hex.substring(6, 8), 16) / 255;
  } else {
    throw new Error(`Invalid hex format: "${hex}"`);
  }
  return { r, g, b, a };
}

/** Figma COLOR variables require each RGB channel in [0, 1]; HSL→RGB can drift slightly outside. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Safe RGB for `setValueForMode` on COLOR variables — derived from hex so channels stay valid. */
function figmaRGBFromHex(hex: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToFigmaRGB(hex);
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const rgb = hexToFigmaRGB(hex);
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / delta + 2) / 6;
    else h = ((r - g) / delta + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 1000) / 10, l: Math.round(l * 1000) / 10 };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) {         g = c; b = x; }
  else if (h < 240) {         g = x; b = c; }
  else if (h < 300) { r = x;         b = c; }
  else              { r = c;         b = x; }
  const toH = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return ('#' + toH(r) + toH(g) + toH(b)).toUpperCase();
}

function hslToRGB(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) {         g = c; b = x; }
  else if (h < 240) {         g = x; b = c; }
  else if (h < 300) { r = x;         b = c; }
  else              { r = c;         b = x; }
  return { r: r + m, g: g + m, b: b + m };
}

// Lightness → shade stop mapping (from DS Foundations Memory § Color Scale Generation Rule)
const LIGHTNESS_MAP: Record<number, number> = {
  100: 95, 200: 85, 300: 75, 400: 60, 500: 50,
  600: 40, 700: 30, 800: 20, 900: 10,
};
const SHADE_THRESHOLDS = [
  { shade: 100, min: 90, max: 100 },
  { shade: 200, min: 75, max: 90  },
  { shade: 300, min: 60, max: 75  },
  { shade: 400, min: 45, max: 60  },
  { shade: 500, min: 30, max: 45  },
  { shade: 600, min: 20, max: 30  },
  { shade: 700, min: 12, max: 20  },
  { shade: 800, min:  5, max: 12  },
  { shade: 900, min:  0, max:  5  },
];

function findClosestShade(l: number): number {
  for (const t of SHADE_THRESHOLDS) {
    if (l >= t.min && l <= t.max) return t.shade;
  }
  let best = 500, bestDist = 999;
  for (const k of Object.keys(LIGHTNESS_MAP)) {
    const d = Math.abs(l - LIGHTNESS_MAP[+k]);
    if (d < bestDist) { bestDist = d; best = +k; }
  }
  return best;
}

/**
 * Generate a 9-stop perceptual tonal palette from a seed hex color.
 * The seed lands at its natural lightness stop — it is not forced to a fixed shade.
 */
export function generateTonalPalette(seedHex: string): TonalPaletteResult {
  const hsl = hexToHSL(seedHex);
  const sourceShade = findClosestShade(hsl.l);
  const targetL = LIGHTNESS_MAP[sourceShade];
  const offset = hsl.l - targetL;

  const palette: Record<string, PaletteStop> = {};
  for (const shadeStr of Object.keys(LIGHTNESS_MAP)) {
    const shade = +shadeStr;
    let adjL = Math.max(0, Math.min(100, LIGHTNESS_MAP[shade] + offset));
    let adjS = hsl.s;
    if (adjL > 70) adjS = hsl.s * (1 - ((adjL - 70) / 30) * 0.3);
    else if (adjL < 30) adjS = Math.min(100, hsl.s * (1 + ((30 - adjL) / 30) * 0.2));
    adjS = Math.round(adjS * 10) / 10;
    adjL = Math.round(adjL * 10) / 10;
    palette[shadeStr] = {
      h: hsl.h, s: adjS, l: adjL,
      hex: hslToHex(hsl.h, adjS, adjL),
      rgb: hslToRGB(hsl.h, adjS, adjL),
    };
  }

  return { sourceShade, sourceHSL: hsl, palette, offset };
}

/** Returns only the RGB values keyed by shade number — for Figma variable writes. */
export function generateShadeScale(seedHex: string): Record<string, { r: number; g: number; b: number }> {
  const result = generateTonalPalette(seedHex);
  const shades: Record<string, { r: number; g: number; b: number }> = {};
  for (const k of Object.keys(result.palette)) shades[k] = result.palette[k].rgb;
  return shades;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full configuration apply
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — write a generated palette into matching .core variables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Second primary-brand value lane: names like `brand-accent/500`, `brand/accent/500`, `brand-alt/500`, `brand-2/500`.
 * The main primary scale uses `brand` in the name but does not match this lane.
 */
function isSecondBrandLane(lower: string): boolean {
  if (!lower.includes('brand')) return false;
  if (lower.includes('brand-accent') || lower.includes('brand/accent')) return true;
  if (/\bbrand[-/_]accent\b/.test(lower)) return true;
  if (/\bbrand[-/_]alt\b/.test(lower)) return true;
  if (/\bbrand[-/_]2\b/.test(lower)) return true;
  return false;
}

function isPrimaryBrandLane(lower: string): boolean {
  return lower.includes('brand') && !isSecondBrandLane(lower);
}

/**
 * Generates a 9-stop palette from `seedHex` and writes each shade to variables
 * in the `.core` collection whose name satisfies `nameFilter` and contains a
 * shade number (100–900).
 *
 * Returns { updated, palette } so callers can aggregate counters.
 */
const SHADE_KEYS = new Set(['100', '200', '300', '400', '500', '600', '700', '800', '900']);

function normalizeShadeHexOverrides(
  raw?: Record<string, string>,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!SHADE_KEYS.has(k)) continue;
    const hex = typeof v === 'string' ? v.trim() : '';
    if (!/^#[0-9A-Fa-f]{6}$/i.test(hex)) continue;
    out[k] = hex.toUpperCase();
  }
  return Object.keys(out).length ? out : undefined;
}

async function writePaletteToCore(
  seedHex: string,
  nameFilter: (lower: string) => boolean,
  coreColl: VariableCollection,
  shadeHexOverrides?: Record<string, string>,
): Promise<{ updated: number; palette: TonalPaletteResult }> {
  const palette = generateTonalPalette(seedHex);
  const overrides = normalizeShadeHexOverrides(shadeHexOverrides);
  const defaultMode = coreColl.modes[0].modeId;
  let updated = 0;

  for (const varId of coreColl.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(varId);
    if (!v || v.resolvedType !== 'COLOR') continue;

    const nameLower = v.name.toLowerCase();
    if (!nameFilter(nameLower)) continue;

    const shadeMatch = v.name.match(/\b(100|200|300|400|500|600|700|800|900)\b/);
    if (!shadeMatch) continue;

    const entry = palette.palette[shadeMatch[1]];
    if (!entry) continue;

    const hex = overrides?.[shadeMatch[1]] ?? entry.hex;
    const fig = figmaRGBFromHex(hex);
    v.setValueForMode(defaultMode, fig);
    updated++;
  }

  return { updated, palette };
}

/** `.core` STRING variables whose names start with `font-family/` (Figma group path). */
const FONT_FAMILY_GROUP_PREFIX = /^font-family\//i;

const FONT_FAMILY_READ_PRIORITY = [
  'font-family/primary',
  'font-family/base',
  'font-family/default',
  'font-family/font-family',
];

const FONT_FAMILY_SLOT_PRIMARY = 'font-family/primary';
const FONT_FAMILY_SLOT_SECONDARY = 'font-family/secondary';

/**
 * Reads primary + optional secondary font strings from `.core` under `font-family/`.
 */
export async function readFontFamiliesFromCore(
  coreColl: VariableCollection,
): Promise<{ primary?: string; secondary?: string }> {
  const defaultMode = coreColl.modes[0].modeId;
  const found: Array<{ name: string; value: string }> = [];
  for (const varId of coreColl.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(varId);
    if (!v || v.resolvedType !== 'STRING') continue;
    if (!FONT_FAMILY_GROUP_PREFIX.test(v.name)) continue;
    const raw = (v.valuesByMode as Record<string, unknown>)[defaultMode];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    found.push({ name: v.name, value });
  }
  if (found.length === 0) return {};

  const byExact = (canonical: string) =>
    found.find(f => f.name.toLowerCase() === canonical.toLowerCase())?.value;

  const secondary = byExact(FONT_FAMILY_SLOT_SECONDARY);

  let primary = byExact(FONT_FAMILY_SLOT_PRIMARY);
  if (!primary) {
    for (const p of FONT_FAMILY_READ_PRIORITY) {
      if (p.toLowerCase() === FONT_FAMILY_SLOT_SECONDARY.toLowerCase()) continue;
      const hit = found.find(f => f.name.toLowerCase() === p.toLowerCase());
      if (hit) {
        primary = hit.value;
        break;
      }
    }
  }
  if (!primary) {
    const rest = found.filter(f => f.name.toLowerCase() !== FONT_FAMILY_SLOT_SECONDARY.toLowerCase());
    rest.sort((a, b) => a.name.localeCompare(b.name));
    if (rest.length > 0) primary = rest[0].value;
  }

  return { primary, secondary };
}

/** @deprecated Use readFontFamiliesFromCore — returns primary only. */
export async function readFontFamilyFromCore(coreColl: VariableCollection): Promise<string | undefined> {
  const { primary } = await readFontFamiliesFromCore(coreColl);
  return primary;
}

/**
 * Sets one slot (`font-family/primary` or `font-family/secondary`). Creates the variable in `.core` if missing.
 */
export async function writeFontFamilySlot(
  coreColl: VariableCollection,
  fontFamily: string,
  slot: 'primary' | 'secondary',
): Promise<number> {
  const name = slot === 'primary' ? FONT_FAMILY_SLOT_PRIMARY : FONT_FAMILY_SLOT_SECONDARY;
  const trimmed = fontFamily.trim();
  if (!trimmed) return 0;
  const defaultMode = coreColl.modes[0].modeId;
  for (const varId of coreColl.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(varId);
    if (!v || v.resolvedType !== 'STRING') continue;
    if (v.name.toLowerCase() === name.toLowerCase()) {
      v.setValueForMode(defaultMode, trimmed);
      return 1;
    }
  }
  const created = figma.variables.createVariable(name, coreColl, 'STRING');
  created.setValueForMode(defaultMode, trimmed);
  return 1;
}

export async function applyFullConfiguration(config: WizardConfig): Promise<{
  success: boolean; totalUpdated: number; errors: string[];
  palette: { sourceShade: number; shadeCount: number } | null;
  config: Partial<WizardConfig>;
}> {
  let totalUpdated = 0;
  const errors: string[] = [];
  let primaryPaletteResult: TonalPaletteResult | null = null;

  // Locate .core collection once — shared by all color writes below.
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const coreColl = collections.find(c => c.name === '.core') ??
                   collections.find(c => c.name === 'core') ?? null;

  const applyColors = config.applyColorTokens !== false;

  if (applyColors) {
    // 1. Brand color(s) — primary lane vs optional second (accent) lane
    try {
      if (coreColl) {
        const { updated, palette } = await writePaletteToCore(
          config.primaryColor,
          isPrimaryBrandLane,
          coreColl,
          config.paletteOverrides?.brand,
        );
        primaryPaletteResult = palette;
        totalUpdated += updated;
        const secHex = config.secondaryBrandColor?.trim();
        if (secHex) {
          const { updated: u2 } = await writePaletteToCore(
            secHex,
            isSecondBrandLane,
            coreColl,
            config.paletteOverrides?.['brand-second'],
          );
          totalUpdated += u2;
        }
      } else {
        primaryPaletteResult = generateTonalPalette(config.primaryColor);
      }
    } catch (e: unknown) {
      errors.push('Brand color: ' + (e instanceof Error ? e.message : String(e)));
    }

    // 2. Secondary colors → .core variables containing "secondary"
    //    Each entry in secondaryColors generates its own 9-stop scale.
    if (coreColl && config.secondaryColors && config.secondaryColors.length > 0) {
    for (const sec of config.secondaryColors) {
      if (!sec.hex) continue;
      try {
        const { updated } = await writePaletteToCore(
          sec.hex,
          n => n.includes('secondary'),
          coreColl,
          sec.paletteOverrides,
        );
        totalUpdated += updated;
      } catch (e: unknown) {
        errors.push(`Secondary "${sec.name}": ` + (e instanceof Error ? e.message : String(e)));
      }
    }
    }

    // 3. Neutral color → .core variables containing "neutral" (non-scheme vars, raw values)
    if (coreColl && config.neutralColor) {
    try {
      const { updated } = await writePaletteToCore(
        config.neutralColor,
        n => n.includes('neutral'),
        coreColl,
        config.paletteOverrides?.neutral,
      );
      totalUpdated += updated;
    } catch (e: unknown) {
      errors.push('Neutral color: ' + (e instanceof Error ? e.message : String(e)));
    }
    }

    // 4. Functional colors — each maps to its own keyword in .core
    if (coreColl && config.functionalColors) {
    const slots: Array<[string | undefined, string]> = [
      [config.functionalColors.success, 'success'],
      [config.functionalColors.warning, 'warning'],
      [config.functionalColors.danger,  'danger'],
      [config.functionalColors.info,    'info'],
    ];
    const funcLane = (kw: string): Record<string, string> | undefined =>
      config.paletteOverrides?.[`functional-${kw}` as WizardPaletteLaneKey];

    for (const [hex, keyword] of slots) {
      if (!hex) continue;
      try {
        const { updated } = await writePaletteToCore(
          hex,
          n => n.includes(keyword),
          coreColl,
          funcLane(keyword),
        );
        totalUpdated += updated;
      } catch (e: unknown) {
        errors.push(`Functional "${keyword}": ` + (e instanceof Error ? e.message : String(e)));
      }
    }
    }
  }

  // 5. Font family name(s) → `font-family/primary` and optional `font-family/secondary` in `.core`
  if (coreColl && config.fontFamily?.trim()) {
    try {
      totalUpdated += await writeFontFamilySlot(coreColl, config.fontFamily, 'primary');
    } catch (e: unknown) {
      errors.push('Font family: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  if (coreColl && config.fontFamilySecondary?.trim()) {
    try {
      totalUpdated += await writeFontFamilySlot(coreColl, config.fontFamilySecondary, 'secondary');
    } catch (e: unknown) {
      errors.push('Second font family: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return {
    success: errors.length === 0,
    totalUpdated,
    errors,
    palette: primaryPaletteResult
      ? { sourceShade: primaryPaletteResult.sourceShade, shadeCount: Object.keys(primaryPaletteResult.palette).length }
      : null,
    config: {
      primaryColor: config.primaryColor,
      neutralColor: config.neutralColor,
      fontFamily: config.fontFamily,
      fontFamilySecondary: config.fontFamilySecondary,
      density: config.density,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Architecture detection (file-level)
// ─────────────────────────────────────────────────────────────────────────────

export async function detectFileArchitecture(): Promise<{
  mode: string; currentFile: string; fileKey: string;
  pages: Array<{ name: string; id: string; type: string }>;
  collections: Array<{ name: string; id: string; variableCount: number; modes: string[]; isRemote: boolean }>;
  remoteLibraries: Array<{ name: string; libraryName: string }>;
}> {
  const pages = figma.root.children.map(page => ({ name: page.name, id: page.id, type: page.type }));
  const pageNames = pages.map(p => p.name.toLowerCase());

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionData = collections.map(c => ({
    name: c.name,
    id: c.id,
    variableCount: c.variableIds.length,
    modes: c.modes.map(m => m.name),
    isRemote: (c as any).remote || false,
  }));

  const remoteCollections = collections.filter(c => (c as any).remote);
  const remoteLibraries = remoteCollections.map(c => ({
    name: c.name,
    libraryName: (c as any).libraryName || 'Unknown',
  }));

  let mode = 'SEPARATE_FILES';
  if (remoteCollections.length > 0) {
    mode = 'TEAM_LIBRARY';
  } else if (
    pageNames.some(n => n.includes('foundation')) &&
    pageNames.some(n => n.includes('web')) &&
    pageNames.some(n => n.includes('mobile'))
  ) {
    mode = 'SAME_FILE';
  }

  return {
    mode,
    currentFile: figma.root.name,
    fileKey: figma.fileKey || 'local-file',
    pages,
    collections: collectionData,
    remoteLibraries,
  };
}
