/**
 * RADD System Detector
 *
 * Identifies which version of the RADD design system architecture is present
 * in the current Figma file based on the collection signature.
 *
 * Source of truth: docs/DS_FOUNDATIONS_MEMORY.md § System Detection
 */

export type RADDVersion = 'radd-2.0' | 'radd-3.0' | 'unknown';

export interface SystemInfo {
  version: RADDVersion;
  /** Collection names found in the file */
  collectionNames: string[];
  /** True when the signature matched exactly (all required collections present) */
  exactMatch: boolean;
  /** Missing collections that prevented a clean match (useful for UI messaging) */
  missing20: string[];
  missing30: string[];
}

// ── Signatures ────────────────────────────────────────────────────────────────

const RADD_20_REQUIRED: readonly string[] = [
  '.core', '.brand', '.secondary', '.white', '.black',
  '_restricted', '.mode', '.scheme', '.breakpoint', 'foundation', 'layout',
];

const RADD_30_REQUIRED: readonly string[] = [
  '.core', 'Core Brand Scheme', '.mode', '.breakpoint', 'foundation', 'layout',
];

// ── Detector ─────────────────────────────────────────────────────────────────

export function detectRADDSystem(collectionNames: string[]): SystemInfo {
  const nameSet = new Set(collectionNames);

  const missing20 = RADD_20_REQUIRED.filter(n => !nameSet.has(n));
  const missing30 = RADD_30_REQUIRED.filter(n => !nameSet.has(n));

  const is20 = missing20.length === 0 && !nameSet.has('Core Brand Scheme');
  const is30 = missing30.length === 0 && !nameSet.has('_restricted');

  let version: RADDVersion = 'unknown';
  let exactMatch = false;

  if (is20) {
    version = 'radd-2.0';
    exactMatch = true;
  } else if (is30) {
    version = 'radd-3.0';
    exactMatch = true;
  }

  return { version, collectionNames, exactMatch, missing20, missing30 };
}

/** Compact label for UI display */
export function systemLabel(info: SystemInfo): string {
  if (info.version === 'radd-2.0') return 'RADD 2.0';
  if (info.version === 'radd-3.0') return 'RADD 3.0';
  return 'Unknown system';
}
