import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../command.ts';
import {
  type BuildCommandOptions,
  parseBuildCommandInput,
  parseSizeBudget,
} from '../../../build/build-command-input.ts';
import { registerBuildCommand } from './build.ts';
const BASE_OPTIONS: BuildCommandOptions = {
  profile: 'production',
  explain: false,
  submit: true,
  dryRun: false,
  yes: false,
  verbose: false,
  json: false,
  clean: false,
  env: [],
  includeLocal: false,
  printEnv: false,
  ccache: true,
};
const GREATER_THAN_ZERO_ERROR = /greater than 0/;
function describeParseSizeBudgetThePerRunSizeBudgetCLIBoundary() {
  function returnsUndefinedWhenTheFlagIsOmittedProfileThenDefault() {
    const sizeBudget = parseSizeBudget(undefined);
    expect(sizeBudget).toBeUndefined();
  }

  it(
    'returns undefined when the flag is omitted (-> profile, then default)',
    returnsUndefinedWhenTheFlagIsOmittedProfileThenDefault,
  );
  function parsesAPositiveMBNumberIncludingFractionalValues() {
    const sizeBudget = parseSizeBudget('250');
    expect(sizeBudget).toBe(250);
    expect(parseSizeBudget('199.5')).toBe(199.5);
  }

  it(
    'parses a positive MB number, including fractional values',
    parsesAPositiveMBNumberIncludingFractionalValues,
  );
  function rejectsZeroAndNegativeBudgetsWithAClearMessage() {
    let zeroBudgetFailure: unknown = null;
    let negativeBudgetFailure: unknown = null;

    try {
      parseSizeBudget('0');
    } catch (caught) {
      zeroBudgetFailure = caught;
    }

    try {
      parseSizeBudget('-5');
    } catch (caught) {
      negativeBudgetFailure = caught;
    }

    expect(zeroBudgetFailure).toMatchObject({
      message: expect.stringMatching(GREATER_THAN_ZERO_ERROR),
    });
    expect(negativeBudgetFailure).toMatchObject({
      message: expect.stringMatching(GREATER_THAN_ZERO_ERROR),
    });
  }

  it(
    'rejects zero and negative budgets with a clear message',
    rejectsZeroAndNegativeBudgetsWithAClearMessage,
  );
  function rejectsNonNumericPieceWithAClearMessage() {
    let sizeBudgetFailure: unknown = null;

    try {
      parseSizeBudget('big');
    } catch (caught) {
      sizeBudgetFailure = caught;
    }

    expect(sizeBudgetFailure).toMatchObject({
      message: expect.stringMatching(/Invalid --size-budget "big"/),
    });
  }

  it('rejects non-numeric input with a clear message', rejectsNonNumericPieceWithAClearMessage);
}

describe(
  'parseSizeBudget - the per-run size-budget CLI boundary',
  describeParseSizeBudgetThePerRunSizeBudgetCLIBoundary,
);
function describeParseBuildCommandPiecePieceCommanderValuesToPipelinePiece() {
  function decodesOptionalBuildFlagsIntoTheBuildRunPieceContract() {
    const buildInput = parseBuildCommandInput('ios', {
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
    });
    expect(buildInput).toMatchObject({
      platform: 'ios',
      profileName: 'production',
      appName: 'demo',
      remote: { kind: 'aws' },
      distribution: 'internal',
      bump: 'patch',
      sizeBudgetMB: 250,
      envOverrides: { API_URL: 'https://example.com' },
      includeLocal: true,
      printEnv: true,
      account: 'team-a',
    });
  }

  it(
    'decodes optional build flags into the BuildRunOptions contract',
    decodesOptionalBuildFlagsIntoTheBuildRunPieceContract,
  );
  function rejectsUnknownTracksBeforeThePipelineRuns() {
    let trackFailure: unknown = null;

    try {
      parseBuildCommandInput('android', { ...BASE_OPTIONS, track: 'beta' });
    } catch (caught) {
      trackFailure = caught;
    }

    expect(trackFailure).toMatchObject({
      message: expect.stringMatching(/Unknown --track "beta"/),
    });
  }

  it('rejects unknown tracks before the pipeline runs', rejectsUnknownTracksBeforeThePipelineRuns);
  function decodesNoCcacheIntoTheBuildRunPieceContract() {
    const buildInput = parseBuildCommandInput('ios', { ...BASE_OPTIONS, ccache: false });
    expect(buildInput.ccache).toBe(false);
  }

  it(
    'decodes --no-ccache into the BuildRunOptions contract',
    decodesNoCcacheIntoTheBuildRunPieceContract,
  );
}

describe(
  'parseBuildCommandInput - raw Commander values to pipeline input',
  describeParseBuildCommandPiecePieceCommanderValuesToPipelinePiece,
);
function describeRegisterBuildCommandTheSizeBudgetFlagAndItsAlias() {
  function buildCommand() {
    const program = new Command();
    registerBuildCommand(program);
    function findCommand(command: Command) {
      return command.name() == 'build';
    }

    return program.commands.find(findCommand);
  }
  function exposesSizeBudgetAndItsBudgetAlias() {
    const storeBuild82 = buildCommand();
    expect(storeBuild82).toBeDefined();
    function readLong(option: CommandOption) {
      return option.long;
    }

    const flags = storeBuild82?.options.map(readLong);
    expect(flags).toContain('--size-budget');
    expect(flags).toContain('--budget');
  }

  it('exposes --size-budget and its --budget alias', exposesSizeBudgetAndItsBudgetAlias);
  function exposesNoCcacheForMonorepoExtensionBuildsThatCannotUseTheRNCcacheShim() {
    const storeBuild89 = buildCommand();
    expect(storeBuild89).toBeDefined();
    function readLong2(option: CommandOption) {
      return option.long;
    }

    const flags = storeBuild89?.options.map(readLong2);
    expect(flags).toContain('--no-ccache');
  }

  it(
    'exposes --no-ccache for monorepo extension builds that cannot use the RN ccache shim',
    exposesNoCcacheForMonorepoExtensionBuildsThatCannotUseTheRNCcacheShim,
  );
  function exposesPieceOffByDefault() {
    const storeBuildJson = buildCommand();
    function findOption(option: CommandOption) {
      return option.long == '--json';
    }

    const jsonOption = storeBuildJson?.options.find(findOption);
    expect(jsonOption).toBeDefined();
    expect(jsonOption?.defaultValue).toBe(false);
  }

  it('exposes --json, off by default', exposesPieceOffByDefault);
}

describe(
  'registerBuildCommand - the size-budget flag and its alias',
  describeRegisterBuildCommandTheSizeBudgetFlagAndItsAlias,
);
