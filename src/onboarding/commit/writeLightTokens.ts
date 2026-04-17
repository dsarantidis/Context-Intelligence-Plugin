/**
 * Step 09 commit — Op 2: Write Light-mode semantic tokens.
 *
 * For each of the 10 semantic slots (accent, on-accent, …), create a scheme
 * variable in `Core Brand Scheme` that aliases the matching `.core` brand shade
 * for that slot's assigned hex.
 *
 * Scheme collection gets 4 modes (Neutral Light / Dark, Inverted Light / Dark).
 * Light Tokens populate Neutral Light AND the mirrored Inverted Dark at the
 * same time — the mirror relationship is part of what Step 09 validation
 * verifies later.
 */

import type { OnboardingDraft, SemanticSlotId, PaletteEntry } from '../state/types';
import { SEMANTIC_SLOT_IDS } from '../state/types';
import {
  CORE_COLLECTION_NAME,
  SCHEME_COLLECTION_NAME,
  SCHEME_MODE_NEUTRAL_LIGHT,
  SCHEME_MODE_NEUTRAL_DARK,
  SCHEME_MODE_INVERTED_LIGHT,
  SCHEME_MODE_INVERTED_DARK,
  getOrCreateCollection,
  ensureMode,
  findVariableByName,
  upsertVariable,
  aliasTo,
} from './shared';

export async function writeLightTokens(draft: OnboardingDraft): Promise<number> {
  const core = await getOrCreateCollection(CORE_COLLECTION_NAME);
  const scheme = await getOrCreateCollection(SCHEME_COLLECTION_NAME, SCHEME_MODE_NEUTRAL_LIGHT);

  // Ensure all 4 modes exist up front.
  const neutralLightId  = ensureMode(scheme, SCHEME_MODE_NEUTRAL_LIGHT);
  const neutralDarkId   = ensureMode(scheme, SCHEME_MODE_NEUTRAL_DARK);
  const invertedLightId = ensureMode(scheme, SCHEME_MODE_INVERTED_LIGHT);
  const invertedDarkId  = ensureMode(scheme, SCHEME_MODE_INVERTED_DARK);

  let count = 0;

  for (const slot of SEMANTIC_SLOT_IDS) {
    const hex = draft.semanticLight[slot];
    if (!hex) continue;

    const coreVar = await findCoreVariableForHex(core, hex, draft.palette.primary);
    if (!coreVar) continue;

    const schemeVarName = `color/${slot}`;
    const { variable } = await upsertVariable(scheme, schemeVarName, 'COLOR');
    variable.setValueForMode(neutralLightId, aliasTo(coreVar));
    // Inverted Dark mirrors Neutral Light (same semantic surface, inverted context).
    variable.setValueForMode(invertedDarkId, aliasTo(coreVar));

    // Seed the dark modes with the same alias so we never leave a mode empty.
    // writeDarkTokens overwrites Neutral Dark + Inverted Light after this.
    if (variable.valuesByMode[neutralDarkId] === undefined) {
      variable.setValueForMode(neutralDarkId, aliasTo(coreVar));
    }
    if (variable.valuesByMode[invertedLightId] === undefined) {
      variable.setValueForMode(invertedLightId, aliasTo(coreVar));
    }
    count++;
  }

  return count;
}

// ── Helper: find the .core variable whose hex matches a semantic assignment ─

async function findCoreVariableForHex(
  core: VariableCollection,
  hex: string,
  palette: PaletteEntry[] | null,
): Promise<Variable | null> {
  const want = hex.trim().toUpperCase();

  // Prefer direct palette lookup (faster + deterministic).
  if (palette) {
    for (const entry of palette) {
      if (entry.hex.toUpperCase() === want) {
        return findVariableByName(core, `brand/${entry.shadeName}`);
      }
    }
  }

  // Fallback — scan .core for any COLOR variable with a matching value.
  const modeId = core.modes[0]?.modeId;
  if (!modeId) return null;
  for (const id of core.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (!v || v.resolvedType !== 'COLOR') continue;
    const val = v.valuesByMode[modeId] as RGB | undefined;
    if (!val || typeof val !== 'object' || !('r' in val)) continue;
    const vh = rgbToHex(val).toUpperCase();
    if (vh === want) return v;
  }
  return null;
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return '#' + to(rgb.r) + to(rgb.g) + to(rgb.b);
}

// Satisfy the fact that SemanticSlotId is referenced
export type { SemanticSlotId };
