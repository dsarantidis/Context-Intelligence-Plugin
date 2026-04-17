/**
 * Foundation Architecture Rule Checker
 *
 * Implements the validation rules and silent failure pattern detectors
 * defined in docs/DS_FOUNDATIONS_MEMORY.md.
 *
 * All functions are pure — they receive pre-loaded data and return
 * RuleViolation arrays. No Figma API calls inside this module.
 */

import type { RADDVersion } from './system-detector';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FigmaVarSlim {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: string;
  /** Only the modes we need — key is modeId, value is raw mode value */
  valuesByMode: Record<string, unknown>;
}

export interface FigmaCollectionSlim {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  variableIds: string[];
}

export interface RuleViolation {
  ruleId: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestion: string;
  variableId: string;
  variableName: string;
  collectionName: string;
  /** Silent failure pattern ID, if applicable */
  sfId?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type VarMap  = Record<string, FigmaVarSlim>;
type CollMap = Record<string, string>; // collectionId → collectionName

function aliasTargetCollectionName(
  variable: FigmaVarSlim,
  varMap: VarMap,
  collMap: CollMap,
  modeId?: string,
): string | null {
  const mid = modeId ?? Object.keys(variable.valuesByMode)[0];
  if (!mid) return null;
  const val = variable.valuesByMode[mid] as any;
  if (!val || typeof val !== 'object' || val.type !== 'VARIABLE_ALIAS') return null;
  const target = varMap[val.id];
  if (!target) return null;
  return collMap[target.variableCollectionId] ?? null;
}

/** Returns the alias target variable ID for a given mode, or null if not an alias. */
function aliasTargetId(
  variable: FigmaVarSlim,
  modeId: string,
): string | null {
  const val = variable.valuesByMode[modeId] as any;
  if (!val || typeof val !== 'object' || val.type !== 'VARIABLE_ALIAS') return null;
  return val.id ?? null;
}

function varsInCollection(
  collName: string,
  vars: FigmaVarSlim[],
  collMap: CollMap,
): FigmaVarSlim[] {
  const collId = Object.entries(collMap).find(([, n]) => n === collName)?.[0];
  if (!collId) return [];
  return vars.filter(v => v.variableCollectionId === collId);
}

function collectionId(collName: string, collMap: CollMap): string | null {
  return Object.entries(collMap).find(([, n]) => n === collName)?.[0] ?? null;
}

// ── Shared alias-chain check ──────────────────────────────────────────────────

/**
 * For every variable in `sourceCollName`, verify that every mode value that is
 * an alias points only into one of `allowedTargetCollNames`.
 */
function checkAliasDestinations(
  sourceCollName: string,
  allowedTargetCollNames: string[],
  ruleId: string,
  vars: FigmaVarSlim[],
  varMap: VarMap,
  collMap: CollMap,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const sourceVars = varsInCollection(sourceCollName, vars, collMap);
  const allowedSet = new Set(allowedTargetCollNames);

  for (const v of sourceVars) {
    for (const modeId of Object.keys(v.valuesByMode)) {
      const targetColl = aliasTargetCollectionName(v, varMap, collMap, modeId);
      if (targetColl === null) continue; // not an alias — ok
      if (!allowedSet.has(targetColl)) {
        violations.push({
          ruleId,
          severity: 'critical',
          message: `"${v.name}" (${sourceCollName}) aliases into "${targetColl}" — only ${allowedTargetCollNames.map(n => `"${n}"`).join(' or ')} allowed`,
          suggestion: `Re-wire this token so it aliases a variable in ${allowedTargetCollNames[0]}.`,
          variableId: v.id,
          variableName: v.name,
          collectionName: sourceCollName,
        });
        break; // one violation per variable is enough
      }
    }
  }
  return violations;
}

// ── RADD 2.0 Rules ────────────────────────────────────────────────────────────

function check_20_01(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  return checkAliasDestinations('foundation', ['.mode', '.breakpoint'], 'RULE-20-01', vars, varMap, collMap);
}

function check_20_02(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  return checkAliasDestinations('.scheme', ['_restricted'], 'RULE-20-02', vars, varMap, collMap);
}

function check_20_03(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  return checkAliasDestinations('_restricted', ['.mode', '.brand', '.secondary', '.white', '.black'], 'RULE-20-03', vars, varMap, collMap);
}

function check_20_04(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  return checkAliasDestinations('.mode', ['.scheme'], 'RULE-20-04', vars, varMap, collMap);
}

function check_20_05(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const base of ['.brand', '.secondary', '.white', '.black']) {
    violations.push(...checkAliasDestinations(base, ['.core'], 'RULE-20-05', vars, varMap, collMap));
  }
  return violations;
}

/**
 * RULE-20-09 / SF-07: Dimension tokens in .breakpoint must alias the SAME
 * .core token across all 5 breakpoint modes.
 */
function check_20_09_sf07(
  vars: FigmaVarSlim[],
  varMap: VarMap,
  collMap: CollMap,
  collections: FigmaCollectionSlim[],
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const bpColl = collections.find(c => c.name === '.breakpoint');
  if (!bpColl || bpColl.modes.length < 2) return violations;

  const bpVars = varsInCollection('.breakpoint', vars, collMap);

  for (const v of bpVars) {
    // Only check FLOAT (dimension) tokens — skip typography (they're allowed to differ)
    if (v.resolvedType !== 'FLOAT') continue;

    const targetIds = new Set<string>();
    for (const modeId of Object.keys(v.valuesByMode)) {
      const tid = aliasTargetId(v, modeId);
      if (tid) targetIds.add(tid);
    }

    if (targetIds.size > 1) {
      violations.push({
        ruleId: 'RULE-20-09',
        sfId: 'SF-07',
        severity: 'warning',
        message: `Dimension token "${v.name}" aliases different .core tokens across breakpoints — expected the same token in all modes`,
        suggestion: 'Set all breakpoint modes for this dimension token to alias the same .core primitive.',
        variableId: v.id,
        variableName: v.name,
        collectionName: '.breakpoint',
      });
    }
  }
  return violations;
}

// ── RADD 3.0 Rules ────────────────────────────────────────────────────────────

function check_30_01(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  return checkAliasDestinations('foundation', ['.mode', '.breakpoint'], 'RULE-30-01', vars, varMap, collMap);
}

function check_30_02(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  return checkAliasDestinations('.mode', ['Core Brand Scheme'], 'RULE-30-02', vars, varMap, collMap);
}

function check_30_03(vars: FigmaVarSlim[], varMap: VarMap, collMap: CollMap): RuleViolation[] {
  return checkAliasDestinations('Core Brand Scheme', ['.core', '.breakpoint'], 'RULE-30-03', vars, varMap, collMap);
}

/**
 * RULE-30-04 / SF-01: Typography variables in Core Brand Scheme must alias
 * the SAME .core (or .breakpoint) target across all 9 scheme modes.
 */
function check_30_04_sf01(
  vars: FigmaVarSlim[],
  varMap: VarMap,
  collMap: CollMap,
  collections: FigmaCollectionSlim[],
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const cbsColl = collections.find(c => c.name === 'Core Brand Scheme');
  if (!cbsColl || cbsColl.modes.length < 2) return violations;

  const cbsVars = varsInCollection('Core Brand Scheme', vars, collMap);
  // Typography variables live under the "typography/" prefix
  const typographyVars = cbsVars.filter(v => v.name.startsWith('typography/'));

  for (const v of typographyVars) {
    const targetIds = new Set<string>();
    for (const modeId of cbsColl.modes.map(m => m.modeId)) {
      const tid = aliasTargetId(v, modeId);
      if (tid) targetIds.add(tid);
    }

    if (targetIds.size > 1) {
      violations.push({
        ruleId: 'RULE-30-04',
        sfId: 'SF-01',
        severity: 'warning',
        message: `Typography token "${v.name}" has different alias targets across scheme modes — typography must be scheme-invariant`,
        suggestion: 'Ensure this typography token aliases the same source across all 9 scheme modes. Changed count must be divisible by 9.',
        variableId: v.id,
        variableName: v.name,
        collectionName: 'Core Brand Scheme',
      });
    }
  }
  return violations;
}

/**
 * RULE-30-07/08 / SF-02: Inverted scheme must be the exact mirror of Neutral.
 * Inverted Light Tokens must alias same .core values as Neutral Dark Tokens, and vice versa.
 */
function check_30_mirror_sf02(
  vars: FigmaVarSlim[],
  varMap: VarMap,
  collMap: CollMap,
  collections: FigmaCollectionSlim[],
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const cbsColl = collections.find(c => c.name === 'Core Brand Scheme');
  if (!cbsColl) return violations;

  const findMode = (namePart: string) =>
    cbsColl.modes.find(m => m.name.toLowerCase().includes(namePart.toLowerCase()));

  const neutralMode   = findMode('neutral');
  const invertedMode  = findMode('inverted');
  if (!neutralMode || !invertedMode) return violations;

  // We compare alias targets for colour vars (COLOR type) only
  const cbsVars = varsInCollection('Core Brand Scheme', vars, collMap).filter(
    v => v.resolvedType === 'COLOR' && !v.name.startsWith('typography/')
  );

  for (const v of cbsVars) {
    const neutralTarget  = aliasTargetId(v, neutralMode.modeId);
    const invertedTarget = aliasTargetId(v, invertedMode.modeId);
    // They should NOT be the same — inverted must mirror the opposite context.
    // This heuristic checks: if neutral and inverted point to the same target, the mirror is broken.
    if (neutralTarget && invertedTarget && neutralTarget === invertedTarget) {
      violations.push({
        ruleId: 'RULE-30-07',
        sfId: 'SF-02',
        severity: 'warning',
        message: `"${v.name}": Neutral and Inverted scheme alias the same source token — Inverted should mirror the opposite neutral context`,
        suggestion: 'Inverted Light Tokens must alias the same .core values as Neutral Dark Tokens, and vice versa.',
        variableId: v.id,
        variableName: v.name,
        collectionName: 'Core Brand Scheme',
      });
    }
  }
  return violations;
}

/**
 * RULE-30-09 / SF-04: Brand Segment collections with local variable overrides
 * must be flagged — parent edits won't propagate to them.
 */
function check_30_09_sf04(
  vars: FigmaVarSlim[],
  collMap: CollMap,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const segmentNames = Object.values(collMap).filter(n => /^Brand Segment \d+$/i.test(n));

  for (const segName of segmentNames) {
    const segVars = varsInCollection(segName, vars, collMap);
    // A Brand Segment var has a local override if it has any non-empty valuesByMode entries
    const overrides = segVars.filter(v => Object.keys(v.valuesByMode).length > 0);
    for (const v of overrides) {
      violations.push({
        ruleId: 'RULE-30-09',
        sfId: 'SF-04',
        severity: 'info',
        message: `"${v.name}" in "${segName}" has a local override — it won't inherit from Core Brand Scheme edits`,
        suggestion: 'Review whether this override is intentional before editing Core Brand Scheme.',
        variableId: v.id,
        variableName: v.name,
        collectionName: segName,
      });
    }
  }
  return violations;
}

// ── Shared Rules ──────────────────────────────────────────────────────────────

/**
 * RULE-SH-01: foundation must never contain locally-set raw values.
 * Every foundation var must be an alias — never a raw primitive.
 */
function check_sh01(vars: FigmaVarSlim[], collMap: CollMap): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const foundVars = varsInCollection('foundation', vars, collMap);

  for (const v of foundVars) {
    for (const modeId of Object.keys(v.valuesByMode)) {
      const val = v.valuesByMode[modeId] as any;
      const isAlias = val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS';
      if (!isAlias && val !== null && val !== undefined) {
        violations.push({
          ruleId: 'RULE-SH-01',
          severity: 'critical',
          message: `"${v.name}" in foundation has a raw value instead of an alias — foundation must be a pure pass-through layer`,
          suggestion: 'Replace the raw value with an alias to the correct .mode or .breakpoint token.',
          variableId: v.id,
          variableName: v.name,
          collectionName: 'foundation',
        });
        break;
      }
    }
  }
  return violations;
}

/**
 * RULE-20-09 (RADD 2.0) / RULE-30-dim (RADD 3.0) — shared dimension drift
 * check for .breakpoint. Reused by both version runners.
 */
function check_bp_dimension_drift(
  vars: FigmaVarSlim[],
  varMap: VarMap,
  collMap: CollMap,
  collections: FigmaCollectionSlim[],
  ruleId: string,
): RuleViolation[] {
  return check_20_09_sf07(vars, varMap, collMap, collections);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface FoundationRulesInput {
  version: RADDVersion;
  vars: FigmaVarSlim[];
  collections: FigmaCollectionSlim[];
}

export function runFoundationRules(input: FoundationRulesInput): RuleViolation[] {
  const { version, vars, collections } = input;

  // Build lookup maps
  const varMap: VarMap = Object.fromEntries(vars.map(v => [v.id, v]));
  const collMap: CollMap = Object.fromEntries(collections.map(c => [c.id, c.name]));

  const all: RuleViolation[] = [];

  // Shared rules — always run
  all.push(...check_sh01(vars, collMap));

  if (version === 'radd-2.0') {
    all.push(...check_20_01(vars, varMap, collMap));
    all.push(...check_20_02(vars, varMap, collMap));
    all.push(...check_20_03(vars, varMap, collMap));
    all.push(...check_20_04(vars, varMap, collMap));
    all.push(...check_20_05(vars, varMap, collMap));
    all.push(...check_bp_dimension_drift(vars, varMap, collMap, collections, 'RULE-20-09'));
  }

  if (version === 'radd-3.0') {
    all.push(...check_30_01(vars, varMap, collMap));
    all.push(...check_30_02(vars, varMap, collMap));
    all.push(...check_30_03(vars, varMap, collMap));
    all.push(...check_30_04_sf01(vars, varMap, collMap, collections));
    all.push(...check_30_mirror_sf02(vars, varMap, collMap, collections));
    all.push(...check_30_09_sf04(vars, collMap));
    all.push(...check_bp_dimension_drift(vars, varMap, collMap, collections, 'RULE-30-dim'));
  }

  return all;
}
