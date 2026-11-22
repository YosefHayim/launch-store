import { describe, expect, it } from 'vitest';
import { SyncCommandInputSchema } from './syncCommand.js';

describe('SyncCommandInputSchema', () => {
  it('decodes the complete Commander boundary', () => {
    expect(
      SyncCommandInputSchema({
        app: 'ios,android',
        dryRun: true,
        allowDestructive: false,
        yes: true,
        snapshot: false,
      }),
    ).toEqual({
      app: 'ios,android',
      dryRun: true,
      allowDestructive: false,
      yes: true,
      snapshot: false,
    });
  });

  it('rejects missing boolean flags before orchestration', () => {
    expect(() =>
      SyncCommandInputSchema({
        dryRun: true,
        allowDestructive: false,
        yes: true,
      }),
    ).toThrow();
  });
});
