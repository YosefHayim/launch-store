import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { SnapshotCommandInputSchema } from './snapshotCommand.js';

describe('SnapshotCommandInputSchema', () => {
  it('decodes capture and diff operations', () => {
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'create',
        name: 'before-release',
        app: 'demo',
        json: true,
      }),
    ).toEqual({ operation: 'create', name: 'before-release', app: 'demo', json: true });
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'diff',
        baseline: 'before-release',
        against: 'live',
        json: false,
      }),
    ).toEqual({
      operation: 'diff',
      baseline: 'before-release',
      against: 'live',
      json: false,
    });
  });

  it('decodes prune and restore options without generic records', () => {
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'prune',
        options: { keep: '3', yes: false, json: true },
      }),
    ).toEqual({ operation: 'prune', options: { keep: '3', yes: false, json: true } });
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'restore',
        name: 'before-release',
        source: 'apple-listing',
        yes: false,
        json: false,
      }),
    ).toEqual({
      operation: 'restore',
      name: 'before-release',
      source: 'apple-listing',
      yes: false,
      json: false,
    });
  });
});
