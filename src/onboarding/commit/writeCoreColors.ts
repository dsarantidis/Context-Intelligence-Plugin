/**
 * Step 09 commit — Op 1: Write .core color + shade primitives.
 *
 * Creates/updates raw COLOR variables in `.core` for:
 *   - Primary brand palette (10 stops → `brand/50` … `brand/900`)
 *   - Optional secondary palette (`brand-second/50` … `brand-second/900`)
 *   - Extra accent shades entered in Step 04 (`accent-shade/<hex>`)
 *   - Neutral shades (`neutral/<hex>`)
 *   - Functional solid colors (`functional/destructive/500`, etc.)
 *
 * Returns the number of variables created/updated (for UI progress).
 */

import type { OnboardingDraft, PaletteEntry } from '../state/types';
import {
  CORE_COLLECTION_NAME,
  getOrCreateCollection,
  upsertVariable,
  setColorAllModes,
} from './shared';

export async function writeCoreColors(draft: OnboardingDraft): Promise<number> {
  const core = await getOrCreateCollection(CORE_COLLECTION_NAME);
  let count = 0;

  // ── Primary brand palette ──────────────────────────────────────────────────
  if (draft.palette.primary) {
    count += await writePalette(core, 'brand', draft.palette.primary);
  }

  // ── Secondary palette ──────────────────────────────────────────────────────
  if (draft.palette.secondary) {
    count += await writePalette(core, 'brand-second', draft.palette.secondary);
  }

  // ── Accent & neutral extra shades (user-entered hexes) ─────────────────────
  const accentShades = uniqueHexes(draft.shades.accentShades);
  for (let i = 0; i < accentShades.length; i++) {
    const hex = accentShades[i];
    const name = `accent-shade/${i + 1}`;
    const { variable } = await upsertVariable(core, name, 'COLOR');
    await setColorAllModes(variable, core, hex);
    count++;
  }
  const neutralShades = uniqueHexes(draft.shades.neutralShades);
  for (let i = 0; i < neutralShades.length; i++) {
    const hex = neutralShades[i];
    const name = `neutral/${i + 1}`;
    const { variable } = await upsertVariable(core, name, 'COLOR');
    await setColorAllModes(variable, core, hex);
    count++;
  }

  // ── Functional colors ──────────────────────────────────────────────────────
  const fn = draft.shades.functional;
  const slots: Array<[string, string | undefined]> = [
    ['functional/destructive/500', fn.destructive],
    ['functional/warning/500',     fn.warning],
    ['functional/success/500',     fn.success],
    ['functional/info/500',        fn.info],
  ];
  for (const [name, hex] of slots) {
    if (!hex) continue;
    const { variable } = await upsertVariable(core, name, 'COLOR');
    await setColorAllModes(variable, core, hex);
    count++;
  }

  return count;
}

async function writePalette(
  core: VariableCollection,
  prefix: string,
  palette: PaletteEntry[],
): Promise<number> {
  let count = 0;
  for (const entry of palette) {
    const name = `${prefix}/${entry.shadeName}`;
    const { variable } = await upsertVariable(core, name, 'COLOR');
    await setColorAllModes(variable, core, entry.hex);
    count++;
  }
  return count;
}

function uniqueHexes(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const h = String(raw).trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(h)) continue;
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}
