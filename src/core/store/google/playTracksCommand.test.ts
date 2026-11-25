import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { describePlayRelease, PlayTracksCommandInputSchema } from './playTracksCommand.js';

describe('PlayTracksCommandInputSchema', () => {
  it('decodes each Commander operation without unset option fields', () => {
    expect(
      Schema.decodeUnknownSync(PlayTracksCommandInputSchema)({
        operation: 'status',
        json: false,
      }),
    ).toEqual({ operation: 'status', json: false });
    expect(
      Schema.decodeUnknownSync(PlayTracksCommandInputSchema)({
        operation: 'promote',
        track: 'production',
        yes: true,
      }),
    ).toEqual({ operation: 'promote', track: 'production', yes: true });
    expect(
      Schema.decodeUnknownSync(PlayTracksCommandInputSchema)({
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
      Schema.decodeUnknownSync(PlayTracksCommandInputSchema)({
        operation: 'testers',
        track: 'internal',
        yes: false,
      }),
    ).toEqual({ operation: 'testers', track: 'internal', yes: false });
  });

  it('rejects explicit undefined exact optional fields', () => {
    expect(() =>
      Schema.decodeUnknownSync(PlayTracksCommandInputSchema)({
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
    expect(
      describePlayRelease({
        status: 'inProgress',
        versionCodes: ['42'],
        userFraction: 0.25,
        releaseNotes: [{ language: 'en-US', text: 'Faster startup' }],
      }),
    ).toBe('inProgress  v42  25% rollout  1 note(s)');
  });
});
