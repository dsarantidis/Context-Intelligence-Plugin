/**
 * Onboarding (Foundations Setup Wizard) — shared types.
 *
 * All data captured across the 9-step wizard lives in a single `OnboardingDraft`
 * persisted in `figma.clientStorage` under `onboarding_draft`. Nothing writes
 * to Figma until Step 09 commit.
 */

// ── Semantic slots ───────────────────────────────────────────────────────────

export type SemanticSlotId =
  | 'accent'
  | 'on-accent'
  | 'accent-text'
  | 'link'
  | 'accent-sec'
  | 'stroke'
  | 'stroke-subtle'
  | 'text'
  | 'text-rec'
  | 'modal';

export const SEMANTIC_SLOT_IDS: readonly SemanticSlotId[] = [
  'accent',
  'on-accent',
  'accent-text',
  'link',
  'accent-sec',
  'stroke',
  'stroke-subtle',
  'text',
  'text-rec',
  'modal',
] as const;

export type SemanticMap = Partial<Record<SemanticSlotId, string>>;

// ── Palette ──────────────────────────────────────────────────────────────────

/** One of the 10 shade slots in a generated palette (index 0..9, names 50..900). */
export interface PaletteEntry {
  index: number;           // 0..9
  shadeName: string;       // "50", "100", ..., "900"
  hex: string;
  /** Where this stop came from in the auto-place pass. */
  source: 'input' | 'generated' | 'pushed' | 'filled';
}

export interface PaletteData {
  primary: PaletteEntry[] | null;   // 10 entries when set
  secondary: PaletteEntry[] | null; // 10 entries when set; null when user skips
}

// ── Auto-place result ────────────────────────────────────────────────────────

export type PlaceAction = 'kept' | 'pushed' | 'filled' | 'unplaced';

export interface PlaceLogEntry {
  action: PlaceAction;
  hex: string;
  shadeName?: string;     // target slot when placed
  fromShadeName?: string; // origin slot when pushed
  reason?: string;
}

export interface AutoPlaceResult {
  slots: PaletteEntry[];  // always 10 entries (generated/filled if not enough input)
  log: PlaceLogEntry[];
  unplaced: string[];     // hexes that could not be placed
}

// ── Shades & functional ──────────────────────────────────────────────────────

export interface FunctionalColors {
  destructive: string;
  warning?: string;
  success?: string;
  info?: string;
}

export interface ShadesData {
  accentShades: string[];
  neutralShades: string[];
  functional: FunctionalColors;
}

// ── States (hover / pressed / default) ───────────────────────────────────────

export type StateRole = 'accent' | 'link' | 'accent-sec' | 'stroke';
export type StatePhase = 'default' | 'hover' | 'pressed';

export type StatesRowValues = Partial<Record<StateRole, string>>;

export interface StatesData {
  /** True when the user opted OUT (states incomplete). Commit still proceeds. */
  flagged: boolean;
  default: StatesRowValues;
  hover: StatesRowValues;
  pressed: StatesRowValues;
}

// ── Dark semantic map ────────────────────────────────────────────────────────

export type DarkCellStatus = 'suggested' | 'confirmed' | 'customised';

export interface DarkCell {
  hex: string;
  status: DarkCellStatus;
  note?: string;
}

export type DarkSemanticMap = Partial<Record<SemanticSlotId, DarkCell>>;

// ── Typography ───────────────────────────────────────────────────────────────

export type TypeScaleSlotId =
  | 'display-lg'
  | 'display-md'
  | 'display-sm'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'body-lg'
  | 'body-md'
  | 'body-sm'
  | 'label-lg'
  | 'label-md'
  | 'label-sm'
  | 'caption'
  | 'overline';

export const TYPE_SCALE_SLOT_IDS: readonly TypeScaleSlotId[] = [
  'display-lg', 'display-md', 'display-sm',
  'heading-1', 'heading-2', 'heading-3', 'heading-4',
  'body-lg', 'body-md', 'body-sm',
  'label-lg', 'label-md', 'label-sm',
  'caption', 'overline',
] as const;

export interface TypeScaleEntry {
  size: number;
  weight: number;
  lineHeight: number;
}

export interface FontFamilySelection {
  family: string;
  weights: number[];
}

export interface TypographyData {
  primary: FontFamilySelection;
  secondary: FontFamilySelection | null;
  scale: Record<TypeScaleSlotId, TypeScaleEntry>;
}

// ── Top-level draft ──────────────────────────────────────────────────────────

export interface OnboardingDraft {
  version: 1;
  startedAt: number;
  currentStep: number; // 0..9

  name: string;
  logoUrl: string;

  palette: PaletteData;
  semanticLight: SemanticMap;
  shades: ShadesData;
  states: StatesData;
  semanticDark: DarkSemanticMap;
  typography: TypographyData;
}

// ── Validation messages ──────────────────────────────────────────────────────

export interface ValidationMessage {
  type: 'error' | 'warn' | 'suggest';
  text: string;
  /** For 'suggest' type — hex the user can apply with one click. */
  applyHex?: string;
  applySlot?: SemanticSlotId;
}

// ── Commit types ─────────────────────────────────────────────────────────────

export interface CommitProgress {
  currentOp: number;    // 0..4
  totalOps: 5;
  currentLabel: string;
  variablesWritten: number;
}

export interface CommitValidationResult {
  ok: boolean;
  brokenAliases: number;
  mirrorOk: boolean;
  violations: Array<{
    ruleId: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
  }>;
}

export interface CommitResult {
  success: boolean;
  variablesWritten: number;
  validationResult?: CommitValidationResult;
  error?: string;
  failedAtOp?: number;
}
