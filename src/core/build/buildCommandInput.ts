import { Data, Effect } from 'effect';
import { parseCliEnv } from '../config/env.js';
import { parsePlatform, PLATFORMS } from '../services/platform.js';
import type { BuildRunOptions } from './pipelineTypes.js';
import type { Distribution, PlayTrack } from '../types/app.js';
import type { RemoteTarget } from '../types/remote.js';
import type { BumpKind } from '../release/version.js';
/** Raw `launch build` options as Commander hands them to the action callback. */
export type BuildCommandOptions = {
  readonly profile: string;
  readonly app?: string;
  readonly explain: boolean;
  readonly submit: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly verbose: boolean;
  readonly remote?: string | boolean;
  readonly track?: string;
  readonly rollout?: string;
  readonly notes?: string;
  readonly clean: boolean;
  readonly account?: string;
  readonly distribution?: string;
  readonly bump?: string;
  readonly sizeBudget?: string;
  readonly budget?: string;
  readonly env: readonly string[];
  readonly includeLocal: boolean;
  readonly printEnv: boolean;
  readonly ccache: boolean;
};
/** A bad `launch build` command-line value that failed before the pipeline started. */
export type BuildCommandInputError = Readonly<{
  readonly _tag: 'BuildCommandInputError';
  readonly field: string;
  readonly rejectedInput: unknown;
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeBuildCommandInputError =
  Data.tagged<BuildCommandInputError>('BuildCommandInputError');
const BUMP_SELECTORS: readonly (BumpKind | 'ask')[] = ['patch', 'minor', 'major', 'keep', 'ask'];
const DISTRIBUTIONS: readonly Distribution[] = ['store', 'internal'];
const PLAY_TRACKS: readonly PlayTrack[] = ['internal', 'closed', 'open', 'production'];
const buildCommandInputError = (
  field: string,
  rejectedInput: unknown,
  message: string,
  cause?: unknown,
): BuildCommandInputError => {
  if (cause === undefined) return makeBuildCommandInputError({ field, rejectedInput, message });
  return makeBuildCommandInputError({ field, rejectedInput, message, cause });
};
export const parseBuildPlatformArgument = (platformArgument: string) =>
  parsePlatform(platformArgument).pipe(
    Effect.mapError((cause) =>
      buildCommandInputError(
        'platform',
        platformArgument,
        `Unknown platform "${platformArgument}". Use one of: ${PLATFORMS.join(', ')}.`,
        cause,
      ),
    ),
  );
export const parseBuildBump = (bump: string | undefined) =>
  Effect.gen(function* () {
    switch (bump) {
      case undefined:
        return;
      case 'patch':
      case 'minor':
      case 'major':
      case 'keep':
      case 'ask':
        return bump;
      default:
        return yield* Effect.fail(
          buildCommandInputError(
            'bump',
            bump,
            `Unknown --bump "${bump}". Use one of: ${BUMP_SELECTORS.join(', ')}.`,
          ),
        );
    }
  });
export const parseBuildDistribution = (distribution: string | undefined) =>
  Effect.gen(function* () {
    switch (distribution) {
      case undefined:
      case 'store':
        return 'store' satisfies Distribution;
      case 'internal':
        return 'internal' satisfies Distribution;
      default:
        return yield* Effect.fail(
          buildCommandInputError(
            'distribution',
            distribution,
            `Unknown --distribution "${distribution}". Use one of: ${DISTRIBUTIONS.join(', ')}.`,
          ),
        );
    }
  });
export const resolveBuildRemoteTarget = (remote: string | boolean | undefined) =>
  Effect.sync((): RemoteTarget | undefined => {
    switch (remote) {
      case undefined:
      case false:
        return;
      case true:
      case 'aws':
        return { kind: 'aws' };
      default:
        return { kind: 'ssh', target: remote };
    }
  });
export const parseBuildTrack = (track: string | undefined) =>
  Effect.gen(function* () {
    switch (track) {
      case undefined:
        return;
      case 'internal':
      case 'closed':
      case 'open':
      case 'production':
        return track;
      default:
        return yield* Effect.fail(
          buildCommandInputError(
            'track',
            track,
            `Unknown --track "${track}". Use one of: ${PLAY_TRACKS.join(', ')}.`,
          ),
        );
    }
  });
export const parseBuildRollout = (rollout: string | undefined) =>
  Effect.gen(function* () {
    if (rollout === undefined) return;
    const rolloutFraction = Number.parseFloat(rollout);
    if (Number.isNaN(rolloutFraction)) {
      return yield* Effect.fail(
        buildCommandInputError(
          'rollout',
          rollout,
          `Invalid --rollout "${rollout}". Pass a fraction between 0 (exclusive) and 1.`,
        ),
      );
    }
    if (rolloutFraction <= 0) {
      return yield* Effect.fail(
        buildCommandInputError(
          'rollout',
          rollout,
          `Invalid --rollout "${rollout}". Pass a fraction between 0 (exclusive) and 1.`,
        ),
      );
    }
    if (rolloutFraction > 1) {
      return yield* Effect.fail(
        buildCommandInputError(
          'rollout',
          rollout,
          `Invalid --rollout "${rollout}". Pass a fraction between 0 (exclusive) and 1.`,
        ),
      );
    }
    return rolloutFraction;
  });
export const parseSizeBudget = (sizeBudget: string | undefined) =>
  Effect.gen(function* () {
    if (sizeBudget === undefined) return;
    const sizeBudgetMB = Number.parseFloat(sizeBudget);
    if (Number.isNaN(sizeBudgetMB)) {
      return yield* Effect.fail(
        buildCommandInputError(
          'sizeBudget',
          sizeBudget,
          `Invalid --size-budget "${sizeBudget}". Pass a size in MB greater than 0.`,
        ),
      );
    }
    if (sizeBudgetMB <= 0) {
      return yield* Effect.fail(
        buildCommandInputError(
          'sizeBudget',
          sizeBudget,
          `Invalid --size-budget "${sizeBudget}". Pass a size in MB greater than 0.`,
        ),
      );
    }
    return sizeBudgetMB;
  });
export const parseBuildEnvironmentOverrides = (envPairs: readonly string[]) =>
  parseCliEnv([...envPairs]).pipe(
    Effect.mapError((cause) => buildCommandInputError('env', envPairs, cause.message, cause)),
  );
export const parseBuildCommandInput = (
  platformArgument: string,
  commandOptions: BuildCommandOptions,
) =>
  Effect.gen(function* () {
    const platform = yield* parseBuildPlatformArgument(platformArgument);
    const remote = yield* resolveBuildRemoteTarget(commandOptions.remote);
    const track = yield* parseBuildTrack(commandOptions.track);
    const rollout = yield* parseBuildRollout(commandOptions.rollout);
    const distribution = yield* parseBuildDistribution(commandOptions.distribution);
    const bump = yield* parseBuildBump(commandOptions.bump);
    let sizeBudgetText = commandOptions.budget;
    if (commandOptions.sizeBudget !== undefined) sizeBudgetText = commandOptions.sizeBudget;
    const sizeBudgetMB = yield* parseSizeBudget(sizeBudgetText);
    const environmentOverrides = yield* parseBuildEnvironmentOverrides(commandOptions.env);
    const buildRunOptions: BuildRunOptions = {
      platform,
      profileName: commandOptions.profile,
      appName: commandOptions.app,
      explain: commandOptions.explain,
      submit: commandOptions.submit,
      target: 'testing',
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
      forceClean: commandOptions.clean,
      distribution,
      envOverrides: environmentOverrides,
      includeLocal: commandOptions.includeLocal,
      printEnv: commandOptions.printEnv,
    };
    if (remote !== undefined) buildRunOptions.remote = remote;
    if (track !== undefined) buildRunOptions.track = track;
    if (rollout !== undefined) buildRunOptions.rollout = rollout;
    if (commandOptions.notes !== undefined) buildRunOptions.notesPath = commandOptions.notes;
    if (commandOptions.account !== undefined) buildRunOptions.account = commandOptions.account;
    if (bump !== undefined) buildRunOptions.bump = bump;
    if (sizeBudgetMB !== undefined) buildRunOptions.sizeBudgetMB = sizeBudgetMB;
    if (!commandOptions.ccache) buildRunOptions.ccache = false;
    return buildRunOptions;
  });
