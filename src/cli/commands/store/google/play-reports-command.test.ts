import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VITALS_DAYS,
  MAX_VITALS_DAYS,
  parseVitalsDays,
  parseVitalsMetrics,
} from './play-reports-command.ts';

describe('parseVitalsMetrics', () => {
  it('shows both vitals when no metric flag is given', () => {
    const vitalsMetrics = parseVitalsMetrics(undefined);
    expect(vitalsMetrics).toEqual(['crash', 'anr']);
  });

  it('narrows to a single vital case-insensitively', () => {
    const vitalsMetrics = parseVitalsMetrics('crash');
    expect(vitalsMetrics).toEqual(['crash']);
    expect(parseVitalsMetrics(' ANR ')).toEqual(['anr']);
  });

  it('rejects an unknown metric with an actionable failure', () => {
    expect(() => parseVitalsMetrics('ratings')).toThrow(/crash.*anr/);
    expect(() => parseVitalsMetrics('slow-start')).toThrow(/crash.*anr/);
  });
});

describe('parseVitalsDays', () => {
  it('defaults to the standard window when absent', () => {
    const vitalsDays = parseVitalsDays(undefined);
    expect(vitalsDays).toBe(DEFAULT_VITALS_DAYS);
  });

  it('accepts a positive whole number', () => {
    const vitalsDays = parseVitalsDays('7');
    expect(vitalsDays).toBe(7);
    expect(parseVitalsDays(' 90 ')).toBe(90);
  });

  it('rejects zero, negatives, and non-integers', () => {
    expect(() => parseVitalsDays('0')).toThrow(/positive whole number/);
    expect(() => parseVitalsDays('-3')).toThrow(/positive whole number/);
    expect(() => parseVitalsDays('7.5')).toThrow(/positive whole number/);
    expect(() => parseVitalsDays('lots')).toThrow(/positive whole number/);
  });

  it('accepts the maximum but rejects anything past it', () => {
    const asString = String(MAX_VITALS_DAYS);
    const vitalsDays = parseVitalsDays(asString);
    expect(vitalsDays).toBe(MAX_VITALS_DAYS);
    expect(() => {
      const asString = String(MAX_VITALS_DAYS + 1);
      return parseVitalsDays(asString);
    }).toThrow(/cannot exceed/);
    expect(() => parseVitalsDays('999999999999999999999')).toThrow(/cannot exceed/);
  });
});
