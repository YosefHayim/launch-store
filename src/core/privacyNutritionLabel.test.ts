import { describe, expect, it } from 'vitest';
import {
  APP_PRIVACY_HELP_URL,
  APP_PRIVACY_STEPS,
  appPrivacyChecklist,
} from './privacyNutritionLabel.js';

describe('appPrivacyChecklist', () => {
  it('emits a UI-only verdict, every numbered step, and the help link', () => {
    const lines = appPrivacyChecklist();

    expect(lines[0]).toContain('UI-only');
    APP_PRIVACY_STEPS.forEach((step, index) => {
      expect(lines.some((line) => line.includes(`${index + 1}. ${step}`))).toBe(true);
    });
    expect(lines.at(-1)).toContain(APP_PRIVACY_HELP_URL);
  });

  it("covers the questionnaire's dimensions: categories, purposes, linkage, tracking, publish", () => {
    const text = APP_PRIVACY_STEPS.join(' ').toLowerCase();
    for (const dimension of ['categor', 'purpose', 'linked', 'track', 'publish']) {
      expect(text).toContain(dimension);
    }
  });
});
