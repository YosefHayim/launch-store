// Turns launch-store build flags into the platform, profile, and submit choices one run uses.

import { parseCliEnv } from '../config/environment-file.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { parsePlatform, PLATFORMS } from '../services/stores/platform.ts';
import type { BuildRunOptions } from './pipeline-types.ts';
import type { Distribution, Platform, PlayTrack } from '../types/app.ts';
import type { RemoteTarget } from '../types/remote.ts';
import type { BumpKind } from '../release/version.ts';

/** Raw `launch-store build` options as Commander hands them to the action callback. */
export type BuildCommandOptions = {
  readonly profile: string;
  readonly app?: string;
  readonly explain: boolean;
  readonly submit: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly verbose: boolean;
  readonly json: boolean;
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
  readonly ccache: boolean;
};

/** A bad `launch-store build` command-line value that failed before the pipeline started. */
type BuildCommandInputError = Readonly<{
  readonly _tag: 'BuildCommandInputError';
  readonly field: string;
  readonly rejectedInput: unknown;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeBuildCommandInputError(fields: {
  field: string;
  rejectedInput: unknown;
  message: string;
  cause?: unknown;
}): BuildCommandInputError {
  const hasCause = fields.cause != null;

  if (hasCause) {
    return {
      _tag: 'BuildCommandInputError',
      field: fields.field,
      rejectedInput: fields.rejectedInput,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return {
    _tag: 'BuildCommandInputError',
    field: fields.field,
    rejectedInput: fields.rejectedInput,
    message: fields.message,
  };
}

function buildCommandInputError(
  field: string,
  rejectedInput: unknown,
  message: string,
  cause?: unknown,
): BuildCommandInputError {
  const hasCause = cause != null;

  if (hasCause == false) {
    return makeBuildCommandInputError({ field, rejectedInput, message });
  }

  return makeBuildCommandInputError({ field, rejectedInput, message, cause });
}

function parseBuildPlatformArgument(platformArgument: string): Platform {
  try {
    return parsePlatform(platformArgument);
  } catch (cause) {
    throw buildCommandInputError(
      'platform',
      platformArgument,
      `Unknown platform "${platformArgument}". Use one of: ${PLATFORMS.join(', ')}.`,
      cause,
    );
  }
}

function parseBuildBump(bump: string | undefined): BumpKind | 'ask' | undefined {
  switch (bump) {
    case undefined:
      return undefined;
    case 'patch':
    case 'minor':
    case 'major':
    case 'keep':
    case 'ask':
      return bump;
    default:
      throw buildCommandInputError(
        'bump',
        bump,
        `Unknown --bump "${bump}". Use one of: ${['patch', 'minor', 'major', 'keep', 'ask'].join(', ')}.`,
      );
  }
}

function parseBuildDistribution(distribution: string | undefined): Distribution {
  switch (distribution) {
    case undefined:
    case 'store':
      return 'store';
    case 'internal':
      return 'internal';
    default:
      throw buildCommandInputError(
        'distribution',
        distribution,
        `Unknown --distribution "${distribution}". Use one of: ${['store', 'internal'].join(', ')}.`,
      );
  }
}

function resolveBuildRemoteTarget(remote: string | boolean | undefined): RemoteTarget | undefined {
  switch (remote) {
    case undefined:
    case false:
      return undefined;
    case true:
    case 'aws':
      return { kind: 'aws' };
    default:
      return { kind: 'ssh', target: remote };
  }
}

function parseBuildTrack(track: string | undefined): PlayTrack | undefined {
  switch (track) {
    case undefined:
      return undefined;
    case 'internal':
    case 'closed':
    case 'open':
    case 'production':
      return track;
    default:
      throw buildCommandInputError(
        'track',
        track,
        `Unknown --track "${track}". Use one of: ${['internal', 'closed', 'open', 'production'].join(', ')}.`,
      );
  }
}

function invalidRollout(rollout: string): BuildCommandInputError {
  return buildCommandInputError(
    'rollout',
    rollout,
    `Invalid --rollout "${rollout}". Pass a fraction between 0 (exclusive) and 1.`,
  );
}

export function parseBuildRollout(rollout: string | undefined): number | undefined {
  const isAbsent = rollout == null;

  if (isAbsent) {
    return undefined;
  }

  const rolloutFraction = Number.parseFloat(rollout);

  const isNotANumber = Number.isNaN(rolloutFraction);

  if (isNotANumber) {
    throw invalidRollout(rollout);
  }

  const isTooSmall = rolloutFraction <= 0;

  if (isTooSmall) {
    throw invalidRollout(rollout);
  }

  const isTooLarge = rolloutFraction > 1;

  if (isTooLarge) {
    throw invalidRollout(rollout);
  }

  return rolloutFraction;
}

function invalidSizeBudget(sizeBudget: string): BuildCommandInputError {
  return buildCommandInputError(
    'sizeBudget',
    sizeBudget,
    `Invalid --size-budget "${sizeBudget}". Pass a size in MB greater than 0.`,
  );
}

export function parseSizeBudget(sizeBudget: string | undefined): number | undefined {
  const isAbsent = sizeBudget == null;

  if (isAbsent) {
    return undefined;
  }

  const sizeBudgetMB = Number.parseFloat(sizeBudget);

  const isNotANumber = Number.isNaN(sizeBudgetMB);

  if (isNotANumber) {
    throw invalidSizeBudget(sizeBudget);
  }

  const isNotPositive = sizeBudgetMB <= 0;

  if (isNotPositive) {
    throw invalidSizeBudget(sizeBudget);
  }

  return sizeBudgetMB;
}

function parseBuildEnvironmentOverrides(envPairs: readonly string[]): Record<string, string> {
  try {
    return parseCliEnv([...envPairs]);
  } catch (cause) {
    let failureMessage = 'Invalid --env flags.';

    const causeHasMessage = hasMessage(cause);

    if (causeHasMessage) {
      failureMessage = cause.message;
    }

    throw buildCommandInputError('env', envPairs, failureMessage, cause);
  }
}

export function parseBuildCommandInput(
  platformArgument: string,
  commandOptions: BuildCommandOptions,
): BuildRunOptions {
  const platform = parseBuildPlatformArgument(platformArgument);
  const remote = resolveBuildRemoteTarget(commandOptions.remote);
  const track = parseBuildTrack(commandOptions.track);
  const rollout = parseBuildRollout(commandOptions.rollout);
  const distribution = parseBuildDistribution(commandOptions.distribution);
  const bump = parseBuildBump(commandOptions.bump);
  let sizeBudgetText = commandOptions.budget;

  const hasSizeBudget = commandOptions.sizeBudget != null;

  if (hasSizeBudget) {
    sizeBudgetText = commandOptions.sizeBudget;
  }

  const sizeBudgetMB = parseSizeBudget(sizeBudgetText);
  const environmentOverrides = parseBuildEnvironmentOverrides(commandOptions.env);
  const buildRunOptions: BuildRunOptions = {
    platform,
    profileName: commandOptions.profile,
    appName: commandOptions.app,
    explain: commandOptions.explain,
    submit: commandOptions.submit,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
    forceClean: commandOptions.clean,
    distribution,
    envOverrides: environmentOverrides,
    includeLocal: commandOptions.includeLocal,
  };

  const hasRemote = remote != null;

  if (hasRemote) {
    buildRunOptions.remote = remote;
  }

  const hasTrack = track != null;

  if (hasTrack) {
    buildRunOptions.track = track;
  }

  const hasRollout = rollout != null;

  if (hasRollout) {
    buildRunOptions.rollout = rollout;
  }

  const hasNotes = commandOptions.notes != null;

  if (hasNotes) {
    buildRunOptions.notesPath = commandOptions.notes;
  }

  const hasAccount = commandOptions.account != null;

  if (hasAccount) {
    buildRunOptions.account = commandOptions.account;
  }

  const hasBump = bump != null;

  if (hasBump) {
    buildRunOptions.bump = bump;
  }

  const hasSizeBudgetMB = sizeBudgetMB != null;

  if (hasSizeBudgetMB) {
    buildRunOptions.sizeBudgetMB = sizeBudgetMB;
  }

  const isCcacheDisabled = commandOptions.ccache == false;

  if (isCcacheDisabled) {
    buildRunOptions.ccache = false;
  }

  return buildRunOptions;
}
