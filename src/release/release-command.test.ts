import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/temporary-launch-home.ts';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { setAppleStoreClient } from '../services/stores/apple-store-client.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { BuildResource } from '../types/apple/builds.ts';
import type { AscReleaseApi, ReleaseAction, ReleaseReport } from './app-store-release.ts';
import {
  androidReleasePlanLines,
  countFailedReleaseActions,
  formatReleaseActionLine,
  isVerifiedStoreBuild,
  newestValidBuild,
  parseAppStoreBuildSelector,
  releaseCommandProgram,
  type ReleaseCommandOptions,
  type ReleaseCommandService,
  readAndroidRollout,
  readVersionString,
  shouldNudgeRelease,
} from './release-command.ts';

function storeBuild(overrides: Partial<BuildResource> = {}): BuildResource {
  return {
    id: 'b-1',
    version: '42',
    processingState: 'VALID',
    expired: false,
    ...overrides,
  };
}

function releaseAction(overrides: Partial<ReleaseAction> = {}): ReleaseAction {
  return {
    description: 'attach build 42',
    status: 'applied',
    ...overrides,
  };
}

function releaseReport(actions: ReleaseAction[]): ReleaseReport {
  return {
    bundleId: 'com.acme.app',
    versionId: 'v-1',
    versionString: '1.2.0',
    appStoreState: 'WAITING_FOR_REVIEW',
    submitted: true,
    alreadyInReview: false,
    actions,
  };
}

function describeShouldNudgeReleaseSecondConfirmOnlyForIncrementalArtifacts() {
  function doesNotNudgeACleanFromScratchArtifact() {
    expect(shouldNudgeRelease({ clean: true })).toBe(false);
  }

  it('does not nudge a clean (from-scratch) artifact', doesNotNudgeACleanFromScratchArtifact);

  function nudgesAnIncrementallyBuiltArtifactBeforePublicRelease() {
    expect(shouldNudgeRelease({ clean: false })).toBe(true);
  }

  it(
    'nudges an incrementally-built artifact before public release',
    nudgesAnIncrementallyBuiltArtifactBeforePublicRelease,
  );
}

describe(
  'shouldNudgeRelease - second confirm only for incremental artifacts',
  describeShouldNudgeReleaseSecondConfirmOnlyForIncrementalArtifacts,
);

function describeIsVerifiedStoreBuildNewestValidBuild() {
  function acceptsOnlyProcessedNonExpiredBuilds() {
    const buildProgram = storeBuild();
    expect(isVerifiedStoreBuild(buildProgram)).toBe(true);
    expect(isVerifiedStoreBuild(storeBuild({ processingState: 'PROCESSING' }))).toBe(false);
    expect(isVerifiedStoreBuild(storeBuild({ expired: true }))).toBe(false);
  }

  it('accepts only processed, non-expired builds', acceptsOnlyProcessedNonExpiredBuilds);

  function returnsTheFirstVerifiedBuildInListOrder() {
    const builds = [
      storeBuild({ id: 'processing', processingState: 'PROCESSING', version: '40' }),
      storeBuild({ id: 'expired', expired: true, version: '41' }),
      storeBuild({ id: 'valid', version: '42' }),
      storeBuild({ id: 'also-valid', version: '43' }),
    ];
    const buildProgram = newestValidBuild(builds);

    expect(buildProgram?.id).toBe('valid');
  }

  it('returns the first verified build in list order', returnsTheFirstVerifiedBuildInListOrder);

  function returnsNullWhenNothingIsPromotable() {
    const buildProgram = storeBuild({ processingState: 'FAILED' });
    expect(newestValidBuild([buildProgram])).toBeNull();
    expect(newestValidBuild([])).toBeNull();
  }

  it('returns null when nothing is promotable', returnsNullWhenNothingIsPromotable);
}

describe('isVerifiedStoreBuild / newestValidBuild', describeIsVerifiedStoreBuildNewestValidBuild);

function describeParseAppStoreBuildSelector() {
  function parsesLatestAndNumericSelectors() {
    const appStoreBuildSelector = parseAppStoreBuildSelector('latest');
    expect(appStoreBuildSelector).toEqual({ kind: 'latest' });
    expect(parseAppStoreBuildSelector('42')).toEqual({ kind: 'number', buildNumber: 42 });
  }

  it('parses latest and numeric selectors', parsesLatestAndNumericSelectors);

  function rejectsNonNumericSelectorsThatAreNotLatest() {
    const appStoreBuildSelector = parseAppStoreBuildSelector('main');
    expect(appStoreBuildSelector).toEqual({ kind: 'invalid', selector: 'main' });
    expect(parseAppStoreBuildSelector('')).toEqual({ kind: 'invalid', selector: '' });
  }

  it(
    'rejects non-numeric selectors that are not latest',
    rejectsNonNumericSelectorsThatAreNotLatest,
  );
}

describe('parseAppStoreBuildSelector', describeParseAppStoreBuildSelector);

function describeResolveVersionString() {
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

  async function usesAPromotedBuildSOwnMarketingVersionOverAppPiece() {
    const promotedBuild = storeBuild({ version: '591', marketingVersion: '6.11.77' });
    const versionString = await readVersionString(
      ascClient,
      appDescriptor,
      'com.acme.app',
      promotedBuild,
    );

    expect(versionString).toBe('6.11.77');
  }

  it(
    "uses a promoted build's own marketing version over app.json",
    usesAPromotedBuildSOwnMarketingVersionOverAppPiece,
  );

  async function fallsBackToAppPieceWhenTheBuildHasNoMarketingVersion() {
    const buildProgram = storeBuild();
    const versionString = await readVersionString(
      ascClient,
      appDescriptor,
      'com.acme.app',
      buildProgram,
    );

    expect(versionString).toBe('6.11.78');
    expect(ascClient.getLatestMarketingVersion).not.toHaveBeenCalled();
  }

  it(
    'falls back to app.json when the build has no marketing version',
    fallsBackToAppPieceWhenTheBuildHasNoMarketingVersion,
  );
}

describe('readVersionString', describeResolveVersionString);

function describeResolveAndroidRollout() {
  function prefersTheCLIFlagOverTheProfileDefault() {
    const androidRollout = readAndroidRollout(0.25, 0.5);
    expect(androidRollout).toBe(0.5);
  }

  it('prefers the CLI flag over the profile default', prefersTheCLIFlagOverTheProfileDefault);

  function usesTheProfileFractionWhenNoFlagIsPassed() {
    const androidRollout = readAndroidRollout(0.1, undefined);
    expect(androidRollout).toBe(0.1);
  }

  it('uses the profile fraction when no flag is passed', usesTheProfileFractionWhenNoFlagIsPassed);

  function defaultsToAFullProductionRollout() {
    const androidRollout = readAndroidRollout(undefined, undefined);
    expect(androidRollout).toBe(1);
  }

  it('defaults to a full production rollout', defaultsToAFullProductionRollout);
}

describe('readAndroidRollout', describeResolveAndroidRollout);

function describeAndroidReleasePlanLines() {
  function namesTheBuildTheProductionTrackAndTheRollout() {
    expect(
      androidReleasePlanLines({ version: '1.2.0', buildNumber: 42, clean: true }, 0.2),
    ).toEqual([
      'submit 1.2.0 (42) to the PUBLIC Play production track',
      'roll out to 20% of users',
    ]);
  }

  it(
    'names the build, the production track and the rollout',
    namesTheBuildTheProductionTrackAndTheRollout,
  );

  function flagsAnIncrementalBuild() {
    const planLines = androidReleasePlanLines(
      { version: '1.2.0', buildNumber: 42, clean: false },
      1,
    );

    expect(planLines).toContain(
      'incremental build - run `launch-store build android --clean` first for a from-scratch artifact',
    );
  }

  it('flags an incremental build', flagsAnIncrementalBuild);
}

describe('androidReleasePlanLines', describeAndroidReleasePlanLines);

function describeFormatReleaseActionLineCountFailedReleaseActions() {
  function rendersPlanLinesWithSkippedNotes() {
    const releaseActionLine = formatReleaseActionLine(
      releaseAction({ status: 'skipped', note: 'already attached' }),
      'plan',
    );

    expect(releaseActionLine).toBe('- attach build 42 (already attached)');
  }

  it('renders plan lines with skipped notes', rendersPlanLinesWithSkippedNotes);

  function rendersReceiptFailuresWithAnErrorSuffix() {
    const releaseActionLine = formatReleaseActionLine(
      releaseAction({ status: 'failed', error: 'ASC 409' }),
      'receipt',
    );

    expect(releaseActionLine).toBe('x attach build 42 - ASC 409');
  }

  it('renders receipt failures with an error suffix', rendersReceiptFailuresWithAnErrorSuffix);

  function countsOnlyFailedStepsForTheExitCode() {
    const failedReleaseActions = countFailedReleaseActions(
      releaseReport([
        releaseAction({ status: 'applied' }),
        releaseAction({ status: 'failed' }),
        releaseAction({ status: 'skipped' }),
        releaseAction({ status: 'failed' }),
      ]),
    );

    expect(failedReleaseActions).toBe(2);
    expect(countFailedReleaseActions(releaseReport([]))).toBe(0);
  }

  it('counts only failed steps for the exit code', countsOnlyFailedStepsForTheExitCode);
}

describe(
  'formatReleaseActionLine / countFailedReleaseActions',
  describeFormatReleaseActionLineCountFailedReleaseActions,
);

const ASC_KEY_ID = 'KEY123';
const p8Secret = Buffer.from('-----BEGIN PRIVATE KEY-----').toString('base64');
const accountsFileText = JSON.stringify({
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
const appJsonText = JSON.stringify({
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
      const buildProgram = storeBuild();
      return Promise.resolve([buildProgram]);
    }),
    findBuild: vi.fn(function readBuild() {
      return Promise.resolve({ id: 'b-1', usesNonExemptEncryption: false });
    }),
    findBuildByVersion: vi.fn(function readBuildByVersion() {
      const buildProgram = storeBuild();
      return Promise.resolve(buildProgram);
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

    const appPath = join(workDirectory, 'app.json');

    writeFileSync(appPath, appJsonText);
    writeLaunchHomeFile(homeDirectory, 'accounts.json', accountsFileText);

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

  const workPath = join(commandRun.homeDirectory, 'work');

  useLaunchDirectories({
    homeDirectory: commandRun.homeDirectory,
    workingDirectory: workPath,
  });
  useSecretStore(new Map([[`asc-p8:${ASC_KEY_ID}`, p8Secret]]));
  useLoggerSink(function writeLine(text: string) {
    logLines.push(text);
  });
  setAppleStoreClient(function createClient() {
    return commandRun.releaseApi as ReturnType<
      InstanceType<
        typeof import('../services/stores/apple-store-client.ts').AppleStoreClientService
      >['createClient']
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
    setAppleStoreClient(null);
  }
}

afterEach(function resetReleaseDoubles() {
  resetLaunchDirectories();
  resetSecretStore();
  resetLogger();
  setAppleStoreClient(null);
});

function describeReleaseCommandProgramAttachOnly() {
  async function failsOnAndroidBeforeAnyAppStoreCall() {
    const releaseApi = makeReleaseApiFake();
    const outcome = await runInTemporaryHome(function runAndroidAttach(homeDirectory) {
      const commandFor = commandOptionsFor({ attachOnly: true });

      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'android',
        commandOptions: commandFor,
        releaseApi,
      });
    });

    expect(outcome.failure).toMatchObject({
      message: expect.stringContaining('--attach-only is iOS only'),
    });
    expect(releaseApi.getAppId).not.toHaveBeenCalled();
  }

  it('fails on Android before any App Store call', failsOnAndroidBeforeAnyAppStoreCall);

  async function attachesTheBuildToTheEditableVersionAndNeverSubmitsIt() {
    const releaseApi = makeReleaseApiFake();
    const outcome = await runInTemporaryHome(function runAttach(homeDirectory) {
      const commandFor = commandOptionsFor({ build: '42', attachOnly: true });

      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandFor,
        releaseApi,
      });
    });

    expect(outcome.failure).toBeNull();
    expect(outcome.logLines.join('\n')).toContain('Build 42 attached - not submitted for review');
    expect(outcome.questions).toContainEqual(
      expect.stringMatching(/^Attach build 42 to .+ without submitting for review\?$/),
    );
    expect(releaseApi.createReviewSubmission).not.toHaveBeenCalled();
  }

  it(
    'attaches the build to the editable version and never submits it',
    attachesTheBuildToTheEditableVersionAndNeverSubmitsIt,
  );

  async function titlesTheReceiptWithTheFailedStepCountWhenAnAttachStepFails() {
    const releaseApi = makeReleaseApiFake({
      selectBuildForVersion: vi.fn(function rejectBuild() {
        throw new Error('Apple rejected the build');
      }),
    });
    const outcome = await runInTemporaryHome(function runFailedAttach(homeDirectory) {
      const commandFor = commandOptionsFor({ build: '42', attachOnly: true });

      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandFor,
        releaseApi,
      });
    });

    expect(outcome.logLines.join('\n')).toContain('Attached with 1 failed step(s) - see below');
    expect(outcome.failure).toMatchObject({ _tag: 'CommandExit', exitCode: 1 });
    expect(releaseApi.createReviewSubmission).not.toHaveBeenCalled();
  }

  it(
    'titles the receipt with the failed step count when an attach step fails',
    titlesTheReceiptWithTheFailedStepCountWhenAnAttachStepFails,
  );

  async function asksToSubmitAndSubmitsForReviewWhenAttachOnlyIsOff() {
    const releaseApi = makeReleaseApiFake();
    const outcome = await runInTemporaryHome(function runSubmit(homeDirectory) {
      const commandFor = commandOptionsFor({ build: '42' });

      return runReleaseCommand({
        homeDirectory,
        platformArgument: 'ios',
        commandOptions: commandFor,
        releaseApi,
      });
    });

    expect(outcome.logLines.join('\n')).toContain('Submitted for App Store review');
    expect(outcome.questions).toContainEqual(
      expect.stringMatching(/^Submit .+ \(build 42\) for App Store review\?$/),
    );
    expect(releaseApi.createReviewSubmission).toHaveBeenCalled();
  }

  it(
    'asks to submit and submits for review when attach-only is off',
    asksToSubmitAndSubmitsForReviewWhenAttachOnlyIsOff,
  );
}

describe('releaseCommandProgram - attach-only', describeReleaseCommandProgramAttachOnly);
