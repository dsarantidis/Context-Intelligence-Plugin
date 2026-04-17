/**
 * Step 09 commit — Op 4: Write typography primitives + aliases.
 *
 * `.core` holds:
 *   - `font-family/primary`, optional `font-family/secondary` (STRING)
 *   - `font-size/<slot>` (FLOAT, px)
 *   - `font-weight/<slot>` (FLOAT)
 *   - `line-height/<slot>` (FLOAT, multiplier)
 *
 * Core Brand Scheme holds aliases that propagate to every mode so typography
 * is scheme-invariant (SF-01 in foundation-rules).
 */

import type { OnboardingDraft } from '../state/types';
import { TYPE_SCALE_SLOT_IDS } from '../state/types';
import {
  CORE_COLLECTION_NAME,
  SCHEME_COLLECTION_NAME,
  getOrCreateCollection,
  upsertVariable,
  setFloatAllModes,
  setStringAllModes,
  aliasTo,
} from './shared';

export async function writeTypography(draft: OnboardingDraft): Promise<number> {
  const core = await getOrCreateCollection(CORE_COLLECTION_NAME);
  const scheme = await getOrCreateCollection(SCHEME_COLLECTION_NAME);
  let count = 0;

  // ── Font families ──────────────────────────────────────────────────────────
  if (draft.typography.primary.family) {
    const { variable } = await upsertVariable(core, 'font-family/primary', 'STRING');
    await setStringAllModes(variable, core, draft.typography.primary.family);
    count++;
  }
  if (draft.typography.secondary?.family) {
    const { variable } = await upsertVariable(core, 'font-family/secondary', 'STRING');
    await setStringAllModes(variable, core, draft.typography.secondary.family);
    count++;
  }

  // ── Scale primitives + scheme aliases ──────────────────────────────────────
  for (const slot of TYPE_SCALE_SLOT_IDS) {
    const entry = draft.typography.scale[slot];
    if (!entry) continue;

    const sizeCore   = await upsertVariable(core, `font-size/${slot}`,   'FLOAT');
    const weightCore = await upsertVariable(core, `font-weight/${slot}`, 'FLOAT');
    const lhCore     = await upsertVariable(core, `line-height/${slot}`, 'FLOAT');
    await setFloatAllModes(sizeCore.variable,   core, entry.size);
    await setFloatAllModes(weightCore.variable, core, entry.weight);
    await setFloatAllModes(lhCore.variable,     core, entry.lineHeight);
    count += 3;

    // Scheme aliases — every mode points at the same .core primitive.
    const sizeScheme   = await upsertVariable(scheme, `typography/${slot}/size`,   'FLOAT');
    const weightScheme = await upsertVariable(scheme, `typography/${slot}/weight`, 'FLOAT');
    const lhScheme     = await upsertVariable(scheme, `typography/${slot}/line-height`, 'FLOAT');
    for (const mode of scheme.modes) {
      sizeScheme.variable.setValueForMode(mode.modeId, aliasTo(sizeCore.variable));
      weightScheme.variable.setValueForMode(mode.modeId, aliasTo(weightCore.variable));
      lhScheme.variable.setValueForMode(mode.modeId, aliasTo(lhCore.variable));
    }
    count += 3;
  }

  // Propagation sanity log — spec requires count divisible by 9 in full RADD
  // 3.0; here we have 4 scheme modes so we just note the actual modulus.
  const perSlotAliases = scheme.modes.length * 3;
  if (perSlotAliases % 9 !== 0) {
    console.log(
      `[onboarding] typography propagation: ${perSlotAliases} aliases/slot (modes=${scheme.modes.length}) — not divisible by 9 (RADD 3.0 target)`,
    );
  }

  return count;
}
