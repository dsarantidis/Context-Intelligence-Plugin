/**
 * Shared helpers for Step 09 commit write operations.
 *
 * All helpers run in the Figma plugin worker — they create or update
 * VariableCollection / Variable objects via the plugin API.
 */

import { hexToRgb } from '../lib/oklch';

// ── Collection names ─────────────────────────────────────────────────────────

export const CORE_COLLECTION_NAME = '.core';
export const SCHEME_COLLECTION_NAME = 'Core Brand Scheme';

export const SCHEME_MODE_NEUTRAL_LIGHT = 'Neutral Light';
export const SCHEME_MODE_NEUTRAL_DARK = 'Neutral Dark';
export const SCHEME_MODE_INVERTED_LIGHT = 'Inverted Light';
export const SCHEME_MODE_INVERTED_DARK = 'Inverted Dark';

export const SCHEME_MODE_NAMES = [
  SCHEME_MODE_NEUTRAL_LIGHT,
  SCHEME_MODE_NEUTRAL_DARK,
  SCHEME_MODE_INVERTED_LIGHT,
  SCHEME_MODE_INVERTED_DARK,
] as const;

// ── Collection / mode helpers ────────────────────────────────────────────────

export async function getOrCreateCollection(
  name: string,
  initialModeName = 'Default',
): Promise<VariableCollection> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const existing = collections.find(c => c.name === name);
  if (existing) return existing;
  const col = figma.variables.createVariableCollection(name);
  // createVariableCollection starts with one mode; rename it to the supplied name.
  if (col.modes[0] && col.modes[0].name !== initialModeName) {
    col.renameMode(col.modes[0].modeId, initialModeName);
  }
  return col;
}

export function ensureMode(
  collection: VariableCollection,
  modeName: string,
): string {
  const existing = collection.modes.find(m => m.name === modeName);
  if (existing) return existing.modeId;
  return collection.addMode(modeName);
}

// ── Variable helpers ─────────────────────────────────────────────────────────

export async function findVariableByName(
  collection: VariableCollection,
  name: string,
): Promise<Variable | null> {
  for (const id of collection.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v && v.name === name) return v;
  }
  return null;
}

export async function upsertVariable(
  collection: VariableCollection,
  name: string,
  type: VariableResolvedDataType,
): Promise<{ variable: Variable; created: boolean }> {
  const existing = await findVariableByName(collection, name);
  if (existing) return { variable: existing, created: false };
  const variable = figma.variables.createVariable(name, collection, type);
  return { variable, created: true };
}

// ── Value helpers ────────────────────────────────────────────────────────────

export function hexToFigmaRgb(hex: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  return {
    r: clamp01(r),
    g: clamp01(g),
    b: clamp01(b),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Write a COLOR primitive to every mode of its collection (so scheme modes
 * without a mode-specific override read the same value).
 */
export async function setColorAllModes(
  v: Variable,
  collection: VariableCollection,
  hex: string,
): Promise<void> {
  const rgb = hexToFigmaRgb(hex);
  for (const m of collection.modes) {
    v.setValueForMode(m.modeId, rgb);
  }
}

export async function setFloatAllModes(
  v: Variable,
  collection: VariableCollection,
  value: number,
): Promise<void> {
  for (const m of collection.modes) {
    v.setValueForMode(m.modeId, value);
  }
}

export async function setStringAllModes(
  v: Variable,
  collection: VariableCollection,
  value: string,
): Promise<void> {
  for (const m of collection.modes) {
    v.setValueForMode(m.modeId, value);
  }
}

export function aliasTo(variable: Variable): VariableAlias {
  return { type: 'VARIABLE_ALIAS', id: variable.id };
}
