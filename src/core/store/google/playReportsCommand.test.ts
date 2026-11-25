import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VITALS_DAYS,
  MAX_VITALS_DAYS,
  parseVitalsDays,
  parseVitalsMetrics,
} from './playReportsCommand.js';

describe('parseVitalsMetrics', () => {
  it('shows both vitals when no metric flag is given', () => {
    expect(Effect.runSync(parseVitalsMetrics(undefined))).toEqual(['crash', 'anr']);
  });

  it('narrows to a single vital case-insensitively', () => {
    expect(Effect.runSync(parseVitalsMetrics('crash'))).toEqual(['crash']);
    expect(Effect.runSync(parseVitalsMetrics(' ANR '))).toEqual(['anr']);
  });

  it('rejects an unknown metric with an actionable failure', () => {
    expect(() => Effect.runSync(parseVitalsMetrics('ratings'))).toThrow(/crash.*anr/);
    expect(() => Effect.runSync(parseVitalsMetrics('slow-start'))).toThrow(/crash.*anr/);
  });
});

describe('parseVitalsDays', () => {
  it('defaults to the standard window when absent', () => {
    expect(Effect.runSync(parseVitalsDays(undefined))).toBe(DEFAULT_VITALS_DAYS);
  });

  it('accepts a positive whole number', () => {
    expect(Effect.runSync(parseVitalsDays('7'))).toBe(7);
    expect(Effect.runSync(parseVitalsDays(' 90 '))).toBe(90);
  });

  it('rejects zero, negatives, and non-integers', () => {
    expect(() => Effect.runSync(parseVitalsDays('0'))).toThrow(/positive whole number/);
    expect(() => Effect.runSync(parseVitalsDays('-3'))).toThrow(/positive whole number/);
    expect(() => Effect.runSync(parseVitalsDays('7.5'))).toThrow(/positive whole number/);
    expect(() => Effect.runSync(parseVitalsDays('lots'))).toThrow(/positive whole number/);
  });

  it('accepts the maximum but rejects anything past it', () => {
    expect(Effect.runSync(parseVitalsDays(String(MAX_VITALS_DAYS)))).toBe(MAX_VITALS_DAYS);
    expect(() => Effect.runSync(parseVitalsDays(String(MAX_VITALS_DAYS + 1)))).toThrow(
      /cannot exceed/,
    );
    expect(() => Effect.runSync(parseVitalsDays('999999999999999999999'))).toThrow(/cannot exceed/);
  });
});
