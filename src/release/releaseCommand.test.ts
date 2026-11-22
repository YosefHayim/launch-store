import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { resetSecretStore, useSecretStore } from '@/services/credentials/secretStore.js';
import { resetLogger, useLoggerSink } from '@/services/platform/logger.js';
import { resetLaunchDirectories, useLaunchDirectories } from '@/services/platform/paths.js';
import { useAppleStoreClientFactory } from '@/services/stores/appleStoreClient.js';
import type { AppDescriptor } from '../types/app.js';
import type { BuildResource } from '../types/appleCatalog.js';
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
  type ReleaseCommandOptions,
  type ReleaseCommandService,
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
  const ascClient = {
    getLatestMarketingVersion: vi.fn(function readMarketingVersion() {
      return Promise.resolve('5.2');
    }),
  };

  it("uses a promoted build's own marketing version over app.json", async () => {
    const promotedBuild = storeBuild({ version: '591', marketingVersion: '6.11.77' });
    const versionString = await resolveVersionString(
      ascClient,
      appDescriptor,
      'com.acme.app',
      promotedBuild,
    );
    expect(versionString).toBe('6.11.77');
  });
  it('falls back to app.json when the build has no marketing version', async () => {
    const versionString = await resolveVersionString(
      ascClient,
      appDescriptor,
      'com.acme.app',
      storeBuild(),
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
  failure: unknown;
  logLines: string[];
  questions: string[];
}

function commandOptionsFor(overrides: Partial<ReleaseCommandOptions> = {}): ReleaseCommandOptions {
  return {
    env: [],
    includeLocal: false,
    printEnv: false,
    profile: 'production',
    explain: false,
    wait: false,
    yes: false,
    json: false,
    ...overrides,
  };
}

function makeReleaseApiFake(methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  const releaseApi: AscReleaseApi = {
    getAppId: vi.fn(function readAppId() {
      return Promise.resolve('app-1');
    }),
    getLatestMarketingVersion: vi.fn(function readMarketingVersion() {
      return Promise.resolve(null);
    }),
    listBuilds: vi.fn(function readBuilds() {
      return Promise.resolve([storeBuild()]);
    }),
    findBuild: vi.fn(function readBuild() {
      return Promise.resolve({ id: 'b-1', usesNonExemptEncryption: false });
    }),
    findBuildByVersion: vi.fn(function readBuildByVersion() {
      return Promise.resolve(storeBuild());
    }),
    setBuildUsesNonExemptEncryption: vi.fn(function setEncryption() {
      return Promise.resolve();
    }),
    listAppStoreVersions: vi.fn(function readVersions() {
      return Promise.resolve([EDITABLE_VERSION]);
    }),
    createAppStoreVersion: vi.fn(function createVersion() {
      return Promise.resolve(EDITABLE_VERSION);
    }),
    updateAppStoreVersion: vi.fn(function updateVersion() {
      return Promise.resolve();
    }),
    selectBuildForVersion: vi.fn(function selectBuild() {
      return Promise.resolve();
    }),
    listAppStoreVersionLocalizations: vi.fn(function readLocalizations() {
      return Promise.resolve([]);
    }),
    createAppStoreVersionLocalization: vi.fn(function createLocalization() {
      return Promise.resolve({ id: 'loc-new', locale: 'en-US' });
    }),
    updateAppStoreVersionLocalization: vi.fn(function updateLocalization() {
      return Promise.resolve();
    }),
    getPhasedRelease: vi.fn(function readPhasedRelease() {
      return Promise.resolve(null);
    }),
    createPhasedRelease: vi.fn(function createPhasedRelease() {
      return Promise.resolve({ id: 'ph-new', phasedReleaseState: 'ACTIVE' });
    }),
    deletePhasedRelease: vi.fn(function deletePhasedRelease() {
      return Promise.resolve();
    }),
    listReviewSubmissions: vi.fn(function readReviewSubmissions() {
      return Promise.resolve([]);
    }),
    createReviewSubmission: vi.fn(function createReviewSubmission() {
      return Promise.resolve({ id: 'rs1', state: 'READY_FOR_REVIEW' });
    }),
    addReviewSubmissionItem: vi.fn(function addReviewItem() {
      return Promise.resolve();
    }),
    submitReviewSubmission: vi.fn(function submitReview() {
      return Promise.resolve();
    }),
    getReviewSubmission: vi.fn(function readReviewSubmission() {
      return Promise.resolve({ id: 'rs1', state: 'WAITING_FOR_REVIEW' });
    }),
    createAppStoreVersionReleaseRequest: vi.fn(function releaseVersion() {
      return Promise.resolve();
    }),
  };

  return { ...releaseApi, ...methodOverrides };
}

async function runInTemporaryHome<Result>(
  runWithHome: (homeDirectory: string) => Promise<Result>,
): Promise<Result> {
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
}

async function runReleaseCommand(commandRun: CommandRun): Promise<CommandOutcome> {
  const logLines: string[] = [];
  const questions: string[] = [];
  const commandService: ReleaseCommandService = {
    terminalIsInteractive: true,
    confirmRelease: function confirmRelease(message: string) {
      questions.push(message);

      return Promise.resolve(true);
    },
    cancelRelease: function cancelRelease() {},
  };

  useLaunchDirectories({
    homeDirectory: commandRun.homeDirectory,
    workingDirectory: join(commandRun.homeDirectory, 'work'),
  });
  useSecretStore(new Map([[`asc-p8:${ASC_KEY_ID}`, P8_SECRET]]));
  useLoggerSink(function writeLine(text: string) {
    logLines.push(text);
  });
  useAppleStoreClientFactory(function createClient() {
    return commandRun.releaseApi as ReturnType<
      typeof import('@/services/stores/appleStoreClient.js').AppleStoreClientService.createClient
    >;
  });

  try {
    await releaseCommandProgram(
      commandRun.platformArgument,
      commandRun.commandOptions,
      commandService,
    );

    return { failure: null, logLines, questions };
  } catch (failure) {
    return { failure, logLines, questions };
  } finally {
    resetLaunchDirectories();
    resetSecretStore();
    resetLogger();
    useAppleStoreClientFactory(null);
  }
}

afterEach(function resetReleaseDoubles() {
  resetLaunchDirectories();
  resetSecretStore();
  resetLogger();
  useAppleStoreClientFactory(null);
});

describe('releaseCommandProgram - attach-only', () => {
  it('fails on Android before any App Store call', async () => {
    const releaseApi = makeReleaseApiFake();
    const outcome = await runInTemporaryHome(function runAndroidAttach(homeDirectory) {
      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'android',
        commandOptions: commandOptionsFor({ attachOnly: true }),
        releaseApi,
      });
    });

    expect(outcome.failure).toMatchObject({
      message: expect.stringContaining('--attach-only is iOS only'),
    });
    expect(releaseApi.getAppId).not.toHaveBeenCalled();
  });

  it('attaches the build to the editable version and never submits it', async () => {
    const releaseApi = makeReleaseApiFake();
    const outcome = await runInTemporaryHome(function runAttach(homeDirectory) {
      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandOptionsFor({ build: '42', attachOnly: true }),
        releaseApi,
      });
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.logLines.join('\n')).toContain('Build 42 attached - not submitted for review');
    expect(outcome.questions).toContainEqual(
      expect.stringMatching(/^Attach build 42 to .+ without submitting for review\?$/),
    );
    expect(releaseApi.createReviewSubmission).not.toHaveBeenCalled();
  });

  it('titles the receipt with the failed step count when an attach step fails', async () => {
    const releaseApi = makeReleaseApiFake({
      selectBuildForVersion: vi.fn(function rejectBuild() {
        throw new Error('Apple rejected the build');
      }),
    });
    const outcome = await runInTemporaryHome(function runFailedAttach(homeDirectory) {
      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandOptionsFor({ build: '42', attachOnly: true }),
        releaseApi,
      });
    });

    expect(outcome.logLines.join('\n')).toContain('Attached with 1 failed step(s) - see below');
    expect(outcome.failure).toMatchObject({ _tag: 'CommandExit', exitCode: 1 });
    expect(releaseApi.createReviewSubmission).not.toHaveBeenCalled();
  });

  it('asks to submit and submits for review when attach-only is off', async () => {
    const releaseApi = makeReleaseApiFake();
    const outcome = await runInTemporaryHome(function runSubmit(homeDirectory) {
      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandOptionsFor({ build: '42' }),
        releaseApi,
      });
    });

    expect(outcome.logLines.join('\n')).toContain('Submitted for App Store review');
    expect(outcome.questions).toContainEqual(
      expect.stringMatching(/^Submit .+ \(build 42\) for App Store review\?$/),
    );
    expect(releaseApi.createReviewSubmission).toHaveBeenCalled();
  });
});
