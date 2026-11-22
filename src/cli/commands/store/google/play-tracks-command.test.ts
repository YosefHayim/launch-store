import { describe, expect, it } from 'vitest';
import { describePlayRelease, PlayTracksCommandInputSchema } from './play-tracks-command.ts';

describe('PlayTracksCommandInputSchema', () => {
  it('decodes each Commander operation without unset option fields', () => {
    const playTracksCommandSchema = PlayTracksCommandInputSchema({
      operation: 'status',
      json: false,
    });
    expect(playTracksCommandSchema).toEqual({ operation: 'status', json: false });
    expect(
      PlayTracksCommandInputSchema({
        operation: 'promote',
        track: 'production',
        yes: true,
      }),
    ).toEqual({ operation: 'promote', track: 'production', yes: true });
    expect(
      PlayTracksCommandInputSchema({
        operation: 'promote',
        track: 'internal',
        versionCode: '8',
        notes: 'notes.json',
        yes: true,
      }),
    ).toEqual({
      operation: 'promote',
      track: 'internal',
      versionCode: '8',
      notes: 'notes.json',
      yes: true,
    });
    expect(
      PlayTracksCommandInputSchema({
        operation: 'testers',
        track: 'internal',
        yes: false,
      }),
    ).toEqual({ operation: 'testers', track: 'internal', yes: false });
  });

  it('rejects explicit undefined exact optional fields', () => {
    expect(() =>
      PlayTracksCommandInputSchema({
        operation: 'promote',
        app: undefined,
        track: 'production',
        yes: false,
      }),
    ).toThrow();
  });
});

describe('describePlayRelease', () => {
  it('renders status, builds, rollout, and notes with ASCII text', () => {
    const playRelease = describePlayRelease({
      status: 'inProgress',
      versionCodes: ['42'],
      userFraction: 0.25,
      releaseNotes: [{ language: 'en-US', text: 'Faster startup' }],
    });
    expect(playRelease).toBe('inProgress  v42  25% rollout  1 note(s)');
  });
});
