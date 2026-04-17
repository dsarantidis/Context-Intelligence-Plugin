/**
 * Perceptual color math used by the Foundations onboarding wizard.
 *
 * All palette work is in OKLCH — HSL is intentionally not used for any
 * perceptual operation. WCAG contrast is computed with sRGB relative
 * luminance (for 4.5:1 body-text checks in Step 03).
 *
 * References:
 *   - Björn Ottosson, "A perceptual color space for image processing" (OKLab).
 *   - W3C WCAG 2.1 §1.4.3.
 */

import type { PaletteEntry, AutoPlaceResult } from '../state/types';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Target lightness (OKLCH L channel, 0..1) for each of the 10 shade slots.
 * Anchors chosen so 500 = mid-L (~0.55), 50 = near-white, 900 = near-black.
 */
export const SHADE_NAMES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
export type ShadeName = typeof SHADE_NAMES[number];

export const SHADE_L_TARGETS: Record<ShadeName, number> = {
  '50':  0.97,
  '100': 0.93,
  '200': 0.86,
  '300': 0.78,
  '400': 0.68,
  '500': 0.58,
  '600': 0.48,
  '700': 0.38,
  '800': 0.28,
  '900': 0.18,
};

// ── Hex ⇄ sRGB ───────────────────────────────────────────────────────────────

export function normalizeHex(input: string): string | null {
  const s = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return (
      '#' +
      s
        .split('')
        .map(c => c + c)
        .join('')
        .toUpperCase()
    );
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s.toUpperCase();
  return null;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Invalid hex: ${hex}`);
  return {
    r: parseInt(n.slice(1, 3), 16) / 255,
    g: parseInt(n.slice(3, 5), 16) / 255,
    b: parseInt(n.slice(5, 7), 16) / 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return ('#' + to(r) + to(g) + to(b)).toUpperCase();
}

// ── sRGB ⇄ linear RGB ────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ── linear RGB ⇄ OKLab ⇄ OKLCH ───────────────────────────────────────────────

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export function hexToOklch(hex: string): [L: number, C: number, H: number] {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const [L, a, bb] = linearRgbToOklab(lr, lg, lb);
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

export function oklchToHex(L: number, C: number, H: number): string {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  // Gamut-map: reduce chroma until we land inside sRGB [0,1].
  let lr: number, lg: number, lb: number;
  let chroma = C;
  for (let i = 0; i < 24; i++) {
    const aa = chroma * Math.cos(rad);
    const bb = chroma * Math.sin(rad);
    const v = oklabToLinearRgb(L, aa, bb);
    lr = v[0]; lg = v[1]; lb = v[2];
    if (
      lr >= -0.0005 && lr <= 1.0005 &&
      lg >= -0.0005 && lg <= 1.0005 &&
      lb >= -0.0005 && lb <= 1.0005
    ) break;
    chroma *= 0.92;
  }
  const sr = linearToSrgb(Math.max(0, Math.min(1, lr!)));
  const sg = linearToSrgb(Math.max(0, Math.min(1, lg!)));
  const sb = linearToSrgb(Math.max(0, Math.min(1, lb!)));
  return rgbToHex(sr, sg, sb);
}

// ── WCAG contrast ────────────────────────────────────────────────────────────

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(hex1: string, hex2: string): number {
  const a = relativeLuminance(hex1);
  const b = relativeLuminance(hex2);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

export function isDark(hex: string): boolean {
  const [L] = hexToOklch(hex);
  return L < 0.55;
}

// ── Shade placement ──────────────────────────────────────────────────────────

/** Returns the shade name (e.g. "400") whose L target is closest to the input's L. */
export function closestShadeForHex(hex: string): ShadeName {
  const [L] = hexToOklch(hex);
  let best: ShadeName = '500';
  let bestDelta = Infinity;
  for (const name of SHADE_NAMES) {
    const delta = Math.abs(SHADE_L_TARGETS[name] - L);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = name;
    }
  }
  return best;
}

/**
 * Generate a full 10-stop OKLCH-based scale from a single seed hex.
 * Hue and chroma are preserved from the seed (chroma damped at extremes).
 */
export function generateScale(baseHex: string): PaletteEntry[] {
  const [, C, H] = hexToOklch(baseHex);
  const out: PaletteEntry[] = [];
  for (let i = 0; i < SHADE_NAMES.length; i++) {
    const name = SHADE_NAMES[i];
    const L = SHADE_L_TARGETS[name];
    // Damp chroma near the ends — very light / very dark tones have less usable chroma.
    const damp = L > 0.9 ? 0.35 : L < 0.25 ? 0.65 : 1;
    const hex = oklchToHex(L, C * damp, H);
    out.push({
      index: i,
      shadeName: name,
      hex,
      source: 'generated',
    });
  }
  return out;
}

// ── splitGroups — for Scenario C ─────────────────────────────────────────────

/**
 * Split input hexes into a light band (L ≥ 0.55) and a dark band (L < 0.55).
 * Entries carry their closest shade name for downstream placement.
 */
export function splitGroups(hexes: string[]): {
  light: Array<{ hex: string; shadeName: ShadeName; L: number }>;
  dark: Array<{ hex: string; shadeName: ShadeName; L: number }>;
} {
  const light: Array<{ hex: string; shadeName: ShadeName; L: number }> = [];
  const dark: Array<{ hex: string; shadeName: ShadeName; L: number }> = [];
  for (const raw of hexes) {
    const norm = normalizeHex(raw);
    if (!norm) continue;
    const [L] = hexToOklch(norm);
    const entry = { hex: norm, shadeName: closestShadeForHex(norm), L };
    if (L >= 0.55) light.push(entry);
    else dark.push(entry);
  }
  return { light, dark };
}

// ── autoPlace — the full Step 01 algorithm ───────────────────────────────────

/**
 * Place the user's input hexes into 10 shade slots, generating missing stops
 * and pushing/falling-back when two inputs collide on the same slot.
 *
 * Scenario coverage:
 *  A — 1 seed: generate full scale from it.
 *  B — 2..10 seeds, well-distributed: keep inputs, fill gaps with generated stops.
 *  C — many inputs in the same band (light or dark): try to keep them all,
 *      pushing colliders to the nearest unoccupied slot on the same side.
 */
export function autoPlace(hexes: string[]): AutoPlaceResult {
  const cleaned: string[] = [];
  for (const h of hexes) {
    const n = normalizeHex(h);
    if (n && cleaned.indexOf(n) === -1) cleaned.push(n);
  }

  if (cleaned.length === 0) {
    return {
      slots: [],
      log: [{ action: 'unplaced', hex: '', reason: 'no valid hex input' }],
      unplaced: [],
    };
  }

  // Scenario A: 1 seed → generate full scale.
  if (cleaned.length === 1) {
    const slots = generateScale(cleaned[0]);
    const seedShade = closestShadeForHex(cleaned[0]);
    // Force the seed's exact hex into its natural slot (don't let gamut-mapping drift it).
    for (const s of slots) {
      if (s.shadeName === seedShade) {
        s.hex = cleaned[0];
        s.source = 'input';
      }
    }
    return {
      slots,
      log: [
        { action: 'kept', hex: cleaned[0], shadeName: seedShade, reason: 'seed' },
        ...slots.filter(s => s.shadeName !== seedShade).map(s => ({
          action: 'filled' as const,
          hex: s.hex,
          shadeName: s.shadeName,
          reason: 'generated from seed',
        })),
      ],
      unplaced: [],
    };
  }

  // Scenario B/C: multiple seeds.
  // Step 1 — rank inputs by closest shade and assign, resolving collisions.
  type Candidate = { hex: string; shadeName: ShadeName; L: number };
  const candidates: Candidate[] = cleaned.map(hex => {
    const [L] = hexToOklch(hex);
    return { hex, shadeName: closestShadeForHex(hex), L };
  });

  // Sort by L descending (lightest first) so "pushing darker" feels intuitive.
  candidates.sort((a, b) => b.L - a.L);

  const placed: Record<string, Candidate> = {};
  const log: AutoPlaceResult['log'] = [];
  const unplaced: string[] = [];

  for (const c of candidates) {
    if (!placed[c.shadeName]) {
      placed[c.shadeName] = c;
      log.push({ action: 'kept', hex: c.hex, shadeName: c.shadeName });
      continue;
    }
    // Collision — pick the incumbent with L closer to the target, push the other.
    const incumbent = placed[c.shadeName];
    const target = SHADE_L_TARGETS[c.shadeName];
    const cDelta = Math.abs(c.L - target);
    const iDelta = Math.abs(incumbent.L - target);
    const loser = cDelta < iDelta ? incumbent : c;
    const winner = cDelta < iDelta ? c : incumbent;
    placed[c.shadeName] = winner;

    // Find nearest unoccupied slot (prefer same side).
    const idx = SHADE_NAMES.indexOf(c.shadeName);
    const pushToward: ShadeName | null = pickNextOpenSlot(idx, loser.L, placed);
    if (pushToward) {
      placed[pushToward] = loser;
      log.push({
        action: 'pushed',
        hex: loser.hex,
        shadeName: pushToward,
        fromShadeName: c.shadeName,
        reason: `collision at ${c.shadeName}`,
      });
    } else {
      unplaced.push(loser.hex);
      log.push({
        action: 'unplaced',
        hex: loser.hex,
        reason: `no open slot near ${c.shadeName}`,
      });
    }
  }

  // Step 2 — fill remaining slots using the best reference to generate from.
  const reference = pickReferenceHex(placed);
  const generated = generateScale(reference);
  const finalSlots: PaletteEntry[] = [];
  for (let i = 0; i < SHADE_NAMES.length; i++) {
    const name = SHADE_NAMES[i];
    const c = placed[name];
    if (c) {
      finalSlots.push({
        index: i,
        shadeName: name,
        hex: c.hex,
        source: log.find(l => l.hex === c.hex && l.action === 'pushed') ? 'pushed' : 'input',
      });
    } else {
      const gen = generated[i];
      finalSlots.push({
        index: i,
        shadeName: name,
        hex: gen.hex,
        source: 'filled',
      });
      log.push({ action: 'filled', hex: gen.hex, shadeName: name, reason: 'auto-filled' });
    }
  }

  return { slots: finalSlots, log, unplaced };
}

function pickNextOpenSlot(
  startIdx: number,
  loserL: number,
  placed: Record<string, unknown>,
): ShadeName | null {
  // Walk outward from startIdx; prefer the direction that matches loserL vs target.
  const target = SHADE_L_TARGETS[SHADE_NAMES[startIdx]];
  const tryOrder: number[] = [];
  const lighter = loserL > target; // push toward lighter (lower idx) side
  for (let step = 1; step < SHADE_NAMES.length; step++) {
    const first = lighter ? startIdx - step : startIdx + step;
    const second = lighter ? startIdx + step : startIdx - step;
    if (first >= 0 && first < SHADE_NAMES.length) tryOrder.push(first);
    if (second >= 0 && second < SHADE_NAMES.length) tryOrder.push(second);
  }
  for (const i of tryOrder) {
    const name = SHADE_NAMES[i];
    if (!placed[name]) return name;
  }
  return null;
}

function pickReferenceHex(placed: Record<string, { hex: string }>): string {
  // Prefer 500, then the closest to 500 by index.
  const pref: ShadeName[] = ['500', '400', '600', '300', '700', '200', '800', '100', '900', '50'];
  for (const n of pref) {
    if (placed[n]) return placed[n].hex;
  }
  // Fallback — shouldn't happen.
  return '#888888';
}
