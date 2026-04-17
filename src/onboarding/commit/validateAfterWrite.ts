/**
 * Step 09 commit — Op 5: Post-write validation.
 *
 * Runs the shared foundation-rules checker against the just-written scheme.
 * Detects:
 *   - Broken aliases (variable A points at variable B that no longer exists)
 *   - Neutral ↔ Inverted mirror mismatch (SF-02)
 *   - Typography drift across scheme modes (SF-01)
 *   - Any raw value in `foundation` layer (SH-01) — if foundation exists
 */

import type { CommitValidationResult } from '../state/types';
import {
  runFoundationRules,
  type FigmaVarSlim,
  type FigmaCollectionSlim,
} from '../../foundation-rules';
import { detectRADDSystem } from '../../system-detector';

export async function validateAfterWrite(): Promise<CommitValidationResult> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const allVars = await figma.variables.getLocalVariablesAsync();

  // ── Broken alias sweep ──────────────────────────────────────────────────────
  const idSet = new Set(allVars.map(v => v.id));
  let brokenAliases = 0;
  for (const v of allVars) {
    for (const modeId of Object.keys(v.valuesByMode)) {
      const raw = v.valuesByMode[modeId] as unknown;
      if (
        raw &&
        typeof raw === 'object' &&
        (raw as { type?: string }).type === 'VARIABLE_ALIAS' &&
        !idSet.has((raw as { id: string }).id)
      ) {
        brokenAliases++;
      }
    }
  }

  // ── Foundation-rules checker (uses slim shapes) ─────────────────────────────
  const slimCollections: FigmaCollectionSlim[] = collections.map(c => ({
    id: c.id,
    name: c.name,
    modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    variableIds: [...c.variableIds],
  }));
  const slimVars: FigmaVarSlim[] = allVars.map(v => ({
    id: v.id,
    name: v.name,
    variableCollectionId: v.variableCollectionId,
    resolvedType: v.resolvedType,
    valuesByMode: { ...(v.valuesByMode as Record<string, unknown>) },
  }));

  const system = detectRADDSystem(collections.map(c => c.name));
  // If this is a fresh setup, the file may not match a canonical RADD
  // signature — still worth running the cross-mode + mirror checks.
  const version = system.version === 'unknown' ? 'radd-3.0' : system.version;

  const violations = runFoundationRules({
    version,
    vars: slimVars,
    collections: slimCollections,
  });

  // Filter to the rules that are meaningful here — SF-01 and SF-02 specifically.
  const relevant = violations.filter(v =>
    v.ruleId === 'RULE-SH-01' ||
    v.sfId === 'SF-01' ||
    v.sfId === 'SF-02',
  );

  // Mirror check explicitly tracked.
  const mirrorOk = !relevant.some(v => v.sfId === 'SF-02');

  return {
    ok: brokenAliases === 0 && relevant.length === 0,
    brokenAliases,
    mirrorOk,
    violations: relevant.map(v => ({
      ruleId: v.ruleId,
      severity: v.severity,
      message: v.message,
    })),
  };
}
