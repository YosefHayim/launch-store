import { describe, expect, it, vi } from 'vitest';
import {
  reconcilePreviews,
  reconcileScreenshots,
  type PreviewReconcileInput,
  type PreviewsApi,
  type ScreenshotReconcileInput,
  type ScreenshotsApi,
  type SubscriptionReviewScreenshot,
} from './asc-screenshots.ts';
import type {
  LocalAsset,
  LocalPreview,
  LocalScreenshot,
} from '../../listing/screenshots/assets.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

function effectMethods<Api extends object>(api: Api): Api {
  return api;
}
/**
 * A fully-stubbed {@link ScreenshotsApi}. Reads default to "an editable version with one en-US locale and
 * no screenshots yet"; writes resolve to a created resource. Override per test to set up other states.
 */
function makeApi(overrides: Partial<ScreenshotsApi> = {}): ScreenshotsApi {
  function mockImplementationLoc(_loc: string, displayType: string) {
    return Promise.resolve({ id: 'set-new', screenshotDisplayType: displayType });
  }

  const base: ScreenshotsApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    getEditableVersionId: vi.fn().mockResolvedValue('ver1'),
    listVersionLocalizations: vi
      .fn()
      .mockResolvedValue([{ id: 'loc-en', locale: 'en-US', fields: {} }]),
    listScreenshotSets: vi.fn().mockResolvedValue([]),
    createScreenshotSet: vi.fn().mockImplementation(mockImplementationLoc),
    listScreenshots: vi.fn().mockResolvedValue([]),
    uploadScreenshot: vi.fn().mockResolvedValue(undefined),
    deleteScreenshot: vi.fn().mockResolvedValue(undefined),
    reorderScreenshots: vi.fn().mockResolvedValue(undefined),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    getSubscriptionReviewScreenshot: vi.fn().mockResolvedValue(null),
    uploadSubscriptionReviewScreenshot: vi.fn().mockResolvedValue(undefined),
  };
  return effectMethods({ ...base, ...overrides });
}
/** Build a {@link LocalScreenshot} with sensible defaults for the field under test. */
function shot(overrides: Partial<LocalScreenshot> = {}): LocalScreenshot {
  return {
    locale: 'en-US',
    displayType: 'APP_IPHONE_67',
    fileName: '01.png',
    path: '/tmp/01.png',
    checksum: 'sum-01',
    size: 100,
    ...overrides,
  };
}
function asset(overrides: Partial<LocalAsset> = {}): LocalAsset {
  return {
    path: '/tmp/review.png',
    fileName: 'review.png',
    checksum: 'rev-sum',
    size: 50,
    ...overrides,
  };
}
function input(overrides: Partial<ScreenshotReconcileInput> = {}): ScreenshotReconcileInput {
  return {
    bundleId: 'com.acme.app',
    screenshots: [],
    subscriptionReviewScreenshots: [],
    dryRun: false,
    allowDestructive: false,
    ...overrides,
  };
}
function runScreenshots(api: ScreenshotsApi, reconcileInput: ScreenshotReconcileInput) {
  return reconcileScreenshots(api, reconcileInput);
}
function describeReconcileScreenshotsAppScreenshots() {
  async function doesNothingWhenThereAreNoAssetsToReconcile() {
    const api = makeApi();
    const actions = await runScreenshots(api, input());
    expect(actions).toEqual([]);
    expect(api.getAppId).not.toHaveBeenCalled();
  }

  it(
    'does nothing when there are no assets to reconcile',
    doesNothingWhenThereAreNoAssetsToReconcile,
  );
  async function skipsWithGuidanceWhenTheAppHasNoAppStoreConnectPiece() {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const actions = await runScreenshots(api, input({ screenshots: [shot()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no App Store Connect app record'),
    });
  }

  it(
    'skips with guidance when the app has no App Store Connect record',
    skipsWithGuidanceWhenTheAppHasNoAppStoreConnectPiece,
  );
  async function plansSetCreationUploadFromAnEmptyVersionWithoutPerformingWritesDryRun() {
    const api = makeApi();
    const actions = await runScreenshots(api, input({ screenshots: [shot()], dryRun: true }));
    function readDescription(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description;
    }

    expect(actions.map(readDescription)).toEqual([
      'create screenshot set iPhone 6.7" [en-US]',
      'upload screenshot iPhone 6.7" [en-US] 01.png',
    ]);
    function everyA(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status == 'planned';
    }

    expect(actions.every(everyA)).toBe(true);
    expect(api.createScreenshotSet).not.toHaveBeenCalled();
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  }

  it(
    'plans set creation + upload from an empty version without performing writes (dry-run)',
    plansSetCreationUploadFromAnEmptyVersionWithoutPerformingWritesDryRun,
  );
  async function createsTheSetAndUploadsOnApply() {
    const api = makeApi();
    const actions = await runScreenshots(api, input({ screenshots: [shot()] }));
    function everyA2(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status == 'applied';
    }

    expect(actions.every(everyA2)).toBe(true);
    expect(api.createScreenshotSet).toHaveBeenCalledWith('loc-en', 'APP_IPHONE_67');
    expect(api.uploadScreenshot).toHaveBeenCalledWith('set-new', '01.png', '/tmp/01.png');
  }

  it('creates the set and uploads on apply', createsTheSetAndUploadsOnApply);
  async function uploadsDisplayTypeSetsInParallelAndKeepsTheirActionsInSetOrder() {
    let inFlightUploads = 0;
    let peakInFlightUploads = 0;
    async function mockImplementationSetId(_setId: string, fileName: string) {
      inFlightUploads += 1;
      peakInFlightUploads = Math.max(peakInFlightUploads, inFlightUploads);
      let uploadDelayMs = 1;
      if (fileName == '01.png') uploadDelayMs = 10;
      function createPromiseWork(resumeUpload: (value: unknown) => void) {
        return setTimeout(resumeUpload, uploadDelayMs);
      }

      await new Promise(createPromiseWork);
      inFlightUploads -= 1;
    }

    const api = makeApi({
      uploadScreenshot: vi.fn().mockImplementation(mockImplementationSetId),
    });
    const ipadShot = shot({
      displayType: 'APP_IPAD_PRO_3GEN_129',
      fileName: '02.png',
      path: '/tmp/02.png',
      checksum: 'sum-02',
    });
    const actions = await runScreenshots(api, input({ screenshots: [shot(), ipadShot] }));
    expect(peakInFlightUploads).toBe(2);
    function readDescription2(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description;
    }

    expect(actions.map(readDescription2)).toEqual([
      'create screenshot set iPhone 6.7" [en-US]',
      'upload screenshot iPhone 6.7" [en-US] 01.png',
      expect.stringMatching(/^create screenshot set .+ \[en-US\]$/),
      expect.stringMatching(/^upload screenshot .+ \[en-US\] 02\.png$/),
    ]);
  }

  it(
    'uploads display-type sets in parallel and keeps their actions in set order',
    uploadsDisplayTypeSetsInParallelAndKeepsTheirActionsInSetOrder,
  );
  async function reusesAnExistingSetAndSkipsAScreenshotAlreadyUploadedByteForByteIdempotent() {
    const api = makeApi({
      listScreenshotSets: vi
        .fn()
        .mockResolvedValue([{ id: 'set1', screenshotDisplayType: 'APP_IPHONE_67' }]),
      listScreenshots: vi
        .fn()
        .mockResolvedValue([{ id: 's1', fileName: '01.png', sourceFileChecksum: 'sum-01' }]),
    });
    const actions = await runScreenshots(
      api,
      input({ screenshots: [shot({ checksum: 'sum-01' })] }),
    );
    expect(actions).toEqual([]);
    expect(api.createScreenshotSet).not.toHaveBeenCalled();
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  }

  it(
    'reuses an existing set and skips a screenshot already uploaded byte-for-byte (idempotent)',
    reusesAnExistingSetAndSkipsAScreenshotAlreadyUploadedByteForByteIdempotent,
  );
  async function uploadsAChangedFileSameNameNewChecksumIntoTheExistingSet() {
    const api = makeApi({
      listScreenshotSets: vi
        .fn()
        .mockResolvedValue([{ id: 'set1', screenshotDisplayType: 'APP_IPHONE_67' }]),
      listScreenshots: vi
        .fn()
        .mockResolvedValue([{ id: 's1', fileName: '01.png', sourceFileChecksum: 'old-sum' }]),
    });
    const actions = await runScreenshots(
      api,
      input({ screenshots: [shot({ checksum: 'new-sum' })] }),
    );
    function readStatus(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status;
    }

    expect(actions.map(readStatus)).toEqual(['applied']);
    expect(api.uploadScreenshot).toHaveBeenCalledWith('set1', '01.png', '/tmp/01.png');
  }

  it(
    'uploads a changed file (same name, new checksum) into the existing set',
    uploadsAChangedFileSameNameNewChecksumIntoTheExistingSet,
  );
  async function reUploadsAMatchingChecksumWhosePreviousDeliveryFAILED() {
    const api = makeApi({
      listScreenshotSets: vi
        .fn()
        .mockResolvedValue([{ id: 'set1', screenshotDisplayType: 'APP_IPHONE_67' }]),
      listScreenshots: vi.fn().mockResolvedValue([
        {
          id: 's1',
          fileName: '01.png',
          sourceFileChecksum: 'sum-01',
          assetDeliveryState: 'FAILED',
        },
      ]),
    });
    const actions = await runScreenshots(
      api,
      input({ screenshots: [shot({ checksum: 'sum-01' })] }),
    );
    function readStatus2(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status;
    }

    expect(actions.map(readStatus2)).toEqual(['applied']);
    expect(api.uploadScreenshot).toHaveBeenCalledWith('set1', '01.png', '/tmp/01.png');
  }

  it(
    're-uploads a matching checksum whose previous delivery FAILED',
    reUploadsAMatchingChecksumWhosePreviousDeliveryFAILED,
  );
  async function skipsALocaleThatIsnTOnTheEditableVersion() {
    const api = makeApi({
      listVersionLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'loc-en', locale: 'en-US', fields: {} }]),
    });
    const actions = await runScreenshots(api, input({ screenshots: [shot({ locale: 'fr-FR' })] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('locale not on the editable version'),
    });
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  }

  it("skips a locale that isn't on the editable version", skipsALocaleThatIsnTOnTheEditableVersion);
  async function skipsWhenThereIsNoEditableAppStoreVersion() {
    const api = makeApi({ getEditableVersionId: vi.fn().mockResolvedValue(null) });
    const actions = await runScreenshots(api, input({ screenshots: [shot()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no editable App Store version'),
    });
  }

  it(
    'skips when there is no editable App Store version',
    skipsWhenThereIsNoEditableAppStoreVersion,
  );
  async function skipsScreenshotsBeyondAppleSPerSetMaximum() {
    function fromPiece(_: unknown, i: number) {
      return {
        id: `s${i}`,
        fileName: `${i}.png`,
        sourceFileChecksum: `old-${i}`,
      };
    }

    const existing = Array.from({ length: 10 }, fromPiece);
    const api = makeApi({
      listScreenshotSets: vi
        .fn()
        .mockResolvedValue([{ id: 'set1', screenshotDisplayType: 'APP_IPHONE_67' }]),
      listScreenshots: vi.fn().mockResolvedValue(existing),
    });
    const actions = await runScreenshots(
      api,
      input({ screenshots: [shot({ fileName: '11.png', checksum: 'fresh' })] }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('set is full'),
    });
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  }

  it("skips screenshots beyond Apple's per-set maximum", skipsScreenshotsBeyondAppleSPerSetMaximum);
}

describe('reconcileScreenshots - app screenshots', describeReconcileScreenshotsAppScreenshots);
function describeReconcileScreenshotsSubscriptionReviewScreenshots() {
  function reviewInput(
    items: SubscriptionReviewScreenshot[],
    over: Partial<ScreenshotReconcileInput> = {},
  ) {
    return input({ subscriptionReviewScreenshots: items, ...over });
  }
  function apiWithSubscription(over: Partial<ScreenshotsApi> = {}): ScreenshotsApi {
    return makeApi({
      listSubscriptionGroups: vi.fn().mockResolvedValue([{ id: 'g1', referenceName: 'Pro' }]),
      listSubscriptions: vi
        .fn()
        .mockResolvedValue([{ id: 'sub1', productId: 'com.acme.pro', name: 'Pro' }]),
      ...over,
    });
  }
  async function uploadsTheReviewScreenshotWhenTheSubscriptionExistsAndTheChecksumDiffers() {
    const api = apiWithSubscription();
    const actions = await runScreenshots(
      api,
      reviewInput([{ productId: 'com.acme.pro', asset: asset() }]),
    );
    function readStatus3(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status;
    }

    expect(actions.map(readStatus3)).toEqual(['applied']);
    expect(api.uploadSubscriptionReviewScreenshot).toHaveBeenCalledWith(
      'sub1',
      'review.png',
      '/tmp/review.png',
    );
  }

  it(
    'uploads the review screenshot when the subscription exists and the checksum differs',
    uploadsTheReviewScreenshotWhenTheSubscriptionExistsAndTheChecksumDiffers,
  );
  async function skipsWhenTheLiveReviewScreenshotAlreadyMatchesTheLocalChecksum() {
    const api = apiWithSubscription({
      getSubscriptionReviewScreenshot: vi
        .fn()
        .mockResolvedValue({ id: 'rs1', sourceFileChecksum: 'rev-sum' }),
    });
    const actions = await runScreenshots(
      api,
      reviewInput([{ productId: 'com.acme.pro', asset: asset({ checksum: 'rev-sum' }) }]),
    );
    expect(actions).toEqual([]);
    expect(api.uploadSubscriptionReviewScreenshot).not.toHaveBeenCalled();
  }

  it(
    'skips when the live review screenshot already matches the local checksum',
    skipsWhenTheLiveReviewScreenshotAlreadyMatchesTheLocalChecksum,
  );
  async function notesSkipsASubscriptionThatIsnTOnAppStoreConnectYet() {
    const api = makeApi(); // no subscription groups
    const actions = await runScreenshots(
      api,
      reviewInput([{ productId: 'com.acme.pro', asset: asset() }]),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('not on App Store Connect yet'),
    });
    expect(api.uploadSubscriptionReviewScreenshot).not.toHaveBeenCalled();
  }

  it(
    "notes (skips) a subscription that isn't on App Store Connect yet",
    notesSkipsASubscriptionThatIsnTOnAppStoreConnectYet,
  );
}

describe(
  'reconcileScreenshots - subscription review screenshots',
  describeReconcileScreenshotsSubscriptionReviewScreenshots,
);
/**
 * A fully-stubbed {@link PreviewsApi}. Reads default to "an editable version with one en-US locale and no
 * previews yet"; writes resolve to a created resource. Override per test to set up other states.
 */
function makePreviewsApi(overrides: Partial<PreviewsApi> = {}): PreviewsApi {
  function mockImplementationLoc2(_loc: string, previewType: string) {
    return Promise.resolve({ id: 'set-new', previewType });
  }

  const base: PreviewsApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    getEditableVersionId: vi.fn().mockResolvedValue('ver1'),
    listVersionLocalizations: vi
      .fn()
      .mockResolvedValue([{ id: 'loc-en', locale: 'en-US', fields: {} }]),
    listPreviewSets: vi.fn().mockResolvedValue([]),
    createPreviewSet: vi.fn().mockImplementation(mockImplementationLoc2),
    listPreviews: vi.fn().mockResolvedValue([]),
    uploadPreview: vi.fn().mockResolvedValue(undefined),
  };
  return effectMethods({ ...base, ...overrides });
}
/** Build a {@link LocalPreview} with sensible defaults for the field under test. */
function preview(overrides: Partial<LocalPreview> = {}): LocalPreview {
  return {
    locale: 'en-US',
    previewType: 'IPHONE_67',
    fileName: '01.mp4',
    path: '/tmp/01.mp4',
    checksum: 'sum-01',
    size: 1000,
    ...overrides,
  };
}
function previewInput(overrides: Partial<PreviewReconcileInput> = {}): PreviewReconcileInput {
  return {
    bundleId: 'com.acme.app',
    previews: [],
    dryRun: false,
    allowDestructive: false,
    ...overrides,
  };
}
function runPreviews(api: PreviewsApi, reconcileInput: PreviewReconcileInput) {
  return reconcilePreviews(api, reconcileInput);
}
function describeReconcilePreviews() {
  async function doesNothingWhenThereAreNoPreviewsToReconcile() {
    const api = makePreviewsApi();
    const actions = await runPreviews(api, previewInput());
    expect(actions).toEqual([]);
    expect(api.getAppId).not.toHaveBeenCalled();
  }

  it(
    'does nothing when there are no previews to reconcile',
    doesNothingWhenThereAreNoPreviewsToReconcile,
  );
  async function skipsWithGuidanceWhenTheAppHasNoAppStoreConnectPiece2() {
    const api = makePreviewsApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const actions = await runPreviews(api, previewInput({ previews: [preview()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no App Store Connect app record'),
    });
  }

  it(
    'skips with guidance when the app has no App Store Connect record',
    skipsWithGuidanceWhenTheAppHasNoAppStoreConnectPiece2,
  );
  async function skipsWhenThereIsNoEditableAppStoreVersion2() {
    const api = makePreviewsApi({ getEditableVersionId: vi.fn().mockResolvedValue(null) });
    const actions = await runPreviews(api, previewInput({ previews: [preview()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no editable App Store version'),
    });
  }

  it(
    'skips when there is no editable App Store version',
    skipsWhenThereIsNoEditableAppStoreVersion2,
  );
  async function plansSetCreationUploadFromAnEmptyVersionWithoutPerformingWritesDryRun2() {
    const api = makePreviewsApi();
    const actions = await runPreviews(api, previewInput({ previews: [preview()], dryRun: true }));
    function readDescription3(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description;
    }

    expect(actions.map(readDescription3)).toEqual([
      'create preview set iPhone 6.7" [en-US]',
      'upload preview iPhone 6.7" [en-US] 01.mp4',
    ]);
    function everyA3(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status == 'planned';
    }

    expect(actions.every(everyA3)).toBe(true);
    expect(api.createPreviewSet).not.toHaveBeenCalled();
    expect(api.uploadPreview).not.toHaveBeenCalled();
  }

  it(
    'plans set creation + upload from an empty version without performing writes (dry-run)',
    plansSetCreationUploadFromAnEmptyVersionWithoutPerformingWritesDryRun2,
  );
  async function createsTheSetAndUploadsOnApply2() {
    const api = makePreviewsApi();
    const actions = await runPreviews(api, previewInput({ previews: [preview()] }));
    function everyA4(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status == 'applied';
    }

    expect(actions.every(everyA4)).toBe(true);
    expect(api.createPreviewSet).toHaveBeenCalledWith('loc-en', 'IPHONE_67');
    expect(api.uploadPreview).toHaveBeenCalledWith('set-new', '01.mp4', '/tmp/01.mp4');
  }

  it('creates the set and uploads on apply', createsTheSetAndUploadsOnApply2);
  async function reusesAnExistingSetAndSkipsAPreviewAlreadyUploadedByteForByteIdempotent() {
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi
        .fn()
        .mockResolvedValue([{ id: 'p1', fileName: '01.mp4', sourceFileChecksum: 'sum-01' }]),
    });
    const actions = await runPreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'sum-01' })] }),
    );
    expect(actions).toEqual([]);
    expect(api.createPreviewSet).not.toHaveBeenCalled();
    expect(api.uploadPreview).not.toHaveBeenCalled();
  }

  it(
    'reuses an existing set and skips a preview already uploaded byte-for-byte (idempotent)',
    reusesAnExistingSetAndSkipsAPreviewAlreadyUploadedByteForByteIdempotent,
  );
  async function uploadsAChangedFileSameNameNewChecksumIntoTheExistingSet2() {
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi
        .fn()
        .mockResolvedValue([{ id: 'p1', fileName: '01.mp4', sourceFileChecksum: 'old-sum' }]),
    });
    const actions = await runPreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'new-sum' })] }),
    );
    function readStatus4(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status;
    }

    expect(actions.map(readStatus4)).toEqual(['applied']);
    expect(api.uploadPreview).toHaveBeenCalledWith('set1', '01.mp4', '/tmp/01.mp4');
  }

  it(
    'uploads a changed file (same name, new checksum) into the existing set',
    uploadsAChangedFileSameNameNewChecksumIntoTheExistingSet2,
  );
  async function reUploadsAMatchingChecksumWhosePreviousDeliveryFAILED2() {
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          fileName: '01.mp4',
          sourceFileChecksum: 'sum-01',
          assetDeliveryState: 'FAILED',
        },
      ]),
    });
    const actions = await runPreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'sum-01' })] }),
    );
    function readStatus5(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.status;
    }

    expect(actions.map(readStatus5)).toEqual(['applied']);
    expect(api.uploadPreview).toHaveBeenCalledWith('set1', '01.mp4', '/tmp/01.mp4');
  }

  it(
    're-uploads a matching checksum whose previous delivery FAILED',
    reUploadsAMatchingChecksumWhosePreviousDeliveryFAILED2,
  );
  async function treatsAnInProcessingNonFAILEDPreviewAsAlreadyUploadedSoAReRunUploadsNothing() {
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          fileName: '01.mp4',
          sourceFileChecksum: 'sum-01',
          assetDeliveryState: 'UPLOAD_COMPLETE',
        },
      ]),
    });
    const actions = await runPreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'sum-01' })] }),
    );
    expect(actions).toEqual([]);
    expect(api.uploadPreview).not.toHaveBeenCalled();
  }

  it(
    'treats an in-processing (non-FAILED) preview as already uploaded, so a re-run uploads nothing',
    treatsAnInProcessingNonFAILEDPreviewAsAlreadyUploadedSoAReRunUploadsNothing,
  );
  async function skipsALocaleThatIsnTOnTheEditableVersion2() {
    const api = makePreviewsApi();
    const actions = await runPreviews(
      api,
      previewInput({ previews: [preview({ locale: 'fr-FR' })] }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('locale not on the editable version'),
    });
    expect(api.uploadPreview).not.toHaveBeenCalled();
  }

  it(
    "skips a locale that isn't on the editable version",
    skipsALocaleThatIsnTOnTheEditableVersion2,
  );
  async function skipsPreviewsBeyondAppleSPerSetMaximum() {
    function fromPiece2(_: unknown, i: number) {
      return {
        id: `p${i}`,
        fileName: `${i}.mp4`,
        sourceFileChecksum: `old-${i}`,
      };
    }

    const existing = Array.from({ length: 3 }, fromPiece2);
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi.fn().mockResolvedValue(existing),
    });
    const actions = await runPreviews(
      api,
      previewInput({ previews: [preview({ fileName: '04.mp4', checksum: 'fresh' })] }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('set is full'),
    });
    expect(api.uploadPreview).not.toHaveBeenCalled();
  }

  it("skips previews beyond Apple's per-set maximum", skipsPreviewsBeyondAppleSPerSetMaximum);
}

describe('reconcilePreviews', describeReconcilePreviews);
