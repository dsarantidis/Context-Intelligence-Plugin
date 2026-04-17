/**
 * Thin re-export layer for Step 01 auto-place.
 *
 * Centralises the public surface so code.ts message handlers and the Step 01
 * UI can import a single module without reaching into `lib/oklch.ts`.
 */

export {
  autoPlace,
  generateScale,
  splitGroups,
  hexToOklch,
  oklchToHex,
  contrastRatio,
  isDark,
  normalizeHex,
  SHADE_NAMES,
  SHADE_L_TARGETS,
} from './oklch';

export type { ShadeName } from './oklch';

// ── Input parsing ────────────────────────────────────────────────────────────

/**
 * Split a user-entered string into candidate hex codes.
 * Accepts newlines, commas, spaces, or semicolons as separators.
 */
export function parseHexList(input: string): string[] {
  if (!input) return [];
  return String(input)
    .split(/[\n,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}
