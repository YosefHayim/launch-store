import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { Effect } from 'effect';
import {
  type BuildCommandOptions,
  parseBuildCommandInput,
  parseSizeBudget,
} from '@core/build/buildCommandInput.js';
import { registerBuildCommand } from './build.js';
const BASE_OPTIONS: BuildCommandOptions = {
  profile: 'production',
  explain: false,
  submit: true,
  dryRun: false,
  yes: false,
  verbose: false,
  clean: false,
  env: [],
  includeLocal: false,
  printEnv: false,
  ccache: true,
};
const GREATER_THAN_ZERO_ERROR = /greater than 0/;
const INVALID_SIZE_BUDGET_ERROR = /Invalid --size-budget "big"/;
const UNKNOWN_TRACK_ERROR = /Unknown --track "beta"/;
describe('parseSizeBudget - the per-run size-budget CLI boundary', () => {
  it('returns undefined when the flag is omitted (-> profile, then default)', () => {
    expect(Effect.runSync(parseSizeBudget(undefined))).toBeUndefined();
  });
  it('parses a positive MB number, including fractional values', () => {
    expect(Effect.runSync(parseSizeBudget('250'))).toBe(250);
    expect(Effect.runSync(parseSizeBudget('199.5'))).toBe(199.5);
  });
  it('rejects zero and negative budgets with a clear message', () => {
    const zeroBudgetFailure = Effect.runSync(Effect.flip(parseSizeBudget('0')));
    const negativeBudgetFailure = Effect.runSync(Effect.flip(parseSizeBudget('-5')));
    expect(zeroBudgetFailure.message).toMatch(GREATER_THAN_ZERO_ERROR);
    expect(negativeBudgetFailure.message).toMatch(GREATER_THAN_ZERO_ERROR);
  });
  it('rejects non-numeric input with a clear message', () => {
    const sizeBudgetFailure = Effect.runSync(Effect.flip(parseSizeBudget('big')));
    expect(sizeBudgetFailure.message).toMatch(INVALID_SIZE_BUDGET_ERROR);
  });
});
describe('parseBuildCommandInput - raw Commander values to pipeline input', () => {
  it('decodes optional build flags into the BuildRunOptions contract', () => {
    const buildInput = Effect.runSync(
      parseBuildCommandInput('ios', {
        ...BASE_OPTIONS,
        app: 'demo',
        account: 'team-a',
        remote: 'aws',
        distribution: 'internal',
        bump: 'patch',
        sizeBudget: '250',
        env: ['API_URL=https://example.com'],
        includeLocal: true,
        printEnv: true,
      }),
    );
    expect(buildInput).toMatchObject({
      platform: 'ios',
      profileName: 'production',
      appName: 'demo',
      target: 'testing',
      remote: { kind: 'aws' },
      distribution: 'internal',
      bump: 'patch',
      sizeBudgetMB: 250,
      envOverrides: { API_URL: 'https://example.com' },
      includeLocal: true,
      printEnv: true,
      account: 'team-a',
    });
  });
  it('rejects unknown tracks before the pipeline runs', () => {
    const trackFailure = Effect.runSync(
      Effect.flip(parseBuildCommandInput('android', { ...BASE_OPTIONS, track: 'beta' })),
    );
    expect(trackFailure.message).toMatch(UNKNOWN_TRACK_ERROR);
  });
  it('decodes --no-ccache into the BuildRunOptions contract', () => {
    const buildInput = Effect.runSync(
      parseBuildCommandInput('ios', { ...BASE_OPTIONS, ccache: false }),
    );
    expect(buildInput.ccache).toBe(false);
  });
});
describe('registerBuildCommand - the size-budget flag and its alias', () => {
  function buildCommand() {
    const program = new Command();
    registerBuildCommand(program);
    return program.commands.find((command) => command.name() === 'build');
  }
  it('exposes --size-budget and its --budget alias', () => {
    const storeBuild82 = buildCommand();
    expect(storeBuild82).toBeDefined();
    const flags = storeBuild82?.options.map((option) => option.long);
    expect(flags).toContain('--size-budget');
    expect(flags).toContain('--budget');
  });
  it('exposes --no-ccache for monorepo extension builds that cannot use the RN ccache shim', () => {
    const storeBuild89 = buildCommand();
    expect(storeBuild89).toBeDefined();
    const flags = storeBuild89?.options.map((option) => option.long);
    expect(flags).toContain('--no-ccache');
  });
});
