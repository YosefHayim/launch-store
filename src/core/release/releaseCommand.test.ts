import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeHttpClient } from '@effect/platform-node';
import { Cause, Effect, Exit, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { makeReleaseApiFake } from '@testkit/ascReleaseApi.testkit.js';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { makeFakeAscClient } from '@testkit/storeClients.testkit.js';
import type { AppDescriptor } from '../types/app.js';
import type { BuildResource } from '../types/appleCatalog.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import type { AscReleaseApi, ReleaseAction, ReleaseReport } from './appStoreRelease.js';
import {
  androidReleasePlanLines,
  countFailedReleaseActions,
  formatReleaseActionLine,
  isVerifiedStoreBuild,
  makeReleaseCommandFailure,
  newestValidBuild,
  parseAppStoreBuildSelector,
  releaseCommandProgram,
  ReleaseCommandService,
  type ReleaseCommandOptions,
  resolveAndroidRollout,
  resolveVersionString,
  shouldNudgeRelease,
} from './releaseCommand.js';
const storeBuild = (overrides: Partial<BuildResource> = {}): BuildResource => ({
  id: 'b-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
  ...overrides,
});

const releaseAction = (overrides: Partial<ReleaseAction> = {}): ReleaseAction => ({
  description: 'attach build 42',
  status: 'applied',
  ...overrides,
});

const releaseReport = (actions: ReleaseAction[]): ReleaseReport => ({
  bundleId: 'com.acme.app',
  versionId: 'v-1',
  versionString: '1.2.0',
  appStoreState: 'WAITING_FOR_REVIEW',
  submitted: true,
  alreadyInReview: false,
  actions,
});

describe('shouldNudgeRelease - second confirm only for incremental artifacts', () => {
  it('does not nudge a clean (from-scratch) artifact', () => {
    expect(shouldNudgeRelease({ clean: true })).toBe(false);
  });

  it('nudges an incrementally-built artifact before public release', () => {
    expect(shouldNudgeRelease({ clean: false })).toBe(true);
  });
});

describe('isVerifiedStoreBuild / newestValidBuild', () => {
  it('accepts only processed, non-expired builds', () => {
    expect(isVerifiedStoreBuild(storeBuild())).toBe(true);
    expect(isVerifiedStoreBuild(storeBuild({ processingState: 'PROCESSING' }))).toBe(false);
    expect(isVerifiedStoreBuild(storeBuild({ expired: true }))).toBe(false);
  });

  it('returns the first verified build in list order', () => {
    const builds = [
      storeBuild({ id: 'processing', processingState: 'PROCESSING', version: '40' }),
      storeBuild({ id: 'expired', expired: true, version: '41' }),
      storeBuild({ id: 'valid', version: '42' }),
      storeBuild({ id: 'also-valid', version: '43' }),
    ];
    expect(newestValidBuild(builds)?.id).toBe('valid');
  });

  it('returns null when nothing is promotable', () => {
    expect(newestValidBuild([storeBuild({ processingState: 'FAILED' })])).toBeNull();
    expect(newestValidBuild([])).toBeNull();
  });
});

describe('parseAppStoreBuildSelector', () => {
  it('parses latest and numeric selectors', () => {
    expect(parseAppStoreBuildSelector('latest')).toEqual({ kind: 'latest' });
    expect(parseAppStoreBuildSelector('42')).toEqual({ kind: 'number', buildNumber: 42 });
  });

  it('rejects non-numeric selectors that are not latest', () => {
    expect(parseAppStoreBuildSelector('main')).toEqual({ kind: 'invalid', selector: 'main' });
    expect(parseAppStoreBuildSelector('')).toEqual({ kind: 'invalid', selector: '' });
  });
});

describe('resolveVersionString', () => {
  const appDescriptor: AppDescriptor = {
    name: 'acme',
    dir: '.',
    configPath: 'app.json',
    version: '6.11.78',
  };
  const ascClient = { getLatestMarketingVersion: vi.fn(() => Effect.succeed('5.2')) };

  it("uses a promoted build's own marketing version over app.json", async () => {
    const promotedBuild = storeBuild({ version: '591', marketingVersion: '6.11.77' });
    const versionString = await Effect.runPromise(
      resolveVersionString(ascClient, appDescriptor, 'com.acme.app', promotedBuild),
    );
    expect(versionString).toBe('6.11.77');
  });
  it('falls back to app.json when the build has no marketing version', async () => {
    const versionString = await Effect.runPromise(
      resolveVersionString(ascClient, appDescriptor, 'com.acme.app', storeBuild()),
    );
    expect(versionString).toBe('6.11.78');
    expect(ascClient.getLatestMarketingVersion).not.toHaveBeenCalled();
  });
});

describe('resolveAndroidRollout', () => {
  it('prefers the CLI flag over the profile default', () => {
    expect(resolveAndroidRollout(0.25, 0.5)).toBe(0.5);
  });

  it('uses the profile fraction when no flag is passed', () => {
    expect(resolveAndroidRollout(0.1, undefined)).toBe(0.1);
  });

  it('defaults to a full production rollout', () => {
    expect(resolveAndroidRollout(undefined, undefined)).toBe(1);
  });
});

describe('androidReleasePlanLines', () => {
  it('names the build, the production track and the rollout', () => {
    expect(
      androidReleasePlanLines({ version: '1.2.0', buildNumber: 42, clean: true }, 0.2),
    ).toEqual([
      'submit 1.2.0 (42) to the PUBLIC Play production track',
      'roll out to 20% of users',
    ]);
  });

  it('flags an incremental build', () => {
    const planLines = androidReleasePlanLines(
      { version: '1.2.0', buildNumber: 42, clean: false },
      1,
    );
    expect(planLines).toContain(
      'incremental build - run `launch build android --clean` first for a from-scratch artifact',
    );
  });
});

describe('formatReleaseActionLine / countFailedReleaseActions', () => {
  it('renders plan lines with skipped notes', () => {
    expect(
      formatReleaseActionLine(
        releaseAction({ status: 'skipped', note: 'already attached' }),
        'plan',
      ),
    ).toBe('- attach build 42 (already attached)');
  });

  it('renders receipt failures with an error suffix', () => {
    expect(
      formatReleaseActionLine(releaseAction({ status: 'failed', error: 'ASC 409' }), 'receipt'),
    ).toBe('x attach build 42 - ASC 409');
  });

  it('counts only failed steps for the exit code', () => {
    expect(
      countFailedReleaseActions(
        releaseReport([
          releaseAction({ status: 'applied' }),
          releaseAction({ status: 'failed' }),
          releaseAction({ status: 'skipped' }),
          releaseAction({ status: 'failed' }),
        ]),
      ),
    ).toBe(2);
    expect(countFailedReleaseActions(releaseReport([]))).toBe(0);
  });
});

describe('makeReleaseCommandFailure', () => {
  it('tags command failures for the Effect channel', () => {
    const failure = makeReleaseCommandFailure({
      operation: 'upload App Store build',
      message: 'network down',
      cause: new Error('network down'),
    });
    expect(failure._tag).toBe('ReleaseCommandFailure');
    expect(failure.operation).toBe('upload App Store build');
    expect(failure.message).toBe('network down');
  });
});

const ASC_KEY_ID = 'KEY123';
const P8_SECRET = Buffer.from('-----BEGIN PRIVATE KEY-----').toString('base64');
const ACCOUNTS_FILE_TEXT = JSON.stringify({
  active: ASC_KEY_ID,
  accounts: [
    {
      keyId: ASC_KEY_ID,
      issuerId: 'issuer-1',
      label: 'Owner',
      addedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
});
const APP_JSON_TEXT = JSON.stringify({
  expo: { name: 'Oly', version: '1.2.0', ios: { bundleIdentifier: 'com.acme.app' } },
});
const EDITABLE_VERSION = {
  id: 'v-edit',
  versionString: '1.2.0',
  appStoreState: 'PREPARE_FOR_SUBMISSION',
};

interface CommandRun {
  homeDirectory: string;
  platformArgument: string;
  commandOptions: ReleaseCommandOptions;
  releaseApi: AscReleaseApi;
}

interface CommandOutcome {
  exit: Exit.Exit<void, unknown>;
  logLines: string[];
  questions: string[];
}

const commandOptionsFor = (
  overrides: Partial<ReleaseCommandOptions> = {},
): ReleaseCommandOptions => ({
  env: [],
  includeLocal: false,
  printEnv: false,
  profile: 'production',
  explain: false,
  wait: false,
  yes: false,
  json: false,
  ...overrides,
});

const makeAttachApiFake = (methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi =>
  makeReleaseApiFake({
    listAppStoreVersions: vi.fn(() => Effect.succeed([EDITABLE_VERSION])),
    listBuilds: vi.fn(() => Effect.succeed([storeBuild()])),
    findBuild: vi.fn(() => Effect.succeed({ id: 'b-1', usesNonExemptEncryption: false })),
    findBuildByVersion: vi.fn(() => Effect.succeed(storeBuild())),
    ...methodOverrides,
  });

const runInTemporaryHome = async <Result>(
  runWithHome: (homeDirectory: string) => Promise<Result>,
): Promise<Result> => {
  const homeDirectory = createTemporaryHomeDirectory();

  try {
    const workDirectory = join(homeDirectory, 'work');
    mkdirSync(workDirectory, { recursive: true });
    writeFileSync(join(workDirectory, 'app.json'), APP_JSON_TEXT);
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE_TEXT);

    return await runWithHome(homeDirectory);
  } finally {
    removeTemporaryHomeDirectory(homeDirectory);
  }
};

const runReleaseCommand = async (commandRun: CommandRun): Promise<CommandOutcome> => {
  const logLines: string[] = [];
  const questions: string[] = [];
  const appleStoreClientTest = Layer.succeed(AppleStoreClientService, {
    createClient: () => Effect.succeed(commandRun.releaseApi),
    createEffectClient: () => Effect.succeed(makeFakeAscClient([])),
    createReleaseAttributesClient: () => Effect.succeed(makeFakeAscClient([])),
  });
  const releaseCommandTest = Layer.succeed(ReleaseCommandService, {
    terminalIsInteractive: true,
    confirmRelease: (message) =>
      Effect.sync(() => {
        questions.push(message);
        return true;
      }),
    cancelRelease: () => Effect.void,
  });
  const secretStoreTest = makeLaunchSecretStoreTest(new Map([[`asc-p8:${ASC_KEY_ID}`, P8_SECRET]]));

  const releaseProgram = releaseCommandProgram(
    commandRun.platformArgument,
    commandRun.commandOptions,
  ).pipe(
    Effect.provide(makeLaunchHomeTest(commandRun.homeDirectory)),
    Effect.provide(NodeHttpClient.layer),
    Effect.provide(makeLaunchEnvironmentTest({})),
    Effect.provide(secretStoreTest),
    Effect.provide(makeLaunchPromptTest()),
    Effect.provide(makeLaunchLoggerTest(logLines)),
    Effect.provide(appleStoreClientTest),
    Effect.provide(releaseCommandTest),
  );

  const exit = await Effect.runPromiseExit(releaseProgram);

  return { exit, logLines, questions };
};

const failedRunText = (exit: Exit.Exit<void, unknown>): string => {
  const didRunFail = Exit.isFailure(exit);
  if (!didRunFail) return '';

  return Cause.pretty(exit.cause);
};

describe('releaseCommandProgram - attach-only', () => {
  it('fails on Android before any App Store call', async () => {
    const releaseApi = makeReleaseApiFake();

    const outcome = await runInTemporaryHome((homeDirectory) =>
      runReleaseCommand({
        homeDirectory,
        platformArgument: 'android',
        commandOptions: commandOptionsFor({ attachOnly: true }),
        releaseApi,
      }),
    );

    expect(Exit.isFailure(outcome.exit)).toBe(true);
    expect(failedRunText(outcome.exit)).toContain('--attach-only is iOS only');
    expect(releaseApi.getAppId).not.toHaveBeenCalled();
  });

  it('attaches the build to the editable version and never submits it', async () => {
    const releaseApi = makeAttachApiFake();

    const outcome = await runInTemporaryHome((homeDirectory) =>
      runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandOptionsFor({ build: '42', attachOnly: true }),
        releaseApi,
      }),
    );

    expect(Exit.isSuccess(outcome.exit)).toBe(true);
    expect(outcome.logLines.join('\n')).toContain('Build 42 attached - not submitted for review');
    expect(outcome.questions).toContainEqual(
      expect.stringMatching(/^Attach build 42 to .+ without submitting for review\?$/),
    );
    expect(releaseApi.createReviewSubmission).not.toHaveBeenCalled();
  });

  it('titles the receipt with the failed step count when an attach step fails', async () => {
    const releaseApi = makeAttachApiFake({
      selectBuildForVersion: vi.fn(() => Effect.fail(new Error('Apple rejected the build'))),
    });

    const outcome = await runInTemporaryHome((homeDirectory) =>
      runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandOptionsFor({ build: '42', attachOnly: true }),
        releaseApi,
      }),
    );

    expect(outcome.logLines.join('\n')).toContain('Attached with 1 failed step(s) - see below');
    expect(Exit.isFailure(outcome.exit)).toBe(true);
    expect(releaseApi.createReviewSubmission).not.toHaveBeenCalled();
  });

  it('asks to submit and submits for review when attach-only is off', async () => {
    const releaseApi = makeAttachApiFake();

    const outcome = await runInTemporaryHome((homeDirectory) =>
      runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandOptionsFor({ build: '42' }),
        releaseApi,
      }),
    );

    expect(outcome.logLines.join('\n')).toContain('Submitted for App Store review');
    expect(outcome.questions).toContainEqual(
      expect.stringMatching(/^Submit .+ \(build 42\) for App Store review\?$/),
    );
    expect(releaseApi.createReviewSubmission).toHaveBeenCalled();
  });
});
