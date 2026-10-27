import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { LocalScreenshot } from '../listing/screenshots/assets.js';
import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  ReviewSubmissionResource,
  ScreenshotResource,
  ScreenshotSetResource,
  VersionExperimentResource,
} from '../types/appleCatalog.js';
import {
  type AscExperimentsApi,
  discoverTreatmentScreenshots,
  type ExperimentsReconcileInput,
  loadVersionExperimentsConfig,
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
  summarizeExperiments,
  type VersionExperimentsConfig,
} from './versionExperiments.js';

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
  screenshotSets: ScreenshotSetResource[];
  screenshots: ScreenshotResource[];
  reviewSubmissions: ReviewSubmissionResource[];
};

/** Build an Effect-native experiments API fake and its write journal. */
const makeExperimentsApi = (
  stateOverrides: Partial<ExperimentStoreState>,
  methodOverrides: Partial<AscExperimentsApi> = {},
): Readonly<{ appleExperimentsApi: AscExperimentsApi; experimentWrites: ExperimentWrites }> => {
  const experimentStore: ExperimentStoreState = {
    appId: 'app-1',
    experiments: [],
    treatments: [],
    localizations: [],
    screenshotSets: [],
    screenshots: [],
    reviewSubmissions: [],
    ...stateOverrides,
  };
  const experimentWrites: ExperimentWrites = {
    createdExperiments: [],
    createdTreatments: [],
    createdLocalizations: [],
    createdSets: [],
    uploads: [],
    createdSubmissions: [],
    reviewItems: [],
    submittedSubmissions: [],
    startedExperiments: [],
  };
  const appleExperimentsApi: AscExperimentsApi = {
    getAppId: () => Effect.succeed(experimentStore.appId),
    listVersionExperiments: () => Effect.succeed(experimentStore.experiments),
    createVersionExperiment: (_appId, experimentInput) => {
      experimentWrites.createdExperiments.push(experimentInput);
      return Effect.succeed({
        id: 'exp-new',
        name: experimentInput.name,
        state: 'PREPARE_FOR_SUBMISSION',
      });
    },
    listExperimentTreatments: () => Effect.succeed(experimentStore.treatments),
    createExperimentTreatment: (experimentId, treatmentInput) => {
      experimentWrites.createdTreatments.push({
        experimentId,
        name: treatmentInput.name,
      });
      return Effect.succeed({ id: 'treat-new', name: treatmentInput.name });
    },
    startVersionExperiment: (experimentId) => {
      experimentWrites.startedExperiments.push(experimentId);
      return Effect.void;
    },
    listExperimentTreatmentLocalizations: () => Effect.succeed(experimentStore.localizations),
    createExperimentTreatmentLocalization: (treatmentId, locale) => {
      experimentWrites.createdLocalizations.push({ treatmentId, locale });
      return Effect.succeed({ id: `loc-${locale}`, locale });
    },
    listTreatmentScreenshotSets: () => Effect.succeed(experimentStore.screenshotSets),
    createTreatmentScreenshotSet: (localizationId, displayType) => {
      experimentWrites.createdSets.push({ localizationId, displayType });
      return Effect.succeed({ id: `set-${localizationId}`, screenshotDisplayType: displayType });
    },
    listScreenshots: () => Effect.succeed(experimentStore.screenshots),
    uploadScreenshot: (setId, fileName) => {
      experimentWrites.uploads.push({ setId, fileName });
      return Effect.void;
    },
    listReviewSubmissions: () => Effect.succeed(experimentStore.reviewSubmissions),
    createReviewSubmission: (_appId, platform) => {
      experimentWrites.createdSubmissions.push(platform);
      return Effect.succeed({ id: 'sub-new', state: 'READY_FOR_REVIEW' });
    },
    addExperimentReviewSubmissionItem: (submissionId, experimentId) => {
      experimentWrites.reviewItems.push({ submissionId, experimentId });
      return Effect.void;
    },
    submitReviewSubmission: (submissionId) => {
      experimentWrites.submittedSubmissions.push(submissionId);
      return Effect.void;
    },
    ...methodOverrides,
  };
  return { appleExperimentsApi, experimentWrites };
};

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

/** One local treatment screenshot whose checksum is derived from its locale and name. */
const localScreenshot = (locale: string, fileName: string): LocalScreenshot => ({
  locale,
  displayType: 'APP_IPHONE_67',
  fileName,
  path: `/treatment/${locale}/APP_IPHONE_67/${fileName}`,
  checksum: `sum-${locale}-${fileName}`,
  size: 1,
});

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
const reconcileExperiments = (appleExperimentsApi: AscExperimentsApi, dryRun: boolean) =>
  Effect.runPromise(
    reconcileVersionExperiments(appleExperimentsApi, {
      bundleId: 'com.acme.app',
      config: experimentConfig,
      treatmentScreenshots: new Map(),
      submit: false,
      start: false,
      dryRun,
    }),
  );

/** Run the screenshot-treatment fixture with the given lifecycle flags. */
const reconcileMediaExperiments = (
  appleExperimentsApi: AscExperimentsApi,
  inputOverrides: Partial<ExperimentsReconcileInput>,
) =>
  Effect.runPromise(
    reconcileVersionExperiments(appleExperimentsApi, {
      bundleId: 'com.acme.app',
      config: mediaConfig,
      treatmentScreenshots,
      submit: false,
      start: false,
      dryRun: false,
      ...inputOverrides,
    }),
  );

/** The descriptions of a report's actions with one status. */
const descriptionsWithStatus = (
  reconciliationReport: Awaited<ReturnType<typeof reconcileMediaExperiments>>,
  status: string,
): string[] =>
  reconciliationReport.actions
    .filter((plannedAction) => plannedAction.status === status)
    .map((plannedAction) => plannedAction.description);

describe('version experiments schema', () => {
  it('decodes experiments with treatments', async () => {
    const decodedConfig = await Effect.runPromise(parseVersionExperimentsConfig(experimentConfig));
    expect(decodedConfig.experiments[0]?.name).toBe('Icon Test');
    expect(
      decodedConfig.experiments[0]?.treatments?.map((declaredTreatment) => declaredTreatment.name),
    ).toEqual(['Variant A', 'Variant B']);
  });

  it('rejects malformed documents and duplicate names', async () => {
    await expect(Effect.runPromise(parseVersionExperimentsConfig('nope'))).rejects.toThrow(
      /must be a JSON object/,
    );
    await expect(
      Effect.runPromise(parseVersionExperimentsConfig({ experiments: [] })),
    ).rejects.toThrow(/at least one entry/);
    await expect(
      Effect.runPromise(
        parseVersionExperimentsConfig({
          experiments: [{ name: 'X', trafficProportion: 0 }],
        }),
      ),
    ).rejects.toThrow(/trafficProportion must be a positive number/);
    await expect(
      Effect.runPromise(
        parseVersionExperimentsConfig({
          experiments: [
            { name: 'X', trafficProportion: 10 },
            { name: 'X', trafficProportion: 20 },
          ],
        }),
      ),
    ).rejects.toThrow(/duplicate experiment name/);
  });

  it('reads treatment screenshot folders relative to the config file', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-experiments-'));
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
      writeFileSync(join(displayTypeDirectory, '01.png'), 'png');
      const discoveredScreenshots = await Effect.runPromise(
        discoverTreatmentScreenshots(configPath, mediaConfig).pipe(
          Effect.provide(NodeContext.layer),
        ),
      );
      expect(
        discoveredScreenshots
          .get('treatment')
          ?.map((screenshot) => [screenshot.locale, screenshot.displayType, screenshot.fileName]),
      ).toEqual([['he', 'APP_IPHONE_67', '01.png']]);
      const missingFolderConfig: VersionExperimentsConfig = {
        experiments: [
          { name: 'X', trafficProportion: 10, treatments: [{ name: 'Y', screenshots: 'missing' }] },
        ],
      };
      await expect(
        Effect.runPromise(
          discoverTreatmentScreenshots(configPath, missingFolderConfig).pipe(
            Effect.provide(NodeContext.layer),
          ),
        ),
      ).rejects.toThrow(/No treatment screenshots folder/);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('reads and decodes a sidecar through Effect Platform', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-experiments-'));
    const configPath = join(temporaryDirectory, 'experiments.config.json');
    try {
      writeFileSync(configPath, JSON.stringify(experimentConfig));
      const loadedConfig = await Effect.runPromise(
        loadVersionExperimentsConfig(configPath).pipe(Effect.provide(NodeContext.layer)),
      );
      expect(loadedConfig).toEqual(experimentConfig);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe('version experiment reconciliation', () => {
  it('fails when the App Store record is absent', async () => {
    const { appleExperimentsApi } = makeExperimentsApi({ appId: null });
    await expect(reconcileExperiments(appleExperimentsApi, true)).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it('creates a missing experiment and its treatments', async () => {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({});
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, false);
    expect(experimentWrites.createdExperiments).toEqual([
      { name: 'Icon Test', platform: 'IOS', trafficProportion: 50 },
    ]);
    expect(experimentWrites.createdTreatments).toEqual([
      { experimentId: 'exp-new', name: 'Variant A' },
      { experimentId: 'exp-new', name: 'Variant B' },
    ]);
    expect(summarizeExperiments(reconciliationReport.actions)).toEqual({
      applied: 3,
      failed: 0,
      skipped: 0,
    });
  });

  it('creates only missing treatments on an existing experiment', async () => {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [{ id: 'exp-1', name: 'Icon Test', state: 'PREPARE_FOR_SUBMISSION' }],
      treatments: [{ id: 't-a', name: 'Variant A' }],
    });
    await reconcileExperiments(appleExperimentsApi, false);
    expect(experimentWrites.createdExperiments).toHaveLength(0);
    expect(experimentWrites.createdTreatments).toEqual([
      { experimentId: 'exp-1', name: 'Variant B' },
    ]);
  });

  it('plans without applying writes', async () => {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({});
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, true);
    expect(experimentWrites.createdExperiments).toHaveLength(0);
    expect(experimentWrites.createdTreatments).toHaveLength(0);
    expect(
      reconciliationReport.actions.every((plannedAction) => plannedAction.status === 'planned'),
    ).toBe(true);
    expect(reconciliationReport.actions).toHaveLength(3);
  });

  it('skips treatments when experiment creation fails', async () => {
    const { appleExperimentsApi } = makeExperimentsApi(
      {},
      {
        createVersionExperiment: () => Effect.fail(new Error('name already in use')),
      },
    );
    const reconciliationReport = await reconcileExperiments(appleExperimentsApi, false);
    expect(summarizeExperiments(reconciliationReport.actions)).toEqual({
      applied: 0,
      failed: 1,
      skipped: 2,
    });
    expect(
      reconciliationReport.actions.find((plannedAction) => plannedAction.status === 'failed')
        ?.error,
    ).toBe('name already in use');
  });
});

describe('version experiment treatment screenshots', () => {
  it('adds missing locales and sets, then uploads in name order', async () => {
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
    expect(summarizeExperiments(reconciliationReport.actions)).toEqual({
      applied: 7,
      failed: 0,
      skipped: 0,
    });
  });

  it('uploads only the screenshots Apple does not have yet', async () => {
    const { appleExperimentsApi, experimentWrites } = makeExperimentsApi({
      experiments: [existingScreenshotsExperiment],
      treatments: [{ id: 't-1', name: 'Colorful' }],
      localizations: [
        { id: 'loc-1', locale: 'en-US' },
        { id: 'loc-2', locale: 'he' },
      ],
      screenshotSets: [{ id: 'set-1', screenshotDisplayType: 'APP_IPHONE_67' }],
      screenshots: [
        { id: 's-1', fileName: '01.png', sourceFileChecksum: 'sum-en-US-01.png' },
        { id: 's-2', fileName: '01.png', sourceFileChecksum: 'sum-he-01.png' },
      ],
    });
    await reconcileMediaExperiments(appleExperimentsApi, {});
    expect(experimentWrites.createdLocalizations).toHaveLength(0);
    expect(experimentWrites.createdSets).toHaveLength(0);
    expect(experimentWrites.uploads).toEqual([{ setId: 'set-1', fileName: '02.png' }]);
  });

  it('plans the whole new experiment without writes', async () => {
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
  });
});

describe('version experiment review and start', () => {
  it('submits a synced experiment in a new review submission', async () => {
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
  });

  it('reuses an open review submission', async () => {
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
  });

  it('does not submit an experiment already in review or after a failed upload', async () => {
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
      { uploadScreenshot: () => Effect.fail(new Error('upload refused')) },
    );
    const failedUploadReport = await reconcileMediaExperiments(failedUpload.appleExperimentsApi, {
      submit: true,
    });
    expect(failedUpload.experimentWrites.reviewItems).toHaveLength(0);
    expect(descriptionsWithStatus(failedUploadReport, 'skipped')).toEqual([
      'submit experiment "Screenshots Test" for App Review: an earlier change failed - fix it, then re-run',
    ]);
  });

  it('starts only an approved experiment that has not started', async () => {
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
  });
});
