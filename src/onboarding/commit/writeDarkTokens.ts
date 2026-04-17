/**
 * Step 09 commit — Op 3: Write Dark-mode semantic tokens + Inverted mirror.
 *
 * Completes the scheme: each slot's dark hex goes into Neutral Dark AND
 * into the mirrored Inverted Light. (writeLightTokens already placed the
 * light hex into Neutral Light and Inverted Dark.)
 */

import type { OnboardingDraft, DarkSemanticMap, PaletteEntry } from '../state/types';
import { SEMANTIC_SLOT_IDS } from '../state/types';
import {
  CORE_COLLECTION_NAME,
  SCHEME_COLLECTION_NAME,
  SCHEME_MODE_NEUTRAL_DARK,
  SCHEME_MODE_INVERTED_LIGHT,
  getOrCreateCollection,
  ensureMode,
  findVariableByName,
  upsertVariable,
  aliasTo,
  setColorAllModes,
} from './shared';

export async function writeDarkTokens(draft: OnboardingDraft): Promise<number> {
  const core = await getOrCreateCollection(CORE_COLLECTION_NAME);
  const scheme = await getOrCreateCollection(SCHEME_COLLECTION_NAME);

  const neutralDarkId   = ensureMode(scheme, SCHEME_MODE_NEUTRAL_DARK);
  const invertedLightId = ensureMode(scheme, SCHEME_MODE_INVERTED_LIGHT);

  let count = 0;

  for (const slot of SEMANTIC_SLOT_IDS) {
    const cell = draft.semanticDark[slot];
    if (!cell) continue;

    const coreVar = await findOrCreateCoreForDarkHex(core, cell.hex, draft.palette.primary);
    if (!coreVar) continue;

    const schemeVarName = `color/${slot}`;
    const { variable } = await upsertVariable(scheme, schemeVarName, 'COLOR');
    variable.setValueForMode(neutralDarkId, aliasTo(coreVar));
    // Inverted Light mirrors Neutral Dark.
    variable.setValueForMode(invertedLightId, aliasTo(coreVar));
    count++;
  }

  return count;
}

/**
 * Dark cells often reuse palette shades but may be customised. If the hex is a
 * known palette stop, alias to it. If it's a custom hex, create/reuse a
 * `dark-custom/<hex>` .core variable holding it as a primitive.
 */
async function findOrCreateCoreForDarkHex(
  core: VariableCollection,
  hex: string,
  palette: PaletteEntry[] | null,
): Promise<Variable | null> {
  const want = hex.trim().toUpperCase();
  if (palette) {
    for (const entry of palette) {
      if (entry.hex.toUpperCase() === want) {
        return findVariableByName(core, `brand/${entry.shadeName}`);
      }
    }
  }
  const name = 'dark-custom/' + want.replace(/^#/, '').toLowerCase();
  const { variable } = await upsertVariable(core, name, 'COLOR');
  await setColorAllModes(variable, core, want);
  return variable;
}

export type { DarkSemanticMap };
