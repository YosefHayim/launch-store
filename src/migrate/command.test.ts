import { describe, expect, it } from 'vitest';
import { MigrateCommandInputSchema } from './command.js';

describe('MigrateCommandInputSchema', () => {
  it('accepts eas and fastlane with force, dryRun, and optional out', () => {
    expect(
      MigrateCommandInputSchema({
        source: 'eas',
        force: false,
        dryRun: true,
        out: '/tmp/out',
      }),
    ).toEqual({
      source: 'eas',
      force: false,
      dryRun: true,
      out: '/tmp/out',
    });
    expect(
      MigrateCommandInputSchema({
        source: 'fastlane',
        force: true,
        dryRun: false,
      }),
    ).toEqual({
      source: 'fastlane',
      force: true,
      dryRun: false,
    });
  });

  it('rejects an unknown migration source', () => {
    expect(() =>
      MigrateCommandInputSchema({
        source: 'codemagic',
        force: false,
        dryRun: false,
      }),
    ).toThrow();
  });
});
