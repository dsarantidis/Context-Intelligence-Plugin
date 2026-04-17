/**
 * Factory for a fresh OnboardingDraft.
 */

import type {
  OnboardingDraft,
  TypeScaleSlotId,
  TypeScaleEntry,
} from './types';

export const DEFAULT_SCALE: Record<TypeScaleSlotId, TypeScaleEntry> = {
  'display-lg': { size: 56, weight: 700, lineHeight: 1.1 },
  'display-md': { size: 44, weight: 700, lineHeight: 1.1 },
  'display-sm': { size: 36, weight: 600, lineHeight: 1.15 },
  'heading-1':  { size: 28, weight: 600, lineHeight: 1.2 },
  'heading-2':  { size: 22, weight: 600, lineHeight: 1.25 },
  'heading-3':  { size: 18, weight: 500, lineHeight: 1.3 },
  'heading-4':  { size: 15, weight: 500, lineHeight: 1.35 },
  'body-lg':    { size: 17, weight: 400, lineHeight: 1.6 },
  'body-md':    { size: 15, weight: 400, lineHeight: 1.6 },
  'body-sm':    { size: 13, weight: 400, lineHeight: 1.55 },
  'label-lg':   { size: 14, weight: 500, lineHeight: 1.4 },
  'label-md':   { size: 12, weight: 500, lineHeight: 1.4 },
  'label-sm':   { size: 11, weight: 500, lineHeight: 1.35 },
  'caption':    { size: 11, weight: 400, lineHeight: 1.5 },
  'overline':   { size: 10, weight: 500, lineHeight: 1.4 },
};

export function emptyDraft(): OnboardingDraft {
  return {
    version: 1,
    startedAt: Date.now(),
    currentStep: 0,
    name: '',
    logoUrl: '',
    palette: { primary: null, secondary: null },
    semanticLight: {},
    shades: {
      accentShades: [],
      neutralShades: [],
      functional: {
        destructive: '',
        warning: '',
        success: '',
        info: '',
      },
    },
    states: {
      flagged: true, // default: not defined → flagged
      default: {},
      hover: {},
      pressed: {},
    },
    semanticDark: {},
    typography: {
      primary: { family: '', weights: [400, 500, 700] },
      secondary: null,
      scale: JSON.parse(JSON.stringify(DEFAULT_SCALE)),
    },
  };
}
