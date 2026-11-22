import { describe, expect, it } from 'vitest';
import { decodeVersionExperimentsCommandInput } from './versionExperimentsCommand.ts';

describe('decodeVersionExperimentsCommandInput', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    expect(
      decodeVersionExperimentsCommandInput({
        config: 'experiments.config.json',
        submit: true,
        start: false,
        dryRun: true,
        yes: false,
      }),
    ).toEqual({
      config: 'experiments.config.json',
      submit: true,
      start: false,
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      decodeVersionExperimentsCommandInput({
        app: undefined,
        config: 'experiments.config.json',
        submit: false,
        start: false,
        dryRun: false,
        yes: false,
      }),
    ).toThrowError(expect.objectContaining({ _tag: 'VersionExperimentsCommandFailure' }));
  });
});
