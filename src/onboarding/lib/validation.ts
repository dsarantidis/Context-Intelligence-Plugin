/**
 * Step 03 semantic-slot validation rules.
 *
 * Each rule returns 0..n ValidationMessage entries. An `error` message blocks
 * Continue; `warn` and `suggest` do not.
 */

import type {
  SemanticSlotId,
  SemanticMap,
  ValidationMessage,
} from '../state/types';
import { contrastRatio, isDark } from './oklch';

/** Minimum contrast for on-accent text (WCAG AA for normal text). */
const MIN_CONTRAST = 4.5;

/**
 * Validate a single slot assignment given the full map of current assignments.
 */
export function validateSlot(
  slotId: SemanticSlotId,
  hex: string | null,
  allAssignments: SemanticMap,
): ValidationMessage[] {
  const out: ValidationMessage[] = [];
  if (!hex) return out;

  switch (slotId) {
    case 'on-accent': {
      const accent = allAssignments.accent;
      if (accent) {
        const ratio = contrastRatio(hex, accent);
        if (ratio < MIN_CONTRAST) {
          out.push({
            type: 'error',
            text: `Contrast ${ratio.toFixed(2)}:1 against accent — needs ≥ ${MIN_CONTRAST}:1.`,
          });
        }
      }
      break;
    }

    case 'accent': {
      // If on-accent is already chosen, surface the contrast as a suggest/error.
      const onAccent = allAssignments['on-accent'];
      if (onAccent) {
        const ratio = contrastRatio(hex, onAccent);
        if (ratio < MIN_CONTRAST) {
          out.push({
            type: 'warn',
            text: `On-accent gets ${ratio.toFixed(2)}:1 here — may need a darker on-accent shade.`,
          });
        }
      }
      break;
    }

    case 'text': {
      // Text must read on a white-ish background at ≥ 4.5:1.
      const ratio = contrastRatio(hex, '#FFFFFF');
      if (ratio < MIN_CONTRAST) {
        out.push({
          type: 'error',
          text: `Text contrast vs white is ${ratio.toFixed(2)}:1 — needs ≥ ${MIN_CONTRAST}:1.`,
        });
      }
      const textRec = allAssignments['text-rec'];
      if (textRec && normalise(textRec) === normalise(hex)) {
        out.push({
          type: 'error',
          text: 'Text and text-recessive are the same shade — they must differ.',
        });
      }
      break;
    }

    case 'text-rec': {
      const ratio = contrastRatio(hex, '#FFFFFF');
      if (ratio < 3) {
        out.push({
          type: 'warn',
          text: `Recessive text contrast is ${ratio.toFixed(2)}:1 — fine for captions, low for body.`,
        });
      }
      const text = allAssignments.text;
      if (text && normalise(text) === normalise(hex)) {
        out.push({
          type: 'error',
          text: 'Text-recessive and text are the same shade — they must differ.',
        });
      }
      break;
    }

    case 'stroke': {
      const subtle = allAssignments['stroke-subtle'];
      if (subtle && normalise(subtle) === normalise(hex)) {
        out.push({
          type: 'warn',
          text: 'Stroke and subtle stroke are identical — consider a lighter stop for subtle.',
        });
      }
      break;
    }

    case 'accent-sec':
    case 'link':
    case 'stroke-subtle':
    case 'modal':
      // No specific cross-slot checks yet — open for extension.
      break;
  }

  // Shared heuristic: very light hex in a slot that typically expects darker ink.
  if (slotId === 'text' && !isDark(hex)) {
    out.push({
      type: 'warn',
      text: 'This looks quite light for a body-text color.',
    });
  }

  return out;
}

export function hasErrors(messages: ValidationMessage[]): boolean {
  for (const m of messages) if (m.type === 'error') return true;
  return false;
}

export function validateAll(map: SemanticMap): Record<string, ValidationMessage[]> {
  const out: Record<string, ValidationMessage[]> = {};
  for (const slot of Object.keys(map) as SemanticSlotId[]) {
    out[slot] = validateSlot(slot, map[slot] ?? null, map);
  }
  return out;
}

function normalise(hex: string): string {
  return hex.trim().toUpperCase().replace(/^#/, '');
}
