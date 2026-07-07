/**
 * Build-command input decoding.
 *
 * Commander owns the flag names and help text. This module owns turning the raw command values into
 * the {@link import("./pipeline.js").BuildRunOptions} shape the build pipeline consumes.
 */

import { Data, Effect } from 'effect';
import { parseCliEnv } from '../config/env.js';
import { parsePlatform, PLATFORMS } from '../services/platform.js';
import type { BuildRunOptions } from './pipeline.js';
import type { Distribution, PlayTrack, RemoteTarget } from '../types/index.js';
import type { BumpKind } from '../release/version.js';

/** Raw `launch build` options as Commander hands them to the action callback. */
export interface BuildCommandOptions {
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
}

/** A bad `launch build` command-line value that failed before the pipeline started. */
export class BuildCommandInputError extends Data.TaggedError('BuildCommandInputError')<{
  readonly field: string;
  readonly value: unknown;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const BUMP_SELECTORS: readonly (BumpKind | 'ask')[] = ['patch', 'minor', 'major', 'keep', 'ask'];
const DISTRIBUTIONS: readonly Distribution[] = ['store', 'internal'];
const PLAY_TRACKS: readonly PlayTrack[] = ['internal', 'closed', 'open', 'production'];

/**
 * Create a typed command-input failure with the rejected field and value attached.
 *
 * @param field - Raw command field that failed validation.
 * @param value - Rejected raw value.
 * @param message - Human-facing failure message.
 * @param cause - Optional underlying parser error from an older boundary helper.
 * @returns A tagged error suitable for `Effect.fail`.
 */
const buildCommandInputError = (
  field: string,
  value: unknown,
  message: string,
  cause?: unknown,
): BuildCommandInputError =>
  new BuildCommandInputError({
    field,
    value,
    message,
    ...(cause === undefined ? {} : { cause }),
  });

/**
 * Parse the required `<platform>` argument into Launch's platform union.
 *
 * @param platformArgument - Raw Commander argument after `launch build`.
 * @returns An Effect that succeeds with a known build platform or fails with a typed input error.
 */
export const parseBuildPlatformArgument = (platformArgument: string) =>
  Effect.try({
    try: () => parsePlatform(platformArgument),
    catch: (cause) =>
      buildCommandInputError(
        'platform',
        platformArgument,
        `Unknown platform "${platformArgument}". Use one of: ${PLATFORMS.join(', ')}.`,
        cause,
      ),
  });

/**
 * Parse `--bump` into the version-bump selector consumed by the pipeline.
 *
 * @param bump - Raw `--bump` value, or undefined when omitted.
 * @returns An Effect that succeeds with a bump selector or undefined.
 */
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

/**
 * Parse `--distribution`, defaulting to the store/testing path.
 *
 * @param distribution - Raw `--distribution` value, or undefined when omitted.
 * @returns An Effect that succeeds with a known distribution mode.
 */
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

/**
 * Parse `--remote` into a concrete remote-build target.
 *
 * @param remote - Commander value for `--remote`, including bare boolean usage.
 * @returns An Effect that succeeds with a remote target or undefined for local builds.
 */
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

/**
 * Parse `--track` into a known Google Play track.
 *
 * @param track - Raw `--track` value, or undefined when omitted.
 * @returns An Effect that succeeds with a Play track or undefined.
 */
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

/**
 * Parse `--rollout` into the 0-1 staged-rollout fraction.
 *
 * @param rollout - Raw `--rollout` value, or undefined when omitted.
 * @returns An Effect that succeeds with a rollout fraction or undefined.
 */
export const parseBuildRollout = (rollout: string | undefined) =>
  Effect.gen(function* () {
    if (rollout === undefined) return;

    const rolloutFraction = Number.parseFloat(rollout);
    if (Number.isNaN(rolloutFraction) || rolloutFraction <= 0 || rolloutFraction > 1) {
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

/**
 * Parse `--size-budget`/`--budget` into a positive MB number.
 *
 * @param sizeBudget - Raw size-budget flag value, or undefined when omitted.
 * @returns An Effect that succeeds with a positive MB value or undefined.
 */
export const parseSizeBudget = (sizeBudget: string | undefined) =>
  Effect.gen(function* () {
    if (sizeBudget === undefined) return;

    const sizeBudgetMB = Number.parseFloat(sizeBudget);
    if (Number.isNaN(sizeBudgetMB) || sizeBudgetMB <= 0) {
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

/**
 * Parse repeated `--env KEY=VALUE` flags into the environment override map.
 *
 * @param envPairs - Raw repeated env flag values.
 * @returns An Effect that succeeds with parsed overrides or fails with a typed input error.
 */
export const parseBuildEnvironmentOverrides = (envPairs: readonly string[]) =>
  Effect.try({
    try: () => parseCliEnv([...envPairs]),
    catch: (cause) =>
      buildCommandInputError(
        'env',
        envPairs,
        cause instanceof Error ? cause.message : 'Invalid --env value.',
        cause,
      ),
  });

/**
 * Decode one raw Commander build invocation into the pipeline's build options.
 *
 * @param platformArgument - Raw `<platform>` argument.
 * @param commandOptions - Raw options object from Commander.
 * @returns An Effect that succeeds with `BuildRunOptions` or fails with a typed input error.
 */
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
    const sizeBudgetMB = yield* parseSizeBudget(commandOptions.sizeBudget ?? commandOptions.budget);
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
    if (commandOptions.account !== undefined) buildRunOptions.account = commandOptions.account;
    if (bump !== undefined) buildRunOptions.bump = bump;
    if (sizeBudgetMB !== undefined) buildRunOptions.sizeBudgetMB = sizeBudgetMB;
    if (!commandOptions.ccache) buildRunOptions.ccache = false;

    return buildRunOptions;
  });
