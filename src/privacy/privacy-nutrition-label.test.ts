import { describe, expect, it } from 'vitest';
import {
  APP_PRIVACY_HELP_URL,
  APP_PRIVACY_STEPS,
  appPrivacyChecklist,
} from './privacy-nutrition-label.ts';
function describeAppPrivacyChecklist() {
  function emitsAUIOnlyVerdictEveryNumberedStepAndTheHelpLink() {
    const lines = appPrivacyChecklist();

    expect(lines[0]).toContain('UI-only');

    function expectNumberedStep(step: string, index: number) {
      function includesStepLine(line: string) {
        return line.includes(`${index + 1}. ${step}`);
      }

      expect(lines.some(includesStepLine)).toBe(true);
    }

    APP_PRIVACY_STEPS.forEach(expectNumberedStep);
    expect(lines.at(-1)).toContain(APP_PRIVACY_HELP_URL);
  }

  it(
    'emits a UI-only verdict, every numbered step, and the help link',
    emitsAUIOnlyVerdictEveryNumberedStepAndTheHelpLink,
  );

  function coversTheQuestionnaireSDimensionsCategoriesPurposesLinkageTrackingPublish() {
    const text = APP_PRIVACY_STEPS.join(' ').toLowerCase();
    for (const dimension of ['categor', 'purpose', 'linked', 'track', 'publish']) {
      expect(text).toContain(dimension);
    }
  }

  it(
    "covers the questionnaire's dimensions: categories, purposes, linkage, tracking, publish",
    coversTheQuestionnaireSDimensionsCategoriesPurposesLinkageTrackingPublish,
  );
}

describe('appPrivacyChecklist', describeAppPrivacyChecklist);
