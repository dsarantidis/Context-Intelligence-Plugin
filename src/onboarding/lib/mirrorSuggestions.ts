/**
 * Dark-mode mirror suggestions for Step 06.
 *
 * Maps each of the 10 semantic slots to an index in the primary palette that
 * typically produces readable dark-mode equivalents. Users can override any
 * individual cell with their own hex.
 */

import type {
  PaletteEntry,
  SemanticSlotId,
  DarkSemanticMap,
  DarkCell,
} from '../state/types';
import { SEMANTIC_SLOT_IDS } from '../state/types';

/** Which palette index each slot should borrow from when building dark mode. */
export const MIRROR_PALETTE_INDEX: Record<SemanticSlotId, number> = {
  'accent':        3,  // lighter accent reads on dark bg
  'on-accent':     9,  // stays dark — sits on the lighter accent
  'accent-text':   2,  // light tone for body accent
  'link':          3,
  'accent-sec':    1,  // near-white for tonal pill bg
  'stroke':        7,
  'stroke-subtle': 8,
  'text':          0,  // near-white body text
  'text-rec':      2,
  'modal':         9,  // dark modal veil
};

export const MIRROR_NOTES: Record<SemanticSlotId, string> = {
  'accent':        'Slightly lighter for dark bg — stays vibrant',
  'on-accent':     'Stays dark — sits on the lighter accent',
  'accent-text':   'Lighter tone for readable accent copy',
  'link':          'Lighter link color for dark surfaces',
  'accent-sec':    'Near-white base for low-opacity tonal chips',
  'stroke':        'Dimmer border — visible without glaring',
  'stroke-subtle': 'Barely-there divider tone',
  'text':          'Near-white body text',
  'text-rec':      'Muted caption tone',
  'modal':         'Deep scrim tint behind modals',
};

/**
 * Build a full suggested dark-mode map from the primary (light) palette.
 * All cells return with `status: 'suggested'`.
 */
export function generateMirrorSuggestions(
  palette: PaletteEntry[] | null | undefined,
): DarkSemanticMap {
  const out: DarkSemanticMap = {};
  if (!palette || palette.length === 0) return out;

  for (const slot of SEMANTIC_SLOT_IDS) {
    const idx = MIRROR_PALETTE_INDEX[slot];
    const entry = palette[idx] ?? palette[palette.length - 1];
    if (!entry) continue;
    const cell: DarkCell = {
      hex: entry.hex,
      status: 'suggested',
      note: MIRROR_NOTES[slot],
    };
    out[slot] = cell;
  }
  return out;
}

/**
 * Merge fresh suggestions with an existing draft — preserves any cell the user
 * has already confirmed or customised.
 */
export function mergeSuggestions(
  palette: PaletteEntry[] | null | undefined,
  existing: DarkSemanticMap,
): DarkSemanticMap {
  const fresh = generateMirrorSuggestions(palette);
  const out: DarkSemanticMap = { ...fresh };
  for (const slot of SEMANTIC_SLOT_IDS) {
    const prev = existing[slot];
    if (prev && prev.status !== 'suggested') out[slot] = prev;
  }
  return out;
}
