import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetLaunchEnvironment } from '../services/platform/environment.ts';
import { summarize } from '../store/shared/reconcile.ts';
import type { ReleaseAttributesConfig } from '../types/store-surface.ts';
import {
  type AscReleaseApi,
  loadReleaseConfig,
  parseReleaseConfig,
  reconcileRelease,
} from './release-attributes.ts';

function makeReleaseApi(methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  return {
    getAppId: vi.fn(function readAppId() {
      return Promise.resolve('app1');
    }),
    getAppInfo: vi.fn(function readAppInfo() {
      return Promise.resolve({ id: 'info1' });
    }),
    updateAppInfoCategories: vi.fn(function updateCategories() {
      return Promise.resolve();
    }),
    getAgeRatingDeclaration: vi.fn(function readAgeRating() {
      return Promise.resolve({ id: 'age1', attributes: {} });
    }),
    updateAgeRatingDeclaration: vi.fn(function updateAgeRating() {
      return Promise.resolve();
    }),
    findAppPricePoint: vi.fn(function readPricePoint() {
      return Promise.resolve({ id: 'pp1', customerPrice: '9.99', territory: 'USA' });
    }),
    getCurrentAppPrice: vi.fn(function readCurrentPrice() {
      return Promise.resolve(null);
    }),
    createAppPriceSchedule: vi.fn(function createPriceSchedule() {
      return Promise.resolve();
    }),
    findEditableAppStoreVersion: vi.fn(function readEditableVersion() {
      return Promise.resolve({ id: 'v1' });
    }),
    getAppStoreReviewDetail: vi.fn(function readReviewDetail() {
      return Promise.resolve(null);
    }),
    createAppStoreReviewDetail: vi.fn(function createReviewDetail() {
      return Promise.resolve({ id: 'rd1' });
    }),
    updateAppStoreReviewDetail: vi.fn(function updateReviewDetail() {
      return Promise.resolve();
    }),
    ...methodOverrides,
  };
}

async function reconcile(
  appleReleaseApi: AscReleaseApi,
  releaseConfig: ReleaseAttributesConfig,
  dryRun = false,
) {
  return reconcileRelease(appleReleaseApi, {
    bundleId: 'com.acme.app',
    config: releaseConfig,
    dryRun,
  });
}

function decodeReleaseDocument(rawDocument: unknown): Promise<ReleaseAttributesConfig> {
  return Promise.resolve().then(function readConfig() {
    return parseReleaseConfig(rawDocument);
  });
}

afterEach(function resetEnvironmentFixtures() {
  resetLaunchEnvironment();
  vi.unstubAllEnvs();
});

function describeReleasePieceSchema() {
  async function rejectsANonObjectAnEmptyDocumentAndArrayShapedSections() {
    const releaseDocument = decodeReleaseDocument(42);

    await expect(releaseDocument).rejects.toMatchObject({
      message: expect.stringMatching(/must be a JSON object/),
    });
    await expect(decodeReleaseDocument({})).rejects.toMatchObject({
      message: expect.stringMatching(/no recognized section/),
    });
    await expect(
      decodeReleaseDocument({ categories: [], reviewDetails: [] }),
    ).rejects.toMatchObject({ _tag: 'ReleaseAttributesFailure' });
  }

  it(
    'rejects a non-object, an empty document, and array-shaped sections',
    rejectsANonObjectAnEmptyDocumentAndArrayShapedSections,
  );

  function decodesEverySupportedSection() {
    const releaseConfig = parseReleaseConfig({
      ageRating: { violenceCartoonOrFantasy: 'NONE', gambling: false },
      categories: { primary: 'PRODUCTIVITY', secondary: 'BUSINESS' },
      pricing: { baseTerritory: 'USA', customerPrice: 9.99 },
      reviewDetails: {
        contactEmail: 'a@b.co',
        demoAccountRequired: true,
        notes: 'n',
      },
    });

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
  }

  it('decodes every supported section', decodesEverySupportedSection);

  async function rejectsInvalidPricesAndAgeRatingSettings() {
    const releaseDocument = decodeReleaseDocument({ pricing: { customerPrice: -1 } });

    await expect(releaseDocument).rejects.toMatchObject({
      message: expect.stringMatching(/non-negative number/),
    });
    await expect(
      decodeReleaseDocument({ pricing: { customerPrice: '9.99' } }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/non-negative number/),
    });
    await expect(
      decodeReleaseDocument({ ageRating: { gambling: { nested: true } } }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/string or boolean/),
    });
  }

  it('rejects invalid prices and age-rating settings', rejectsInvalidPricesAndAgeRatingSettings);

  async function rejectsDeprecatedAgeRatingValuesAndAttributesWithTheReplacement() {
    const releaseDocument = decodeReleaseDocument({
      ageRating: { violenceRealistic: 'INFREQUENT_OR_MILD' },
    });

    await expect(releaseDocument).rejects.toMatchObject({
      message: expect.stringMatching(
        /violenceRealistic uses deprecated value INFREQUENT_OR_MILD: use INFREQUENT/,
      ),
    });
    await expect(
      decodeReleaseDocument({ ageRating: { contests: 'FREQUENT_OR_INTENSE' } }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /contests uses deprecated value FREQUENT_OR_INTENSE: use FREQUENT/,
      ),
    });
    await expect(
      decodeReleaseDocument({ ageRating: { kidsAgeBand: 'SIX_TO_EIGHT' } }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/ageRating.kidsAgeBand is deprecated/),
    });
    await expect(
      decodeReleaseDocument({ ageRating: { ageRatingOverride: 'NONE' } }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/use ageRatingOverrideV2/),
    });
  }

  it(
    'rejects deprecated age-rating values and attributes with the replacement',
    rejectsDeprecatedAgeRatingValuesAndAttributesWithTheReplacement,
  );

  async function readsAndDecodesASidecar() {
    const systemTemporaryDirectory = tmpdir();
    const launchReleaseAttrsPath = join(systemTemporaryDirectory, 'launch-release-attrs-');
    const temporaryDirectory = mkdtempSync(launchReleaseAttrsPath);
    const configPath = join(temporaryDirectory, 'release.config.json');

    try {
      const serialized = JSON.stringify({ pricing: { customerPrice: 4.99 } });
      writeFileSync(configPath, serialized);
      const releaseConfig = await loadReleaseConfig(configPath);
      expect(releaseConfig.pricing?.customerPrice).toBe(4.99);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  it('reads and decodes a sidecar', readsAndDecodesASidecar);
}

describe('release config schema', describeReleasePieceSchema);

function describeReleaseReconciliationPreconditions() {
  async function failsWhenTheAppPieceIsMissing() {
    const appleReleaseApi = makeReleaseApi({
      getAppId: vi.fn(function readMissingApp() {
        return Promise.resolve(null);
      }),
    });

    await expect(
      reconcile(appleReleaseApi, { pricing: { customerPrice: 9.99 } }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/No App Store Connect app record/) });
  }

  it('fails when the app record is missing', failsWhenTheAppPieceIsMissing);

  async function touchesOnlyDeclaredSections() {
    const appleReleaseApi = makeReleaseApi();

    await reconcile(appleReleaseApi, { pricing: { customerPrice: 4.99 } });
    expect(appleReleaseApi.getAppInfo).not.toHaveBeenCalled();
    expect(appleReleaseApi.findEditableAppStoreVersion).not.toHaveBeenCalled();
    expect(appleReleaseApi.getCurrentAppPrice).toHaveBeenCalledWith('app1', 'USA');
  }

  it('touches only declared sections', touchesOnlyDeclaredSections);
}

describe('release reconciliation preconditions', describeReleaseReconciliationPreconditions);

function describeReleaseCategoryReconciliation() {
  async function changesOnlyCategoriesThatDiffer() {
    function mockCall() {
      return Promise.resolve({
        id: 'info1',
        primaryCategoryId: 'PRODUCTIVITY',
        secondaryCategoryId: 'UTILITIES',
      });
    }

    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(mockCall),
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
  }

  it('changes only categories that differ', changesOnlyCategoriesThatDiffer);

  async function doesNothingWhenCategoriesPiece() {
    function mockCall2() {
      return Promise.resolve({
        id: 'info1',
        primaryCategoryId: 'GAMES',
        secondaryCategoryId: 'BUSINESS',
      });
    }

    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(mockCall2),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      categories: { primary: 'GAMES', secondary: 'BUSINESS' },
    });

    expect(appleReleaseApi.updateAppInfoCategories).not.toHaveBeenCalled();
    expect(reconciliationReport.actions).toHaveLength(0);
  }

  it('does nothing when categories match', doesNothingWhenCategoriesPiece);

  async function clearsAStaleSecondaryCategory() {
    function mockCall3() {
      return Promise.resolve({
        id: 'info1',
        primaryCategoryId: 'PRODUCTIVITY',
        secondaryCategoryId: 'HEALTH_AND_FITNESS',
      });
    }

    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(mockCall3),
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
  }

  it('clears a stale secondary category', clearsAStaleSecondaryCategory);

  async function skipsWhenAppPieceIsAbsent() {
    function mockCall4() {
      return Promise.resolve(null);
    }

    const appleReleaseApi = makeReleaseApi({
      getAppInfo: vi.fn(mockCall4),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      categories: { primary: 'GAMES' },
    });

    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'skipped' });
    expect(appleReleaseApi.updateAppInfoCategories).not.toHaveBeenCalled();
  }

  it('skips when App Info is absent', skipsWhenAppPieceIsAbsent);
}

describe('release category reconciliation', describeReleaseCategoryReconciliation);

function describeReleaseAgeRatingReconciliation() {
  async function patchesOnlyChangedAnswers() {
    function mockCall5() {
      return Promise.resolve({
        id: 'age1',
        attributes: { violenceCartoonOrFantasy: 'NONE', gambling: false },
      });
    }

    const appleReleaseApi = makeReleaseApi({
      getAgeRatingDeclaration: vi.fn(mockCall5),
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
  }

  it('patches only changed answers', patchesOnlyChangedAnswers);

  async function skipsWhenTheDeclarationIsAbsent() {
    function mockCall6() {
      return Promise.resolve(null);
    }

    const appleReleaseApi = makeReleaseApi({
      getAgeRatingDeclaration: vi.fn(mockCall6),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      ageRating: { gambling: true },
    });

    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'skipped' });
    expect(appleReleaseApi.updateAgeRatingDeclaration).not.toHaveBeenCalled();
  }

  it('skips when the declaration is absent', skipsWhenTheDeclarationIsAbsent);
}

describe('release age-rating reconciliation', describeReleaseAgeRatingReconciliation);

function describeReleasePricingReconciliation() {
  async function resolvesAPricePointWhenThePriceDiffers() {
    function mockCall7() {
      return Promise.resolve('4.99');
    }

    const appleReleaseApi = makeReleaseApi({
      getCurrentAppPrice: vi.fn(mockCall7),
    });

    await reconcile(appleReleaseApi, { pricing: { customerPrice: 9.99 } });
    expect(appleReleaseApi.findAppPricePoint).toHaveBeenCalledWith('app1', 'USA', 9.99);
    expect(appleReleaseApi.createAppPriceSchedule).toHaveBeenCalledWith('app1', 'USA', 'pp1');
  }

  it('resolves a price point when the price differs', resolvesAPricePointWhenThePriceDiffers);

  async function doesNothingWhenTheCurrentPriceMatches() {
    function mockCall8() {
      return Promise.resolve('9.99');
    }

    const appleReleaseApi = makeReleaseApi({
      getCurrentAppPrice: vi.fn(mockCall8),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      pricing: { customerPrice: 9.99 },
    });

    expect(appleReleaseApi.createAppPriceSchedule).not.toHaveBeenCalled();
    expect(reconciliationReport.actions).toHaveLength(0);
  }

  it('does nothing when the current price matches', doesNothingWhenTheCurrentPriceMatches);

  async function recordsAFailedActionWhenNoPricePointMatches() {
    function mockCall9() {
      return Promise.resolve(null);
    }

    const appleReleaseApi = makeReleaseApi({
      findAppPricePoint: vi.fn(mockCall9),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      pricing: { customerPrice: 12.34 },
    });

    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'failed' });
    expect(reconciliationReport.actions[0]?.error).toMatch(/No USA app price point/);
  }

  it(
    'records a failed action when no price point matches',
    recordsAFailedActionWhenNoPricePointMatches,
  );

  async function plansWithoutWritingDuringADryRun() {
    const appleReleaseApi = makeReleaseApi();
    const reconciliationReport = await reconcile(
      appleReleaseApi,
      { pricing: { customerPrice: 9.99 } },
      true,
    );

    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'planned' });
    expect(appleReleaseApi.findAppPricePoint).not.toHaveBeenCalled();
    expect(appleReleaseApi.createAppPriceSchedule).not.toHaveBeenCalled();
  }

  it('plans without writing during a dry run', plansWithoutWritingDuringADryRun);
}

describe('release pricing reconciliation', describeReleasePricingReconciliation);

function describeReleaseReviewDetailReconciliation() {
  async function createsMissingDetailsWithEveryDeclaredField() {
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
  }

  it(
    'creates missing details with every declared field',
    createsMissingDetailsWithEveryDeclaredField,
  );

  async function updatesChangedFieldsWithoutRenderingADemoPassword() {
    const demoPassword = ['demo', 'review', 'pw'].join('-');

    function mockCall10() {
      return Promise.resolve({
        id: 'rd1',
        attributes: { contactEmail: 'old@b.co', demoAccountRequired: true },
      });
    }

    const appleReleaseApi = makeReleaseApi({
      getAppStoreReviewDetail: vi.fn(mockCall10),
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
  }

  it(
    'updates changed fields without rendering a demo password',
    updatesChangedFieldsWithoutRenderingADemoPassword,
  );

  async function resolvesAnEnvironmentPasswordOnlyWhileApplying() {
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
  }

  it(
    'resolves an environment password only while applying',
    resolvesAnEnvironmentPasswordOnlyWhileApplying,
  );

  async function doesNotResolvePasswordsDuringADryRun() {
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
  }

  it('does not resolve passwords during a dry run', doesNotResolvePasswordsDuringADryRun);

  async function doesNothingWhenReadableFieldsPiece() {
    function mockCall11() {
      return Promise.resolve({ id: 'rd1', attributes: { contactEmail: 'a@b.co' } });
    }

    const appleReleaseApi = makeReleaseApi({
      getAppStoreReviewDetail: vi.fn(mockCall11),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      reviewDetails: { contactEmail: 'a@b.co' },
    });

    expect(appleReleaseApi.updateAppStoreReviewDetail).not.toHaveBeenCalled();
    expect(reconciliationReport.actions).toHaveLength(0);
  }

  it('does nothing when readable fields match', doesNothingWhenReadableFieldsPiece);

  async function skipsWhenNoEditableVersionExists() {
    function mockCall12() {
      return Promise.resolve(null);
    }

    const appleReleaseApi = makeReleaseApi({
      findEditableAppStoreVersion: vi.fn(mockCall12),
    });
    const reconciliationReport = await reconcile(appleReleaseApi, {
      reviewDetails: { contactEmail: 'a@b.co' },
    });

    expect(reconciliationReport.actions[0]).toMatchObject({ status: 'skipped' });
    expect(appleReleaseApi.createAppStoreReviewDetail).not.toHaveBeenCalled();
  }

  it('skips when no editable version exists', skipsWhenNoEditableVersionExists);
}

describe('release review-detail reconciliation', describeReleaseReviewDetailReconciliation);

function describeReleaseActionSummary() {
  function countsActionStatuses() {
    expect(
      summarize([
        { description: 'a', destructive: false, status: 'applied' },
        { description: 'b', destructive: false, status: 'failed', error: 'x' },
        { description: 'c', destructive: false, status: 'skipped' },
        { description: 'd', destructive: false, status: 'applied' },
      ]),
    ).toEqual({ applied: 2, failed: 1, skipped: 1 });
  }

  it('counts action statuses', countsActionStatuses);
}

describe('release action summary', describeReleaseActionSummary);
