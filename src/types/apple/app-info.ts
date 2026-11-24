// App info, age rating, accessibility, availability, and encryption declarations.

import type { components } from './apple-api-types.ts';

/** An existing App Encryption Declaration on an app */
export type EncryptionDeclarationResource = Readonly<{
  id: string;
  state: string;
}>;

/** An app's App Info record */
export type AppInfoResource = Readonly<{
  id: string;
  state?: string;
  primaryCategoryId?: string;
  secondaryCategoryId?: string;
}>;

/** One age-rating answer: a content-descriptor enum string (`NONE` / `INFREQUENT` / `FREQUENT`) or a boolean flag. */
export type AgeRatingValue = string | boolean;

/** Effect `Schema.filter` verdict for age-rating answers: `true`, or a message naming what to use instead of a deprecated name or value. */
export function deprecatedAgeRatingVerdict(
  answers: Readonly<Record<string, AgeRatingValue>>,
): true | string {
  for (const [attributeName, answer] of Object.entries(answers)) {
    const attributeAdvice = {
      kidsAgeBand: 'Apple deprecated it in App Store Connect API 4.2; remove it',
      ageRatingOverride: 'use ageRatingOverrideV2',
    }[attributeName];

    if (attributeAdvice != null) {
      return `ageRating.${attributeName} is deprecated: ${attributeAdvice}.`;
    }

    const replacementAnswer = {
      INFREQUENT_OR_MILD: 'INFREQUENT',
      FREQUENT_OR_INTENSE: 'FREQUENT',
    }[String(answer)];

    if (replacementAnswer != null) {
      return `ageRating.${attributeName} uses deprecated value ${String(answer)}: use ${replacementAnswer}.`;
    }
  }

  return true;
}

/** An app's age-rating declaration. */
export type AgeRatingDeclarationResource = Readonly<{
  id: string;
  attributes: Record<string, AgeRatingValue>;
}>;

/** The device families an accessibility declaration can target. */
export type DeviceFamily = components['schemas']['DeviceFamily'];

/** The accessibility-support flags an accessibility declaration carries */
export type AccessibilitySupport = Readonly<{
  supportsAudioDescriptions?: boolean;
  supportsCaptions?: boolean;
  supportsDarkInterface?: boolean;
  supportsDifferentiateWithoutColorAlone?: boolean;
  supportsLargerText?: boolean;
  supportsReducedMotion?: boolean;
  supportsSufficientContrast?: boolean;
  supportsVoiceControl?: boolean;
  supportsVoiceover?: boolean;
}>;

/** The nine `AccessibilitySupport` keys, used to diff a declaration against config and to build requests. */
export const ACCESSIBILITY_SUPPORT_KEYS: readonly (keyof AccessibilitySupport)[] = [
  'supportsAudioDescriptions',
  'supportsCaptions',
  'supportsDarkInterface',
  'supportsDifferentiateWithoutColorAlone',
  'supportsLargerText',
  'supportsReducedMotion',
  'supportsSufficientContrast',
  'supportsVoiceControl',
  'supportsVoiceover',
];

/** One app's accessibility declaration for a single {@link DeviceFamily}. */
export type AccessibilityDeclarationResource = Readonly<{
  id: string;
  deviceFamily: DeviceFamily;
  state: 'DRAFT' | 'PUBLISHED' | 'REPLACED';
  support: AccessibilitySupport;
}>;

/** An app's store availability (Apple's v2 model) */
export type AppAvailabilityResource = Readonly<{
  id: string;
  availableInNewTerritories: boolean;
  availableTerritories: readonly string[];
}>;
