import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { VersionExperimentsCommandInputSchema } from './versionExperimentsCommand.js';

describe('VersionExperimentsCommandInputSchema', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    expect(
      Schema.decodeUnknownSync(VersionExperimentsCommandInputSchema)({
        config: 'experiments.config.json',
        dryRun: true,
        yes: false,
      }),
    ).toEqual({
      config: 'experiments.config.json',
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      Schema.decodeUnknownSync(VersionExperimentsCommandInputSchema)({
        app: undefined,
        config: 'experiments.config.json',
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
