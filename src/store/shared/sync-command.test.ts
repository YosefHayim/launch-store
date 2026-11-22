import { describe, expect, it } from 'vitest';
import { SyncCommandInputSchema } from './sync-command.ts';

describe('SyncCommandInputSchema', () => {
  it('decodes the complete Commander boundary', () => {
    const syncCommandSchema = SyncCommandInputSchema({
      app: 'ios,android',
      dryRun: true,
      allowDestructive: false,
      yes: true,
      snapshot: false,
    });
    expect(syncCommandSchema).toEqual({
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
