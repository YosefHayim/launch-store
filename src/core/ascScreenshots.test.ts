import { describe, expect, it, vi } from 'vitest';
import {
  reconcilePreviews,
  reconcileScreenshots,
  type PreviewReconcileInput,
  type PreviewsApi,
  type ScreenshotReconcileInput,
  type ScreenshotsApi,
  type SubscriptionReviewScreenshot,
} from './ascScreenshots.js';
import type { LocalAsset, LocalPreview, LocalScreenshot } from './screenshotAssets.js';

/**
 * A fully-stubbed {@link ScreenshotsApi}. Reads default to "an editable version with one en-US locale and
 * no screenshots yet"; writes resolve to a created resource. Override per test to set up other states.
 */
function makeApi(overrides: Partial<ScreenshotsApi> = {}): ScreenshotsApi {
  const base: ScreenshotsApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    getEditableVersionId: vi.fn().mockResolvedValue('ver1'),
    listVersionLocalizations: vi
      .fn()
      .mockResolvedValue([{ id: 'loc-en', locale: 'en-US', fields: {} }]),
    listScreenshotSets: vi.fn().mockResolvedValue([]),
    createScreenshotSet: vi
      .fn()
      .mockImplementation((_loc: string, displayType: string) =>
        Promise.resolve({ id: 'set-new', screenshotDisplayType: displayType }),
      ),
    listScreenshots: vi.fn().mockResolvedValue([]),
    uploadScreenshot: vi.fn().mockResolvedValue(undefined),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    getSubscriptionReviewScreenshot: vi.fn().mockResolvedValue(null),
    uploadSubscriptionReviewScreenshot: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
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

describe('reconcileScreenshots — app screenshots', () => {
  it('does nothing when there are no assets to reconcile', async () => {
    const api = makeApi();
    const actions = await reconcileScreenshots(api, input());
    expect(actions).toEqual([]);
    expect(api.getAppId).not.toHaveBeenCalled();
  });

  it('skips with guidance when the app has no App Store Connect record', async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const actions = await reconcileScreenshots(api, input({ screenshots: [shot()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no App Store Connect app record'),
    });
  });

  it('plans set creation + upload from an empty version without performing writes (dry-run)', async () => {
    const api = makeApi();
    const actions = await reconcileScreenshots(api, input({ screenshots: [shot()], dryRun: true }));
    expect(actions.map((a) => a.description)).toEqual([
      'create screenshot set iPhone 6.7" [en-US]',
      'upload screenshot iPhone 6.7" [en-US] 01.png',
    ]);
    expect(actions.every((a) => a.status === 'planned')).toBe(true);
    expect(api.createScreenshotSet).not.toHaveBeenCalled();
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  });

  it('creates the set and uploads on apply', async () => {
    const api = makeApi();
    const actions = await reconcileScreenshots(api, input({ screenshots: [shot()] }));
    expect(actions.every((a) => a.status === 'applied')).toBe(true);
    expect(api.createScreenshotSet).toHaveBeenCalledWith('loc-en', 'APP_IPHONE_67');
    expect(api.uploadScreenshot).toHaveBeenCalledWith('set-new', '01.png', '/tmp/01.png');
  });

  it('reuses an existing set and skips a screenshot already uploaded byte-for-byte (idempotent)', async () => {
    const api = makeApi({
      listScreenshotSets: vi
        .fn()
        .mockResolvedValue([{ id: 'set1', screenshotDisplayType: 'APP_IPHONE_67' }]),
      listScreenshots: vi
        .fn()
        .mockResolvedValue([{ id: 's1', fileName: '01.png', sourceFileChecksum: 'sum-01' }]),
    });
    const actions = await reconcileScreenshots(
      api,
      input({ screenshots: [shot({ checksum: 'sum-01' })] }),
    );
    expect(actions).toEqual([]);
    expect(api.createScreenshotSet).not.toHaveBeenCalled();
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  });

  it('uploads a changed file (same name, new checksum) into the existing set', async () => {
    const api = makeApi({
      listScreenshotSets: vi
        .fn()
        .mockResolvedValue([{ id: 'set1', screenshotDisplayType: 'APP_IPHONE_67' }]),
      listScreenshots: vi
        .fn()
        .mockResolvedValue([{ id: 's1', fileName: '01.png', sourceFileChecksum: 'old-sum' }]),
    });
    const actions = await reconcileScreenshots(
      api,
      input({ screenshots: [shot({ checksum: 'new-sum' })] }),
    );
    expect(actions.map((a) => a.status)).toEqual(['applied']);
    expect(api.uploadScreenshot).toHaveBeenCalledWith('set1', '01.png', '/tmp/01.png');
  });

  it('re-uploads a matching checksum whose previous delivery FAILED', async () => {
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
    const actions = await reconcileScreenshots(
      api,
      input({ screenshots: [shot({ checksum: 'sum-01' })] }),
    );
    expect(actions.map((a) => a.status)).toEqual(['applied']);
    expect(api.uploadScreenshot).toHaveBeenCalledWith('set1', '01.png', '/tmp/01.png');
  });

  it("skips a locale that isn't on the editable version", async () => {
    const api = makeApi({
      listVersionLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'loc-en', locale: 'en-US', fields: {} }]),
    });
    const actions = await reconcileScreenshots(
      api,
      input({ screenshots: [shot({ locale: 'fr-FR' })] }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('locale not on the editable version'),
    });
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  });

  it('skips when there is no editable App Store version', async () => {
    const api = makeApi({ getEditableVersionId: vi.fn().mockResolvedValue(null) });
    const actions = await reconcileScreenshots(api, input({ screenshots: [shot()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no editable App Store version'),
    });
  });

  it("skips screenshots beyond Apple's per-set maximum", async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      fileName: `${i}.png`,
      sourceFileChecksum: `old-${i}`,
    }));
    const api = makeApi({
      listScreenshotSets: vi
        .fn()
        .mockResolvedValue([{ id: 'set1', screenshotDisplayType: 'APP_IPHONE_67' }]),
      listScreenshots: vi.fn().mockResolvedValue(existing),
    });
    const actions = await reconcileScreenshots(
      api,
      input({ screenshots: [shot({ fileName: '11.png', checksum: 'fresh' })] }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('set is full'),
    });
    expect(api.uploadScreenshot).not.toHaveBeenCalled();
  });
});

describe('reconcileScreenshots — subscription review screenshots', () => {
  const reviewInput = (
    items: SubscriptionReviewScreenshot[],
    over: Partial<ScreenshotReconcileInput> = {},
  ) => input({ subscriptionReviewScreenshots: items, ...over });

  function apiWithSubscription(over: Partial<ScreenshotsApi> = {}): ScreenshotsApi {
    return makeApi({
      listSubscriptionGroups: vi.fn().mockResolvedValue([{ id: 'g1', referenceName: 'Pro' }]),
      listSubscriptions: vi
        .fn()
        .mockResolvedValue([{ id: 'sub1', productId: 'com.acme.pro', name: 'Pro' }]),
      ...over,
    });
  }

  it('uploads the review screenshot when the subscription exists and the checksum differs', async () => {
    const api = apiWithSubscription();
    const actions = await reconcileScreenshots(
      api,
      reviewInput([{ productId: 'com.acme.pro', asset: asset() }]),
    );
    expect(actions.map((a) => a.status)).toEqual(['applied']);
    expect(api.uploadSubscriptionReviewScreenshot).toHaveBeenCalledWith(
      'sub1',
      'review.png',
      '/tmp/review.png',
    );
  });

  it('skips when the live review screenshot already matches the local checksum', async () => {
    const api = apiWithSubscription({
      getSubscriptionReviewScreenshot: vi
        .fn()
        .mockResolvedValue({ id: 'rs1', sourceFileChecksum: 'rev-sum' }),
    });
    const actions = await reconcileScreenshots(
      api,
      reviewInput([{ productId: 'com.acme.pro', asset: asset({ checksum: 'rev-sum' }) }]),
    );
    expect(actions).toEqual([]);
    expect(api.uploadSubscriptionReviewScreenshot).not.toHaveBeenCalled();
  });

  it("notes (skips) a subscription that isn't on App Store Connect yet", async () => {
    const api = makeApi(); // no subscription groups
    const actions = await reconcileScreenshots(
      api,
      reviewInput([{ productId: 'com.acme.pro', asset: asset() }]),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('not on App Store Connect yet'),
    });
    expect(api.uploadSubscriptionReviewScreenshot).not.toHaveBeenCalled();
  });
});

/**
 * A fully-stubbed {@link PreviewsApi}. Reads default to "an editable version with one en-US locale and no
 * previews yet"; writes resolve to a created resource. Override per test to set up other states.
 */
function makePreviewsApi(overrides: Partial<PreviewsApi> = {}): PreviewsApi {
  const base: PreviewsApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    getEditableVersionId: vi.fn().mockResolvedValue('ver1'),
    listVersionLocalizations: vi
      .fn()
      .mockResolvedValue([{ id: 'loc-en', locale: 'en-US', fields: {} }]),
    listPreviewSets: vi.fn().mockResolvedValue([]),
    createPreviewSet: vi
      .fn()
      .mockImplementation((_loc: string, previewType: string) =>
        Promise.resolve({ id: 'set-new', previewType }),
      ),
    listPreviews: vi.fn().mockResolvedValue([]),
    uploadPreview: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
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

describe('reconcilePreviews', () => {
  it('does nothing when there are no previews to reconcile', async () => {
    const api = makePreviewsApi();
    const actions = await reconcilePreviews(api, previewInput());
    expect(actions).toEqual([]);
    expect(api.getAppId).not.toHaveBeenCalled();
  });

  it('skips with guidance when the app has no App Store Connect record', async () => {
    const api = makePreviewsApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const actions = await reconcilePreviews(api, previewInput({ previews: [preview()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no App Store Connect app record'),
    });
  });

  it('skips when there is no editable App Store version', async () => {
    const api = makePreviewsApi({ getEditableVersionId: vi.fn().mockResolvedValue(null) });
    const actions = await reconcilePreviews(api, previewInput({ previews: [preview()] }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('no editable App Store version'),
    });
  });

  it('plans set creation + upload from an empty version without performing writes (dry-run)', async () => {
    const api = makePreviewsApi();
    const actions = await reconcilePreviews(
      api,
      previewInput({ previews: [preview()], dryRun: true }),
    );
    expect(actions.map((a) => a.description)).toEqual([
      'create preview set iPhone 6.7" [en-US]',
      'upload preview iPhone 6.7" [en-US] 01.mp4',
    ]);
    expect(actions.every((a) => a.status === 'planned')).toBe(true);
    expect(api.createPreviewSet).not.toHaveBeenCalled();
    expect(api.uploadPreview).not.toHaveBeenCalled();
  });

  it('creates the set and uploads on apply', async () => {
    const api = makePreviewsApi();
    const actions = await reconcilePreviews(api, previewInput({ previews: [preview()] }));
    expect(actions.every((a) => a.status === 'applied')).toBe(true);
    expect(api.createPreviewSet).toHaveBeenCalledWith('loc-en', 'IPHONE_67');
    expect(api.uploadPreview).toHaveBeenCalledWith('set-new', '01.mp4', '/tmp/01.mp4');
  });

  it('reuses an existing set and skips a preview already uploaded byte-for-byte (idempotent)', async () => {
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi
        .fn()
        .mockResolvedValue([{ id: 'p1', fileName: '01.mp4', sourceFileChecksum: 'sum-01' }]),
    });
    const actions = await reconcilePreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'sum-01' })] }),
    );
    expect(actions).toEqual([]);
    expect(api.createPreviewSet).not.toHaveBeenCalled();
    expect(api.uploadPreview).not.toHaveBeenCalled();
  });

  it('uploads a changed file (same name, new checksum) into the existing set', async () => {
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi
        .fn()
        .mockResolvedValue([{ id: 'p1', fileName: '01.mp4', sourceFileChecksum: 'old-sum' }]),
    });
    const actions = await reconcilePreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'new-sum' })] }),
    );
    expect(actions.map((a) => a.status)).toEqual(['applied']);
    expect(api.uploadPreview).toHaveBeenCalledWith('set1', '01.mp4', '/tmp/01.mp4');
  });

  it('re-uploads a matching checksum whose previous delivery FAILED', async () => {
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
    const actions = await reconcilePreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'sum-01' })] }),
    );
    expect(actions.map((a) => a.status)).toEqual(['applied']);
    expect(api.uploadPreview).toHaveBeenCalledWith('set1', '01.mp4', '/tmp/01.mp4');
  });

  it('treats an in-processing (non-FAILED) preview as already uploaded, so a re-run uploads nothing', async () => {
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
    const actions = await reconcilePreviews(
      api,
      previewInput({ previews: [preview({ checksum: 'sum-01' })] }),
    );
    expect(actions).toEqual([]);
    expect(api.uploadPreview).not.toHaveBeenCalled();
  });

  it("skips a locale that isn't on the editable version", async () => {
    const api = makePreviewsApi();
    const actions = await reconcilePreviews(
      api,
      previewInput({ previews: [preview({ locale: 'fr-FR' })] }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('locale not on the editable version'),
    });
    expect(api.uploadPreview).not.toHaveBeenCalled();
  });

  it("skips previews beyond Apple's per-set maximum", async () => {
    const existing = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`,
      fileName: `${i}.mp4`,
      sourceFileChecksum: `old-${i}`,
    }));
    const api = makePreviewsApi({
      listPreviewSets: vi.fn().mockResolvedValue([{ id: 'set1', previewType: 'IPHONE_67' }]),
      listPreviews: vi.fn().mockResolvedValue(existing),
    });
    const actions = await reconcilePreviews(
      api,
      previewInput({ previews: [preview({ fileName: '04.mp4', checksum: 'fresh' })] }),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      status: 'skipped',
      description: expect.stringContaining('set is full'),
    });
    expect(api.uploadPreview).not.toHaveBeenCalled();
  });
});
