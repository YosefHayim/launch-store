import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { buildRelease, isReleaseStatus, parseReleaseNotes, parseRollout } from './playTracks.js';

describe('isReleaseStatus', () => {
  it("recognizes Play's statuses and rejects others", () => {
    expect(isReleaseStatus('inProgress')).toBe(true);
    expect(isReleaseStatus('completed')).toBe(true);
    expect(isReleaseStatus('live')).toBe(false);
  });
});

describe('parseRollout', () => {
  it('accepts a fraction strictly between 0 and 1', () => {
    expect(Effect.runSync(parseRollout('0.1'))).toBe(0.1);
    expect(Effect.runSync(parseRollout('0.999'))).toBe(0.999);
  });

  it('rejects 0, 1, out-of-range, and non-numeric values', () => {
    expect(() => Effect.runSync(parseRollout('0'))).toThrow(/between 0 and 1/);
    expect(() => Effect.runSync(parseRollout('1'))).toThrow(/between 0 and 1/);
    expect(() => Effect.runSync(parseRollout('1.5'))).toThrow(/between 0 and 1/);
    expect(() => Effect.runSync(parseRollout('soon'))).toThrow(/between 0 and 1/);
  });
});

describe('parseReleaseNotes', () => {
  it("turns a language-to-text object into the API's array shape", () => {
    expect(
      Effect.runSync(parseReleaseNotes({ 'en-US': 'Bug fixes', 'de-DE': 'Fehlerbehebungen' })),
    ).toEqual([
      { language: 'en-US', text: 'Bug fixes' },
      { language: 'de-DE', text: 'Fehlerbehebungen' },
    ]);
  });

  it('rejects non-object documents and non-string notes', () => {
    expect(() => Effect.runSync(parseReleaseNotes(['en-US', 'Bug fixes']))).toThrow(
      /must be a JSON object/,
    );
    expect(() => Effect.runSync(parseReleaseNotes('Bug fixes'))).toThrow(/must be a JSON object/);
    expect(() => Effect.runSync(parseReleaseNotes({ 'en-US': 5 }))).toThrow(
      /must be a JSON object/,
    );
  });
});

describe('buildRelease', () => {
  it('builds a completed full-rollout release with notes', () => {
    expect(
      Effect.runSync(
        buildRelease({
          versionCodes: ['12'],
          status: 'completed',
          releaseNotes: [{ language: 'en-US', text: 'Bug fixes' }],
        }),
      ),
    ).toEqual({
      status: 'completed',
      versionCodes: ['12'],
      releaseNotes: [{ language: 'en-US', text: 'Bug fixes' }],
    });
  });

  it('builds an in-progress staged rollout with its fraction', () => {
    expect(
      Effect.runSync(
        buildRelease({ versionCodes: ['12'], status: 'inProgress', userFraction: 0.1 }),
      ),
    ).toEqual({
      status: 'inProgress',
      versionCodes: ['12'],
      userFraction: 0.1,
    });
  });

  it('requires a fraction for inProgress and forbids one for completed/draft', () => {
    expect(() =>
      Effect.runSync(buildRelease({ versionCodes: ['12'], status: 'inProgress' })),
    ).toThrow(/needs a rollout fraction/);
    expect(() =>
      Effect.runSync(
        buildRelease({ versionCodes: ['12'], status: 'completed', userFraction: 0.5 }),
      ),
    ).toThrow(/can't carry a rollout fraction/);
  });

  it('rejects an empty version list and an out-of-range fraction', () => {
    expect(() => Effect.runSync(buildRelease({ versionCodes: [], status: 'completed' }))).toThrow(
      /at least one version code/,
    );
    expect(() =>
      Effect.runSync(buildRelease({ versionCodes: ['12'], status: 'inProgress', userFraction: 1 })),
    ).toThrow(/between 0 and 1/);
  });
});
