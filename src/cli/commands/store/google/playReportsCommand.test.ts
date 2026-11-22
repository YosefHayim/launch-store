import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VITALS_DAYS,
  MAX_VITALS_DAYS,
  parseVitalsDays,
  parseVitalsMetrics,
} from './playReportsCommand.ts';

describe('parseVitalsMetrics', () => {
  it('shows both vitals when no metric flag is given', () => {
    expect(parseVitalsMetrics(undefined)).toEqual(['crash', 'anr']);
  });

  it('narrows to a single vital case-insensitively', () => {
    expect(parseVitalsMetrics('crash')).toEqual(['crash']);
    expect(parseVitalsMetrics(' ANR ')).toEqual(['anr']);
  });

  it('rejects an unknown metric with an actionable failure', () => {
    expect(() => parseVitalsMetrics('ratings')).toThrow(/crash.*anr/);
    expect(() => parseVitalsMetrics('slow-start')).toThrow(/crash.*anr/);
  });
});

describe('parseVitalsDays', () => {
  it('defaults to the standard window when absent', () => {
    expect(parseVitalsDays(undefined)).toBe(DEFAULT_VITALS_DAYS);
  });

  it('accepts a positive whole number', () => {
    expect(parseVitalsDays('7')).toBe(7);
    expect(parseVitalsDays(' 90 ')).toBe(90);
  });

  it('rejects zero, negatives, and non-integers', () => {
    expect(() => parseVitalsDays('0')).toThrow(/positive whole number/);
    expect(() => parseVitalsDays('-3')).toThrow(/positive whole number/);
    expect(() => parseVitalsDays('7.5')).toThrow(/positive whole number/);
    expect(() => parseVitalsDays('lots')).toThrow(/positive whole number/);
  });

  it('accepts the maximum but rejects anything past it', () => {
    expect(parseVitalsDays(String(MAX_VITALS_DAYS))).toBe(MAX_VITALS_DAYS);
    expect(() => parseVitalsDays(String(MAX_VITALS_DAYS + 1))).toThrow(/cannot exceed/);
    expect(() => parseVitalsDays('999999999999999999999')).toThrow(/cannot exceed/);
  });
});
