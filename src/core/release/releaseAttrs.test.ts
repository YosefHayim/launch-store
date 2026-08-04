import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { LaunchSecretStoreTest } from '../services/secretStore.js';
import { summarize } from '../store/reconcile.js';
import type { ReleaseAttributesConfig } from '../types/storeSurface.js';
import {
  type AscReleaseApi,
  loadReleaseConfig,
  parseReleaseConfig,
  reconcileRelease,
} from './releaseAttrs.js';

/** Build a configurable Effect-native release API fake. */
const makeReleaseApi = (methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi => ({
  getAppId: vi.fn(() => Effect.succeed('app1')),
  getAppInfo: vi.fn(() => Effect.succeed({ id: 'info1' })),
  updateAppInfoCategories: vi.fn(() => Effect.void),
  getAgeRatingDeclaration: vi.fn(() => Effect.succeed({ id: 'age1', attributes: {} })),
  updateAgeRatingDeclaration: vi.fn(() => Effect.void),
  findAppPricePoint: vi.fn(() =>
    Effect.succeed({ id: 'pp1', customerPrice: '9.99', territory: 'USA' }),
  ),
  getCurrentAppPrice: vi.fn(() => Effect.succeed(null)),
  createAppPriceSchedule: vi.fn(() => Effect.void),
  findEditableAppStoreVersion: vi.fn(() => Effect.succeed({ id: 'v1' })),
  getAppStoreReviewDetail: vi.fn(() => Effect.succeed(null)),
  createAppStoreReviewDetail: vi.fn(() => Effect.succeed({ id: 'rd1' })),
  updateAppStoreReviewDetail: vi.fn(() => Effect.void),
  ...methodOverrides,
});

/** Run release reconciliation with deterministic secret services. */
const reconcile = (
  appleReleaseApi: AscReleaseApi,
  releaseConfig: ReleaseAttributesConfig,
  dryRun = false,
) =>
  Effect.runPromise(
    reconcileRelease(appleReleaseApi, {
      bundleId: 'com.acme.app',
      config: releaseConfig,
      dryRun,
    }).pipe(
      Effect.provide(Layer.merge(makeLaunchEnvironmentTest(process.env), LaunchSecretStoreTest)),
    ),
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('release config schema', () => {
  it('rejects a non-object, an empty document, and array-shaped sections', async () => {
    await expect(Effect.runPromise(parseReleaseConfig(42))).rejects.toThrow(
      /must be a JSON object/,
    );
    await expect(Effect.runPromise(parseReleaseConfig({}))).rejects.toThrow(
      /no recognized section/,
    );
    await expect(
      Effect.runPromise(parseReleaseConfig({ categories: [], reviewDetails: [] })),
    ).rejects.toThrow();
  });

  it('decodes every supported section', async () => {
    const releaseConfig = await Effect.runPromise(
      parseReleaseConfig({
        ageRating: { violenceCartoonOrFantasy: 'NONE', gambling: false },
        categories: { primary: 'PRODUCTIVITY', secondary: 'BUSINESS' },
        pricing: { baseTerritory: 'USA', customerPrice: 9.99 },
        reviewDetails: {
          contactEmail: 'a@b.co',
          demoAccountRequired: true,
          notes: 'n',
        },
      }),
    );
    expect(releaseConfig).toEqual({
      ageRating: { violenceCartoonOrFantasy: 'NONE', gambling: false },
      categories: { primary: 'PRODUCTIVITY', secondary: 'BUSINESS' },
      pricing: { baseTerritory: 'USA', customerPrice: 9.99 },
      reviewDetails: {
        contactEmail: 'a@b.co',
        demoAccountRequired: true,
        notes: 'n',
      },
    });
  });

  it('rejects invalid prices and age-rating settings', async () => {
    await expect(
      Effect.runPromise(parseReleaseConfig({ pricing: { customerPrice: -1 } })),
    ).rejects.toThrow(/non-negative number/);
    await expect(
      Effect.runPromise(parseReleaseConfig({ pricing: { customerPrice: '9.99' } })),
    ).rejects.toThrow(/non-negative number/);
    await expect(
      Effect.runPromise(parseReleaseConfig({ ageRating: { gambling: { nested: true } } })),
    ).rejects.toThrow(/string or boolean/);
  });

  it('reads and decodes a sidecar through Effect Platform', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-release-attrs-'));
    const configPath = join(temporaryDirectory, 'release.config.json');
    try {
      writeFileSync(configPath, JSON.stringify({ pricing: { customerPrice: 4.99 } }));
      const releaseConfig = await Effect.runPromise(
        loadReleaseConfig(configPath).pipe(Effect.provide(NodeContext.layer)),
      );
      expect(releaseConfig.pricing?.customerPrice).toBe(4.99);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe('release reconciliation preconditions', () => {
  it('fails when the app record is missing', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAppId: vi.fn(() => Effect.succeed(null)),
    });
    await expect(reconcile(appleReleaseApi, { pricing: { customerPrice: 9.99 } })).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it('touches only declared sections', async () => {
    const appleReleaseApi = makeReleaseApi();
    await reconcile(appleReleaseApi, { pricing: { customerPrice: 4.99 } });
    expect(appleReleaseApi.getAppInfo).not.toHaveBeenCalled();
    expect(appleReleaseApi.findEditableAppStoreVersion).not.toHaveBeenCalled();
    expect(appleReleaseApi.getCurrentAppPrice).toHaveBeenCalledWith('app1', 'USA');
  });
});

describe('release category reconciliation', () => {
  it('changes only categories that differ', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(() =>
        Effect.succeed({
          id: 'info1',
          primaryCategoryId: 'PRODUCTIVITY',
          secondaryCategoryId: 'UTILITIES',
        }),
      ),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      categories: { primary: 'PRODUCTIVITY', secondary: 'BUSINESS' },
    });
    expect(appleReleaseApi.updateAppInfoCategories).toHaveBeenCalledWith('info1', {
      secondaryCategoryId: 'BUSINESS',
    });
    expect(reconciliationReport.actions).toEqual([
      expect.objectContaining({
        status: 'applied',
        description: 'set categories (secondary=BUSINESS)',
      }),
    ]);
  });

  it('does nothing when categories match', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(() =>
        Effect.succeed({
          id: 'info1',
          primaryCategoryId: 'GAMES',
          secondaryCategoryId: 'BUSINESS',
        }),
      ),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      categories: { primary: 'GAMES', secondary: 'BUSINESS' },
    });
    expect(appleReleaseApi.updateAppInfoCategories).not.toHaveBeenCalled();
    expect(reconciliationReport.actions).toHaveLength(0);
  });

  it('clears a stale secondary category', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(() =>
        Effect.succeed({
          id: 'info1',
          primaryCategoryId: 'PRODUCTIVITY',
          secondaryCategoryId: 'HEALTH_AND_FITNESS',
        }),
      ),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      categories: { primary: 'PRODUCTIVITY' },
    });
    expect(appleReleaseApi.updateAppInfoCategories).toHaveBeenCalledWith('info1', {
      secondaryCategoryId: null,
    });
    expect(reconciliationReport.actions[0]).toMatchObject({
      status: 'applied',
      description: 'set categories (secondary=unset)',
    });
  });

  it('skips when App Info is absent', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(() => Effect.succeed(null)),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      categories: { primary: 'GAMES' },
    });
    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'skipped' });
    expect(appleReleaseApi.updateAppInfoCategories).not.toHaveBeenCalled();
  });
});

describe('release age-rating reconciliation', () => {
  it('patches only changed answers', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAgeRatingDeclaration: vi.fn(() =>
        Effect.succeed({
          id: 'age1',
          attributes: { violenceCartoonOrFantasy: 'NONE', gambling: false },
        }),
      ),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      ageRating: { violenceCartoonOrFantasy: 'NONE', gambling: true },
    });
    expect(appleReleaseApi.updateAgeRatingDeclaration).toHaveBeenCalledWith('age1', {
      gambling: true,
    });
    expect(reconciliationReport.actions[0]).toMatchObject({
      status: 'applied',
      description: 'set age rating (gambling)',
    });
  });

  it('skips when the declaration is absent', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAgeRatingDeclaration: vi.fn(() => Effect.succeed(null)),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      ageRating: { gambling: true },
    });
    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'skipped' });
    expect(appleReleaseApi.updateAgeRatingDeclaration).not.toHaveBeenCalled();
  });
});

describe('release pricing reconciliation', () => {
  it('resolves a price point when the price differs', async () => {
    const appleReleaseApi = makeReleaseApi({
      getCurrentAppPrice: vi.fn(() => Effect.succeed('4.99')),
    });
    await reconcile(appleReleaseApi, { pricing: { customerPrice: 9.99 } });
    expect(appleReleaseApi.findAppPricePoint).toHaveBeenCalledWith('app1', 'USA', 9.99);
    expect(appleReleaseApi.createAppPriceSchedule).toHaveBeenCalledWith('app1', 'USA', 'pp1');
  });

  it('does nothing when the current price matches', async () => {
    const appleReleaseApi = makeReleaseApi({
      getCurrentAppPrice: vi.fn(() => Effect.succeed('9.99')),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      pricing: { customerPrice: 9.99 },
    });
    expect(appleReleaseApi.createAppPriceSchedule).not.toHaveBeenCalled();
    expect(reconciliationReport.actions).toHaveLength(0);
  });

  it('records a failed action when no price point matches', async () => {
    const appleReleaseApi = makeReleaseApi({
      findAppPricePoint: vi.fn(() => Effect.succeed(null)),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      pricing: { customerPrice: 12.34 },
    });
    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'failed' });
    expect(reconciliationReport.actions[0]?.error).toMatch(/No USA app price point/);
  });

  it('plans without writing during a dry run', async () => {
    const appleReleaseApi = makeReleaseApi();
    const reconciliationReport = await reconcile(
      appleReleaseApi,
      { pricing: { customerPrice: 9.99 } },
      true,
    );
    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'planned' });
    expect(appleReleaseApi.findAppPricePoint).not.toHaveBeenCalled();
    expect(appleReleaseApi.createAppPriceSchedule).not.toHaveBeenCalled();
  });
});

describe('release review-detail reconciliation', () => {
  it('creates missing details with every declared field', async () => {
    const appleReleaseApi = makeReleaseApi();
    await reconcile(appleReleaseApi, {
      reviewDetails: {
        contactEmail: 'a@b.co',
        demoAccountRequired: false,
      },
    });
    expect(appleReleaseApi.createAppStoreReviewDetail).toHaveBeenCalledWith('v1', {
      contactEmail: 'a@b.co',
      demoAccountRequired: false,
    });
  });

  it('updates changed fields without rendering a demo password', async () => {
    const demoPassword = ['demo', 'review', 'pw'].join('-');
    const appleReleaseApi = makeReleaseApi({
      getAppStoreReviewDetail: vi.fn(() =>
        Effect.succeed({
          id: 'rd1',
          attributes: { contactEmail: 'old@b.co', demoAccountRequired: true },
        }),
      ),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      reviewDetails: {
        contactEmail: 'new@b.co',
        demoAccountRequired: true,
        demoAccountPassword: demoPassword,
      },
    });
    expect(appleReleaseApi.updateAppStoreReviewDetail).toHaveBeenCalledWith('rd1', {
      contactEmail: 'new@b.co',
      demoAccountPassword: demoPassword,
    });
    expect(reconciliationReport.actions[0]?.description).toContain('demoAccountPassword');
    expect(reconciliationReport.actions[0]?.description).not.toContain(demoPassword);
  });

  it('resolves an environment password only while applying', async () => {
    const environmentVariableName = 'LAUNCH_TEST_REVIEW_PW';
    const storedSecret = ['env', 'review', 'pw'].join('-');
    vi.stubEnv(environmentVariableName, storedSecret);
    const appleReleaseApi = makeReleaseApi();
    const reconciliationReport = await reconcile(appleReleaseApi, {
      reviewDetails: {
        contactEmail: 'a@b.co',
        demoAccountPassword: `env:${environmentVariableName}`,
      },
    });
    expect(appleReleaseApi.createAppStoreReviewDetail).toHaveBeenCalledWith('v1', {
      contactEmail: 'a@b.co',
      demoAccountPassword: storedSecret,
    });
    expect(reconciliationReport.actions[0]?.description).not.toContain(storedSecret);
    expect(reconciliationReport.actions[0]?.description).not.toContain(environmentVariableName);
  });

  it('does not resolve passwords during a dry run', async () => {
    const appleReleaseApi = makeReleaseApi();
    const reconciliationReport = await reconcile(
      appleReleaseApi,
      {
        reviewDetails: {
          contactEmail: 'a@b.co',
          demoAccountPassword: 'env:LAUNCH_TEST_UNSET_PW',
        },
      },
      true,
    );
    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'planned' });
    expect(appleReleaseApi.createAppStoreReviewDetail).not.toHaveBeenCalled();
  });

  it('does nothing when readable fields match', async () => {
    const appleReleaseApi = makeReleaseApi({
      getAppStoreReviewDetail: vi.fn(() =>
        Effect.succeed({ id: 'rd1', attributes: { contactEmail: 'a@b.co' } }),
      ),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      reviewDetails: { contactEmail: 'a@b.co' },
    });
    expect(appleReleaseApi.updateAppStoreReviewDetail).not.toHaveBeenCalled();
    expect(reconciliationReport.actions).toHaveLength(0);
  });

  it('skips when no editable version exists', async () => {
    const appleReleaseApi = makeReleaseApi({
      findEditableAppStoreVersion: vi.fn(() => Effect.succeed(null)),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      reviewDetails: { contactEmail: 'a@b.co' },
    });
    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'skipped' });
    expect(appleReleaseApi.createAppStoreReviewDetail).not.toHaveBeenCalled();
  });
});

describe('release action summary', () => {
  it('counts action statuses', () => {
    expect(
      summarize([
        { description: 'a', destructive: false, status: 'applied' },
        { description: 'b', destructive: false, status: 'failed', error: 'x' },
        { description: 'c', destructive: false, status: 'skipped' },
        { description: 'd', destructive: false, status: 'applied' },
      ]),
    ).toEqual({ applied: 2, failed: 1, skipped: 1 });
  });
});
