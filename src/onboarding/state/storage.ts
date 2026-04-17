/**
 * Draft persistence — figma.clientStorage wrapper.
 *
 * Only runs inside the Figma plugin worker (code.ts).
 */

import type { OnboardingDraft } from './types';

export const STORAGE_KEY = 'onboarding_draft';

export async function loadDraft(): Promise<OnboardingDraft | null> {
  try {
    const raw = await figma.clientStorage.getAsync(STORAGE_KEY);
    if (!raw) return null;
    if (typeof raw === 'string') return JSON.parse(raw) as OnboardingDraft;
    if (typeof raw === 'object') return raw as OnboardingDraft;
    return null;
  } catch {
    return null;
  }
}

export async function saveDraft(draft: OnboardingDraft): Promise<void> {
  await figma.clientStorage.setAsync(STORAGE_KEY, JSON.stringify(draft));
}

export async function clearDraft(): Promise<void> {
  await figma.clientStorage.deleteAsync(STORAGE_KEY);
}
