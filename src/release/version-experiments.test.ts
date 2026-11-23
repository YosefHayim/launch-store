import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalScreenshot } from '../listing/screenshots/assets.ts';
import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  ReviewSubmissionResource,
  ScreenshotResource,
  ScreenshotSetResource,
  VersionExperimentResource,
} from '../types/apple-catalog.ts';
import {
  type AscExperimentsApi,
  discoverTreatmentScreenshots,
  type ExperimentsReconcileInput,
  loadVersionExperimentsConfig,
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
  summarizeExperiments,
  type TreatmentConfig,
  type VersionExperimentsConfig,
} from './version-experiments.ts';
import type { ActionStatus } from '../types/reconcile.ts';
import type { LocalAsset } from '../listing/screenshots/assets.ts';

type ExperimentWrites = {
  createdExperiments: Array<{
    name: string;
    platform: string;
    trafficProportion: number;
  }>;
  createdTreatments: Array<{ experimentId: string; name: string }>;
  createdLocalizations: Array<{ treatmentId: string; locale: string }>;
  createdSets: Array<{ localizationId: string; displayType: string }>;
  uploads: Array<{ setId: string; fileName: string }>;
  removedScreenshots: string[];
  reorders: Array<{ setId: string; screenshotIds: readonly string[] }>;
  createdSubmissions: string[];
  reviewItems: Array<{ submissionId: string; experimentId: string }>;
  submittedSubmissions: string[];
  startedExperiments: string[];
};

type ExperimentStoreState = {
  appId: string | null;
  experiments: VersionExperimentResource[];
  treatments: ExperimentTreatmentResource[];
  localizations: ExperimentTreatmentLocalizationResource[];
  screenshotSetsByLocalization: Record<string, ScreenshotSetResource[]>;
  screenshotsBySet: Record<string, ScreenshotResource[]>;
  reviewSubmissions: ReviewSubmissionResource[];
};

/** Build an experiments API fake and its write journal. */
function makeExperimentsApi(
  stateOverrides: Partial<ExperimentStoreState>,
  methodOverrides: Partial<AscExperimentsApi> = {},
): Readonly<{ appleExperimentsApi: AscExperimentsApi; experimentWrites: ExperimentWrites }> {
  const experimentStore: ExperimentStoreState = {
    appId: 'app-1',
    experiments: [],
    treatments: [],
    localizations: [],
    screenshotSetsByLocalization: {},
    screenshotsBySet: {},
    reviewSubmissions: [],
    ...stateOverrides,
  };
  const experimentWrites: ExperimentWrites = {
    createdExperiments: [],
    createdTreatments: [],
    createdLocalizations: [],
    createdSets: [],
    uploads: [],
    removedScreenshots: [],
    reorders: [],
    createdSubmissions: [],
    reviewItems: [],
    submittedSubmissions: [],
    startedExperiments: [],
  };
  const appleExperimentsApi: AscExperimentsApi = {
    getAppId() {
      return Promise.resolve(experimentStore.appId);
    },
    listVersionExperiments() {
      return Promise.resolve(experimentStore.experiments);
    },
    createVersionExperiment(_appId, experimentInput) {
      experimentWrites.createdExperiments.push(experimentInput);
      return Promise.resolve({
        id: 'exp-new',
        name: experimentInput.name,
        state: 'PREPARE_FOR_SUBMISSION',
      });
    },
    listExperimentTreatments() {
      return Promise.resolve(experimentStore.treatments);
    },
    createExperimentTreatment(experimentId, treatmentInput) {
      experimentWrites.createdTreatments.push({
        experimentId,
        name: treatmentInput.name,
      });
      return Promise.resolve({ id: 'treat-new', name: treatmentInput.name });
    },
    startVersionExperiment(experimentId) {
      experimentWrites.startedExperiments.push(experimentId);
      return Promise.resolve();
    },
    listExperimentTreatmentLocalizations() {
      return Promise.resolve(experimentStore.localizations);
    },
    createExperimentTreatmentLocalization(treatmentId, locale) {
      experimentWrites.createdLocalizations.push({ treatmentId, locale });
      return Promise.resolve({ id: `loc-${locale}`, locale });
    },
    listTreatmentScreenshotSets(localizationId) {
      let localizationSets = experimentStore.screenshotSetsByLocalization[localizationId];
      if (localizationSets == null) localizationSets = [];
      return Promise.resolve(localizationSets);
    },
    createTreatmentScreenshotSet(localizationId, displayType) {
      experimentWrites.createdSets.push({ localizationId, displayType });
      return Promise.resolve({ id: `set-${localizationId}`, screenshotDisplayType: displayType });
    },
    listScreenshots(setId) {
      let setScreenshots = experimentStore.screenshotsBySet[setId];
      if (setScreenshots == null) setScreenshots = [];
      return Promise.resolve(setScreenshots);
    },
    uploadScreenshot(setId, fileName) {
      experimentWrites.uploads.push({ setId, fileName });
      let setScreenshots = experimentStore.screenshotsBySet[setId];
      if (setScreenshots == null) setScreenshots = [];
      const uploadedId = `up-${fileName}`;
      // Apple fills sourceFileChecksum only after it processes the upload.
      experimentStore.screenshotsBySet[setId] = [...setScreenshots, { id: uploadedId, fileName }];
      return Promise.resolve(uploadedId);
    },
    deleteScreenshot(screenshotId) {
      experimentWrites.removedScreenshots.push(screenshotId);
      for (const [setId, setScreenshots] of Object.entries(experimentStore.screenshotsBySet)) {
        function filterScreenshot(screenshot: {
          readonly id: string;
          readonly fileName: string;
          readonly sourceFileChecksum?: string;
          readonly assetDeliveryState?: string;
        }) {
          return screenshot.id != screenshotId;
        }

        experimentStore.screenshotsBySet[setId] = setScreenshots.filter(filterScreenshot);
      }
      return Promise.resolve();
    },
    reorderScreenshots(setId, screenshotIds) {
      experimentWrites.reorders.push({ setId, screenshotIds });
      return Promise.resolve();
    },
    listReviewSubmissions() {
      return Promise.resolve(experimentStore.reviewSubmissions);
    },
    createReviewSubmission(_appId, platform) {
      experimentWrites.createdSubmissions.push(platform);
      return Promise.resolve({ id: 'sub-new', state: 'READY_FOR_REVIEW' });
    },
    addExperimentReviewSubmissionItem(submissionId, experimentId) {
      experimentWrites.reviewItems.push({ submissionId, experimentId });
      return Promise.resolve();
    },
    submitReviewSubmission(submissionId) {
      experimentWrites.submittedSubmissions.push(submissionId);
      return Promise.resolve();
    },
    ...methodOverrides,
  };
  return { appleExperimentsApi, experimentWrites };
}

const experimentConfig: VersionExperimentsConfig = {
  experiments: [
    {
      name: 'Icon Test',
      trafficProportion: 50,
      treatments: [{ name: 'Variant A' }, { name: 'Variant B' }],
    },
  ],
};

const mediaConfig: VersionExperimentsConfig = {
  experiments: [
    {
      name: 'Screenshots Test',
      trafficProportion: 50,
      treatments: [{ name: 'Colorful', screenshots: 'treatment' }],
    },
  ],
};

/** Where a fixture treatment screenshot lives; also its checksum. */
function screenshotPath(locale: string, fileName: string): string {
  return `/treatment/${locale}/APP_IPHONE_67/${fileName}`;
}

/** One local treatment screenshot whose checksum is its path. */
function localScreenshot(locale: string, fileName: string): LocalScreenshot {
  return {
    locale,
    displayType: 'APP_IPHONE_67',
    fileName,
    path: screenshotPath(locale, fileName),
    checksum: screenshotPath(locale, fileName),
    size: 1,
  };
}

/** A screenshot Apple already holds whose checksum matches the local file. */
function storedScreenshot(id: string, locale: string, fileName: string): ScreenshotResource {
  return {
    id,
    fileName,
    sourceFileChecksum: screenshotPath(locale, fileName),
  };
}

/** A copy of an original-page screenshot that Apple put in a new treatment localization. */
function originalScreenshot(id: string, fileName: string): ScreenshotResource {
  return {
    id,
    fileName,
    sourceFileChecksum: `original-${fileName}`,
  };
}

/** Two existing treatment localizations with one 6.7-inch set each. */
const existingLocaleSets: Partial<ExperimentStoreState> = {
  localizations: [
    { id: 'loc-1', locale: 'en-US' },
    { id: 'loc-2', locale: 'he' },
  ],
  screenshotSetsByLocalization: {
    'loc-1': [{ id: 'set-1', screenshotDisplayType: 'APP_IPHONE_67' }],
    'loc-2': [{ id: 'set-2', screenshotDisplayType: 'APP_IPHONE_67' }],
  },
};

const treatmentScreenshots = new Map([
  [
    'treatment',
    [
      localScreenshot('en-US', '01.png'),
      localScreenshot('en-US', '02.png'),
      localScreenshot('he', '01.png'),
    ],
  ],
]);

const existingScreenshotsExperiment: VersionExperimentResource = {
  id: 'exp-1',
  name: 'Screenshots Test',
  state: 'PREPARE_FOR_SUBMISSION',
};

/** Run the shared experiment fixture in plan or apply mode. */
function reconcileExperiments(appleExperimentsApi: AscExperimentsApi, dryRun: boolean) {
  return reconcileVersionExperiments(appleExperimentsApi, {
    bundleId: 'com.acme.app',
    config: experimentConfig,
    treatmentScreenshots: new Map(),
    submit: false,
    start: false,
    dryRun,
  });
}

/** Run the screenshot-treatment fixture with the given lifecycle flags. */
function reconcileMediaExperiments(
  appleExperimentsApi: AscExperimentsApi,
  inputOverrides: Partial<ExperimentsReconcileInput>,
) {
  return reconcileVersionExperiments(appleExperimentsApi, {
    bundleId: 'com.acme.app',
    config: mediaConfig,
    treatmentScreenshots,
    submit: false,
    start: false,
    dryRun: false,
    ...inputOverrides,
  });
}
function readDescription(plannedAction: {
  readonly description: string;
  readonly destructive: boolean;
  status: ActionStatus;
  error?: string;
}) {
  return plannedAction.description;
}

/** The descriptions of a report's actions with one status. */
function descriptionsWithStatus(
  reconciliationReport: Awaited<ReturnType<typeof reconcileMediaExperiments>>,
  status: string,
): string[] {
  function filterPlannedAction(plannedAction: {
    readonly description: string;
    readonly destructive: boolean;
    status: ActionStatus;
    error?: string;
  }) {
    return plannedAction.status == status;
  }

  return reconciliationReport.actions.filter(filterPlannedAction).map(readDescription);
}
function describeVersionExperimentsSchema() {
  async function decodesExperimentsWithTreatments() {
    const decodedConfig = await parseVersionExperimentsConfig(experimentConfig);
    expect(decodedConfig.experiments[0]?.name).toBe('Icon Test');
    function readName(declaredTreatment: TreatmentConfig) {
      return declaredTreatment.name;
    }

    expect(decodedConfig.experiments[0]?.treatments?.map(readName)).toEqual([
      'Variant A',
      'Variant B',
    ]);
  }

  it('decodes experiments with treatments', decodesExperimentsWithTreatments);
  async function rejectsMalformedDocumentsAndDuplicateNames() {
    const parseVersionExperiments = parseVersionExperimentsConfig('nope');
    await expect(parseVersionExperiments).rejects.toMatchObject({
      message: expect.stringMatching(/must be a JSON object/),
    });
    await expect(parseVersionExperimentsConfig({ experiments: [] })).rejects.toMatchObject({
      message: expect.stringMatching(/at least one entry/),
    });
    await expect(
      parseVersionExperimentsConfig({
        experiments: [{ name: 'X', trafficProportion: 0 }],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/trafficProportion must be a positive number/),
    });
    await expect(
      parseVersionExperimentsConfig({
        experiments: [
          { name: 'X', trafficProportion: 10 },
          { name: 'X', trafficProportion: 20 },
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/duplicate experiment name/),
    });
  }

  it('rejects malformed documents and duplicate names', rejectsMalformedDocumentsAndDuplicateNames);
  async function readsTreatmentScreenshotFoldersRelativeToThePieceFile() {
    const systemTemporaryDirectory = tmpdir();
    const launchExperimentsPath = join(systemTemporaryDirectory, 'launch-experiments-');
    const temporaryDirectory = mkdtempSync(launchExperimentsPath);
    const configPath = join(temporaryDirectory, 'store', 'experiments.config.json');
    const displayTypeDirectory = join(
      temporaryDirectory,
      'store',
      'treatment',
      'he',
      'APP_IPHONE_67',
    );
    try {
      mkdirSync(displayTypeDirectory, { recursive: true });
      const joinedPath = join(displayTypeDirectory, '01.png');
      writeFileSync(joinedPath, 'png');
      const discoveredScreenshots = await discoverTreatmentScreenshots(configPath, mediaConfig);
      function mapScreenshot(
        screenshot: LocalAsset & {
          readonly locale: string;
          readonly displayType: string;
        },
      ) {
        return [screenshot.locale, screenshot.displayType, screenshot.fileName];
      }

      expect(discoveredScreenshots.get('treatment')?.map(mapScreenshot)).toEqual([
        ['he', 'APP_IPHONE_67', '01.png'],
      ]);
      const missingFolderConfig: VersionExperimentsConfig = {
        experiments: [
          { name: 'X', trafficProportion: 10, treatments: [{ name: 'Y', screenshots: 'missing' }] },
        ],
      };
      await expect(
        discoverTreatmentScreenshots(configPath, missingFolderConfig),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/No treatment screenshots folder/),
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  it(
    'reads treatment screenshot folders relative to the config file',
    readsTreatmentScreenshotFoldersRelativeToThePieceFile,
  );
  async function readsAndDecodesASidecar() {
    const systemTemporaryDirectory = tmpdir();
    const launchExperimentsPath = join(systemTemporaryDirectory, 'launch-experiments-');
    const temporaryDirectory = mkdtempSync(launchExperimentsPath);
    const configPath = join(temporaryDirectory, 'experiments.config.json');
    try {
      const serialized = JSON.stringify(experimentConfig);
      writeFileSync(configPath, serialized);
      const loadedConfig = await loadVersionExperimentsConfig(configPath);
      expect(loadedConfig).toEqual(experimentConfig);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  it('reads and decodes a sidecar', readsAndDecodesASidecar);
}

describe('version experiments schema', describeVersionExperimentsSchema);
function describeVersionExperimentReconciliation() {
  async function failsWhenTheAppStorePieceIsAbsent() {
    const { appleExperimentsApi } = makeExperimentsApi({ appId: null });
    await expect(reconcileExperiments(appleExperimentsApi, true)).rejects.toMatchObject({
      message: expect.stringMatching(/No App Store Connect app record/),
    });
  }

  it('fails when the App Store record is absent', failsWhenTheAppStorePieceIsAbsent);
  async function createsAMissingExperimentAndItsTreatments() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({});
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, false);
    expect(experimentWrites.createdExperiments).toEqual([
      { name: 'Icon Test', platform: 'IOS', trafficProportion: 50 },
    ]);
    expect(experimentWrites.createdTreatments).toEqual([
      { experimentId: 'exp-new', name: 'Variant A' },
      { experimentId: 'exp-new', name: 'Variant B' },
    ]);
    const experiments = summarizeExperiments(reconciliationReport.actions);
    expect(experiments).toEqual({
      applied: 3,
      failed: 0,
      skipped: 0,
    });
  }

  it('creates a missing experiment and its treatments', createsAMissingExperimentAndItsTreatments);
  async function createsOnlyMissingTreatmentsOnAnExistingExperiment() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [{ id: 'exp-1', name: 'Icon Test', state: 'PREPARE_FOR_SUBMISSION' }],
      treatments: [{ id: 't-a', name: 'Variant A' }],
    });
    await reconcileExperiments(appleExperimentsApi, false);
    expect(experimentWrites.createdExperiments).toHaveLength(0);
    expect(experimentWrites.createdTreatments).toEqual([
      { experimentId: 'exp-1', name: 'Variant B' },
    ]);
  }

  it(
    'creates only missing treatments on an existing experiment',
    createsOnlyMissingTreatmentsOnAnExistingExperiment,
  );
  async function plansWithoutApplyingWrites() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({});
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, true);
    expect(experimentWrites.createdExperiments).toHaveLength(0);
    expect(experimentWrites.createdTreatments).toHaveLength(0);
    function everyPlannedAction(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.status == 'planned';
    }

    expect(reconciliationReport.actions.every(everyPlannedAction)).toBe(true);
    expect(reconciliationReport.actions).toHaveLength(3);
  }

  it('plans without applying writes', plansWithoutApplyingWrites);
  async function skipsTreatmentsWhenExperimentCreationFails() {
    const { appleExperimentsApi } = makeExperimentsApi(
      {},
      {
        createVersionExperiment: function refuseExperiment() {
          throw new Error('name already in use');
        },
      },
    );
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, false);
    const experiments = summarizeExperiments(reconciliationReport.actions);
    expect(experiments).toEqual({
      applied: 0,
      failed: 1,
      skipped: 2,
    });
    function findPlannedAction(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.status == 'failed';
    }

    expect(reconciliationReport.actions.find(findPlannedAction)?.error).toBe('name already in use');
  }

  it('skips treatments when experiment creation fails', skipsTreatmentsWhenExperimentCreationFails);
}

describe('version experiment reconciliation', describeVersionExperimentReconciliation);
function describeVersionExperimentTreatmentScreenshots() {
  async function addsMissingLocalesAndSetsThenUploadsInNameOrder() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [existingScreenshotsExperiment],
      treatments: [{ id: 't-1', name: 'Colorful' }],
    });
    const reconciliationReport = await reconcileMediaExperiments(appleExperimentsApi, {});
    expect(experimentWrites.createdLocalizations).toEqual([
      { treatmentId: 't-1', locale: 'en-US' },
      { treatmentId: 't-1', locale: 'he' },
    ]);
    expect(experimentWrites.createdSets).toEqual([
      { localizationId: 'loc-en-US', displayType: 'APP_IPHONE_67' },
      { localizationId: 'loc-he', displayType: 'APP_IPHONE_67' },
    ]);
    expect(experimentWrites.uploads).toEqual([
      { setId: 'set-loc-en-US', fileName: '01.png' },
      { setId: 'set-loc-en-US', fileName: '02.png' },
      { setId: 'set-loc-he', fileName: '01.png' },
    ]);
    const experiments = summarizeExperiments(reconciliationReport.actions);
    expect(experiments).toEqual({
      applied: 7,
      failed: 0,
      skipped: 0,
    });
  }

  it(
    'adds missing locales and sets, then uploads in name order',
    addsMissingLocalesAndSetsThenUploadsInNameOrder,
  );
  async function uploadsOnlyTheScreenshotsAppleDoesNotHaveYet() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [existingScreenshotsExperiment],
      treatments: [{ id: 't-1', name: 'Colorful' }],
      ...existingLocaleSets,
      screenshotsBySet: {
        'set-1': [storedScreenshot('s-1', 'en-US', '01.png')],
        'set-2': [storedScreenshot('s-2', 'he', '01.png')],
      },
    });
    await reconcileMediaExperiments(appleExperimentsApi, {});
    expect(experimentWrites.createdLocalizations).toHaveLength(0);
    expect(experimentWrites.createdSets).toHaveLength(0);
    expect(experimentWrites.removedScreenshots).toHaveLength(0);
    expect(experimentWrites.uploads).toEqual([{ setId: 'set-1', fileName: '02.png' }]);
    expect(experimentWrites.reorders).toHaveLength(0);
  }

  it(
    'uploads only the screenshots Apple does not have yet',
    uploadsOnlyTheScreenshotsAppleDoesNotHaveYet,
  );
  async function replacesTheOriginalPageSScreenshotsAppleCopiedIntoTheTreatment() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [existingScreenshotsExperiment],
      treatments: [{ id: 't-1', name: 'Colorful' }],
      ...existingLocaleSets,
      screenshotsBySet: {
        'set-1': [
          originalScreenshot('o-1', '01-camera.png'),
          originalScreenshot('o-2', '02-meal.png'),
        ],
        'set-2': [storedScreenshot('s-2', 'he', '01.png')],
      },
    });
    const reconciliationReport = await reconcileMediaExperiments(appleExperimentsApi, {});
    expect(experimentWrites.removedScreenshots).toEqual(['o-1', 'o-2']);
    expect(experimentWrites.uploads).toEqual([
      { setId: 'set-1', fileName: '01.png' },
      { setId: 'set-1', fileName: '02.png' },
    ]);
    expect(experimentWrites.reorders).toHaveLength(0);
    expect(descriptionsWithStatus(reconciliationReport, 'applied').slice(0, 2)).toEqual([
      'remove screenshot iPhone 6.7" [en-US] 01-camera.png: not a local file',
      'remove screenshot iPhone 6.7" [en-US] 02-meal.png: not a local file',
    ]);
  }

  it(
    "replaces the original page's screenshots Apple copied into the treatment",
    replacesTheOriginalPageSScreenshotsAppleCopiedIntoTheTreatment,
  );
  async function keepsAMatchingScreenshotAndPutsTheSetBackInFileOrder() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [existingScreenshotsExperiment],
      treatments: [{ id: 't-1', name: 'Colorful' }],
      ...existingLocaleSets,
      screenshotsBySet: {
        'set-1': [
          originalScreenshot('o-1', '01-camera.png'),
          storedScreenshot('s-2', 'en-US', '02.png'),
        ],
        'set-2': [storedScreenshot('s-3', 'he', '01.png')],
      },
    });
    await reconcileMediaExperiments(appleExperimentsApi, {});
    expect(experimentWrites.removedScreenshots).toEqual(['o-1']);
    expect(experimentWrites.uploads).toEqual([{ setId: 'set-1', fileName: '01.png' }]);
    expect(experimentWrites.reorders).toEqual([
      { setId: 'set-1', screenshotIds: ['up-01.png', 's-2'] },
    ]);
  }

  it(
    'keeps a matching screenshot and puts the set back in file order',
    keepsAMatchingScreenshotAndPutsTheSetBackInFileOrder,
  );
  async function plansTheWholeNewExperimentWithoutWrites() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({});
    const reconciliationReport = await reconcileMediaExperiments(appleExperimentsApi, {
      submit: true,
      dryRun: true,
    });
    expect(descriptionsWithStatus(reconciliationReport, 'planned')).toEqual([
      'create experiment "Screenshots Test" (50% traffic)',
      'create treatment "Colorful" on experiment "Screenshots Test"',
      'add locale en-US to treatment "Colorful"',
      'create screenshot set iPhone 6.7" [en-US]',
      'upload screenshot iPhone 6.7" [en-US] 01.png',
      'upload screenshot iPhone 6.7" [en-US] 02.png',
      'add locale he to treatment "Colorful"',
      'create screenshot set iPhone 6.7" [he]',
      'upload screenshot iPhone 6.7" [he] 01.png',
      'submit experiment "Screenshots Test" for App Review',
    ]);
    expect(experimentWrites).toMatchObject({
      createdExperiments: [],
      createdLocalizations: [],
      uploads: [],
      reviewItems: [],
    });
  }

  it('plans the whole new experiment without writes', plansTheWholeNewExperimentWithoutWrites);
}

describe('version experiment treatment screenshots', describeVersionExperimentTreatmentScreenshots);
function describeVersionExperimentReviewAndStart() {
  async function submitsASyncedExperimentInANewReviewSubmission() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [existingScreenshotsExperiment],
      treatments: [{ id: 't-1', name: 'Colorful' }],
      reviewSubmissions: [{ id: 'sub-old', state: 'COMPLETE' }],
    });
    await reconcileMediaExperiments(appleExperimentsApi, {
      treatmentScreenshots: new Map(),
      submit: true,
    });
    expect(experimentWrites.createdSubmissions).toEqual(['IOS']);
    expect(experimentWrites.reviewItems).toEqual([
      { submissionId: 'sub-new', experimentId: 'exp-1' },
    ]);
    expect(experimentWrites.submittedSubmissions).toEqual(['sub-new']);
  }

  it(
    'submits a synced experiment in a new review submission',
    submitsASyncedExperimentInANewReviewSubmission,
  );
  async function reusesAnOpenReviewSubmission() {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [existingScreenshotsExperiment],
      treatments: [{ id: 't-1', name: 'Colorful' }],
      reviewSubmissions: [{ id: 'sub-open', state: 'READY_FOR_REVIEW' }],
    });
    await reconcileMediaExperiments(appleExperimentsApi, {
      treatmentScreenshots: new Map(),
      submit: true,
    });
    expect(experimentWrites.createdSubmissions).toHaveLength(0);
    expect(experimentWrites.submittedSubmissions).toEqual(['sub-open']);
  }

  it('reuses an open review submission', reusesAnOpenReviewSubmission);
  async function doesNotSubmitAnExperimentAlreadyInReviewOrAfterAFailedUpload() {
    const inReview = makeExperimentsApi({
      experiments: [{ ...existingScreenshotsExperiment, state: 'WAITING_FOR_REVIEW' }],
      treatments: [{ id: 't-1', name: 'Colorful' }],
    });
    const inReviewReport = await reconcileMediaExperiments(inReview.appleExperimentsApi, {
      treatmentScreenshots: new Map(),
      submit: true,
    });
    expect(descriptionsWithStatus(inReviewReport, 'skipped')).toEqual([
      'submit experiment "Screenshots Test" for App Review: it is already WAITING_FOR_REVIEW',
    ]);
    const failedUpload = makeExperimentsApi(
      {
        experiments: [existingScreenshotsExperiment],
        treatments: [{ id: 't-1', name: 'Colorful' }],
      },
      {
        uploadScreenshot: function refuseUpload() {
          throw new Error('upload refused');
        },
      },
    );
    const failedUploadReport = await reconcileMediaExperiments(failedUpload.appleExperimentsApi, {
      submit: true,
    });
    expect(failedUpload.experimentWrites.reviewItems).toHaveLength(0);
    expect(descriptionsWithStatus(failedUploadReport, 'skipped')).toEqual([
      'submit experiment "Screenshots Test" for App Review: an earlier change failed - fix it, then re-run',
    ]);
  }

  it(
    'does not submit an experiment already in review or after a failed upload',
    doesNotSubmitAnExperimentAlreadyInReviewOrAfterAFailedUpload,
  );
  async function startsOnlyAnApprovedExperimentThatHasNotStarted() {
    const approved = makeExperimentsApi({
      experiments: [{ ...existingScreenshotsExperiment, state: 'ACCEPTED' }],
      treatments: [{ id: 't-1', name: 'Colorful' }],
    });
    await reconcileMediaExperiments(approved.appleExperimentsApi, {
      treatmentScreenshots: new Map(),
      start: true,
    });
    expect(approved.experimentWrites.startedExperiments).toEqual(['exp-1']);
    const running = makeExperimentsApi({
      experiments: [
        { ...existingScreenshotsExperiment, state: 'APPROVED', startDate: '2026-11-01T00:00:00Z' },
      ],
      treatments: [{ id: 't-1', name: 'Colorful' }],
    });
    const runningReport = await reconcileMediaExperiments(running.appleExperimentsApi, {
      treatmentScreenshots: new Map(),
      start: true,
    });
    expect(running.experimentWrites.startedExperiments).toHaveLength(0);
    expect(descriptionsWithStatus(runningReport, 'skipped')).toEqual([
      'start experiment "Screenshots Test": it already started on 2026-11-01T00:00:00Z',
    ]);
    const inReview = makeExperimentsApi({
      experiments: [{ ...existingScreenshotsExperiment, state: 'IN_REVIEW' }],
      treatments: [{ id: 't-1', name: 'Colorful' }],
    });
    const inReviewReport = await reconcileMediaExperiments(inReview.appleExperimentsApi, {
      treatmentScreenshots: new Map(),
      start: true,
    });
    expect(descriptionsWithStatus(inReviewReport, 'skipped')).toEqual([
      'start experiment "Screenshots Test": it is IN_REVIEW - Apple must approve it first',
    ]);
  }

  it(
    'starts only an approved experiment that has not started',
    startsOnlyAnApprovedExperimentThatHasNotStarted,
  );
}

describe('version experiment review and start', describeVersionExperimentReviewAndStart);
