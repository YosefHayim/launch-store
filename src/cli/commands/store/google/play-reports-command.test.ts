import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VITALS_DAYS,
  MAX_VITALS_DAYS,
  parseVitalsDays,
  parseVitalsMetrics,
} from './play-reports-command.ts';
function describeParseVitalsMetrics() {
  function showsBothVitalsWhenNoMetricFlagIsGiven() {
    const vitalsMetrics = parseVitalsMetrics(undefined);
    expect(vitalsMetrics).toEqual(['crash', 'anr']);
  }

  it('shows both vitals when no metric flag is given', showsBothVitalsWhenNoMetricFlagIsGiven);
  function narrowsToASingleVitalCaseInsensitively() {
    const vitalsMetrics = parseVitalsMetrics('crash');
    expect(vitalsMetrics).toEqual(['crash']);
    expect(parseVitalsMetrics(' ANR ')).toEqual(['anr']);
  }

  it('narrows to a single vital case-insensitively', narrowsToASingleVitalCaseInsensitively);
  function rejectsAnUnknownMetricWithAnActionableFailure() {
    function callParseVitalsMetrics() {
      return parseVitalsMetrics('ratings');
    }

    expect(callParseVitalsMetrics).toThrow(/crash.*anr/);
    function callParseVitalsMetrics2() {
      return parseVitalsMetrics('slow-start');
    }

    expect(callParseVitalsMetrics2).toThrow(/crash.*anr/);
  }

  it(
    'rejects an unknown metric with an actionable failure',
    rejectsAnUnknownMetricWithAnActionableFailure,
  );
}

describe('parseVitalsMetrics', describeParseVitalsMetrics);
function describeParseVitalsDays() {
  function defaultsToTheStandardWindowWhenAbsent() {
    const vitalsDays = parseVitalsDays(undefined);
    expect(vitalsDays).toBe(DEFAULT_VITALS_DAYS);
  }

  it('defaults to the standard window when absent', defaultsToTheStandardWindowWhenAbsent);
  function acceptsAPositiveWholeNumber() {
    const vitalsDays = parseVitalsDays('7');
    expect(vitalsDays).toBe(7);
    expect(parseVitalsDays(' 90 ')).toBe(90);
  }

  it('accepts a positive whole number', acceptsAPositiveWholeNumber);
  function rejectsZeroNegativesAndNonIntegers() {
    function callParseVitalsDays() {
      return parseVitalsDays('0');
    }

    expect(callParseVitalsDays).toThrow(/positive whole number/);
    function callParseVitalsDays2() {
      return parseVitalsDays('-3');
    }

    expect(callParseVitalsDays2).toThrow(/positive whole number/);
    function callParseVitalsDays3() {
      return parseVitalsDays('7.5');
    }

    expect(callParseVitalsDays3).toThrow(/positive whole number/);
    function callParseVitalsDays4() {
      return parseVitalsDays('lots');
    }

    expect(callParseVitalsDays4).toThrow(/positive whole number/);
  }

  it('rejects zero, negatives, and non-integers', rejectsZeroNegativesAndNonIntegers);
  function acceptsTheMaximumButRejectsAnythingPastIt() {
    const asString = String(MAX_VITALS_DAYS);
    const vitalsDays = parseVitalsDays(asString);
    expect(vitalsDays).toBe(MAX_VITALS_DAYS);
    function expectCall() {
      const asString = String(MAX_VITALS_DAYS + 1);
      return parseVitalsDays(asString);
    }

    expect(expectCall).toThrow(/cannot exceed/);
    function callParseVitalsDays5() {
      return parseVitalsDays('999999999999999999999');
    }

    expect(callParseVitalsDays5).toThrow(/cannot exceed/);
  }

  it('accepts the maximum but rejects anything past it', acceptsTheMaximumButRejectsAnythingPastIt);
}

describe('parseVitalsDays', describeParseVitalsDays);
