/**
 * Step 09 commit orchestration.
 *
 * Runs the five write operations in dependency order and reports progress
 * to the UI after each step. Preserves the draft on failure so the user
 * can retry from the failed op.
 */

import type { OnboardingDraft, CommitProgress, CommitResult } from '../state/types';
import { writeCoreColors } from './writeCoreColors';
import { writeLightTokens } from './writeLightTokens';
import { writeDarkTokens } from './writeDarkTokens';
import { writeTypography } from './writeTypography';
import { validateAfterWrite } from './validateAfterWrite';

interface Op {
  label: string;
  fn: (draft: OnboardingDraft) => Promise<number | void>;
}

const OPS: Op[] = [
  { label: 'Writing .core primitives…',      fn: writeCoreColors },
  { label: 'Writing Light Tokens…',          fn: writeLightTokens },
  { label: 'Writing Dark Tokens…',           fn: writeDarkTokens },
  { label: 'Writing typography…',            fn: writeTypography },
  { label: 'Validating aliases and mirror…', fn: async () => { await validateAfterWrite(); } },
];

export async function runCommit(
  draft: OnboardingDraft,
  onProgress: (p: CommitProgress) => void,
): Promise<CommitResult> {
  let variablesWritten = 0;

  for (let i = 0; i < OPS.length; i++) {
    const op = OPS[i];
    onProgress({
      currentOp: i,
      totalOps: 5,
      currentLabel: op.label,
      variablesWritten,
    });

    try {
      const ret = await op.fn(draft);
      if (typeof ret === 'number') variablesWritten += ret;
    } catch (err) {
      return {
        success: false,
        variablesWritten,
        error: err instanceof Error ? err.message : String(err),
        failedAtOp: i,
      };
    }
  }

  // Final validation result (re-run so we return the structured payload).
  const validationResult = await validateAfterWrite();

  onProgress({
    currentOp: OPS.length - 1,
    totalOps: 5,
    currentLabel: 'Complete',
    variablesWritten,
  });

  return {
    success: true,
    variablesWritten,
    validationResult,
  };
}
