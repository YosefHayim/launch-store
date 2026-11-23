import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdoptCatalogApi, AdoptTarget, Adopter, PlannedWrite } from '../types/adopt.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { InAppPurchaseConfig } from '../types/catalog.ts';
import {
  applyAdopt,
  type ApplyContext,
  collectAdoptedProducts,
  describeAdoptSignal,
  detectTargets,
  planTargets,
  type TargetPlan,
} from './orchestrator.ts';

function ready<Value>(value: Value): Promise<Value> {
  return Promise.resolve(value);
}

/** Empty catalog fake; override only the reads a scenario needs. */
function emptyAdoptCatalog(overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi {
  const baseCatalog = {
    getAppId() {
      return ready('app1');
    },
    getLatestMarketingVersion() {
      return ready('2.1');
    },
    getLatestBuildNumber() {
      return ready(12);
    },
    findBundleId() {
      return ready(null);
    },
    listBundleIdCapabilities() {
      return ready([]);
    },
    listProfilesForBundleId() {
      return ready([]);
    },
    listMerchantIds() {
      return ready([]);
    },
    listInAppPurchases() {
      return ready([]);
    },
    listInAppPurchaseLocalizations() {
      return ready([]);
    },
    inAppPurchaseHasPrice() {
      return ready(false);
    },
    listSubscriptionGroups() {
      return ready([]);
    },
    listSubscriptionGroupLocalizations() {
      return ready([]);
    },
    listSubscriptions() {
      return ready([]);
    },
    listSubscriptionLocalizations() {
      return ready([]);
    },
    subscriptionHasPrice() {
      return ready(false);
    },
    listDistributionCertificates() {
      return ready([]);
    },
  };

  return { ...baseCatalog, ...overrides } as AdoptCatalogApi;
}

function appDescriptor(
  name: string,
  bundleId?: string,
  configPath = `/repo/${name}/app.json`,
): AppDescriptor {
  const descriptor: AppDescriptor = { name, dir: `/repo/${name}`, configPath };

  if (bundleId != null) {
    descriptor.bundleId = bundleId;
  }

  return descriptor;
}
function describeDescribeAdoptSignal() {
  function joinsLiveVersionAndBuildCountWithSingularBuildLabel() {
    const adoptSignal = describeAdoptSignal('2.1', 12);

    expect(adoptSignal).toBe('v2.1 live - 12 builds');
    expect(describeAdoptSignal('1.0', 1)).toBe('v1.0 live - 1 build');
    expect(describeAdoptSignal(null, 0)).toBe('registered, no builds yet');
    expect(describeAdoptSignal(null, 3)).toBe('3 builds');
    expect(describeAdoptSignal('3.0', 0)).toBe('v3.0 live');
  }

  it(
    'joins live version and build count, with singular build label',
    joinsLiveVersionAndBuildCountWithSingularBuildLabel,
  );
}

describe('describeAdoptSignal', describeDescribeAdoptSignal);
function describeDetectTargets() {
  async function separatesAppsWithALivePieceFromThoseSkippedWithAConfirmingSignal() {
    const appleCatalog = emptyAdoptCatalog({
      getAppId(bundleId: string) {
        if (bundleId == 'com.acme.good') {
          return ready('app-good');
        }

        return ready(null);
      },
    });
    const detection = await detectTargets(
      appleCatalog,
      [
        appDescriptor('good', 'com.acme.good'),
        appDescriptor('norec', 'com.acme.norec'),
        appDescriptor('android'),
      ],
      {
        keyId: 'K',
        cwd: '/repo',
        hasLaunchConfig: false,
      },
    );

    expect(detection.detected).toHaveLength(1);

    const detectedApp = detection.detected[0];

    expect(detectedApp).toBeDefined();

    if (detectedApp == null) {
      return;
    }

    expect(detectedApp.signal).toBe('v2.1 live - 12 builds');

    function writeSkippedLine(skipped: { readonly app: AppDescriptor; readonly reason: string }) {
      return `${skipped.app.name}: ${skipped.reason}`;
    }

    expect(detection.skipped.map(writeSkippedLine)).toEqual([
      'android: no iOS bundle id',
      'norec: no App Store Connect record (create the app once in App Store Connect)',
    ]);
  }

  it(
    'separates apps with a live record from those skipped, with a confirming signal',
    separatesAppsWithALivePieceFromThoseSkippedWithAConfirmingSignal,
  );
}

describe('detectTargets', describeDetectTargets);
function describePlanTargets() {
  async function collectsEachAdopterSWritesAndIsolatesAnAdopterThatFails() {
    const goodAdopter: Adopter = {
      domain: 'good',
      fidelity: 'importable',
      async read() {
        return [
          {
            description: 'did a thing',
            fidelity: 'importable',
            change: { home: 'keychain' },
          } satisfies PlannedWrite,
        ];
      },
    };
    const badAdopter: Adopter = {
      domain: 'bad',
      fidelity: 'detect',
      async read() {
        throw new Error('boom');
      },
    };
    const detection = {
      detected: [
        {
          target: {
            app: appDescriptor('good', 'com.acme.good'),
            appId: 'a',
            bundleId: 'com.acme.good',
            keyId: 'K',
            cwd: '/repo',
            hasLaunchConfig: false,
          },
          signal: 'x',
        },
      ],
      skipped: [],
    };
    const [targetPlan] = await planTargets(emptyAdoptCatalog(), detection, [
      goodAdopter,
      badAdopter,
    ]);

    expect(targetPlan).toBeDefined();

    if (targetPlan == null) {
      return;
    }

    expect(targetPlan.writes).toHaveLength(1);
    expect(targetPlan.errors).toEqual([{ domain: 'bad', message: 'boom' }]);
  }

  it(
    "collects each adopter's writes and isolates an adopter that fails",
    collectsEachAdopterSWritesAndIsolatesAnAdopterThatFails,
  );
}

describe('planTargets', describePlanTargets);
function describeCollectAdoptedProducts() {
  function aggregatesLaunchPieceProductPiecesByBundleId() {
    const iap: InAppPurchaseConfig = {
      productId: 'com.acme.coins',
      referenceName: 'Coins',
      type: 'CONSUMABLE',
      localizations: [{ locale: 'en-US', name: 'Coins' }],
    };
    const products = collectAdoptedProducts([
      {
        detected: {
          target: {
            app: appDescriptor('acme', 'com.acme.app'),
            appId: 'a',
            bundleId: 'com.acme.app',
            keyId: 'K',
            cwd: '/repo',
            hasLaunchConfig: false,
          },
          signal: 'x',
        },
        writes: [
          {
            description: 'import',
            fidelity: 'importable',
            change: {
              home: 'launch.config',
              bundleId: 'com.acme.app',
              piece: { type: 'iap', iap },
            },
          },
          {
            description: 'cert',
            fidelity: 'detect',
            change: { home: 'keychain' },
          },
        ],
        errors: [],
      },
    ]);

    expect(products).toEqual({
      'com.acme.app': { inAppPurchases: [iap] },
    });
  }

  it(
    'aggregates launch.config product pieces by bundle id',
    aggregatesLaunchPieceProductPiecesByBundleId,
  );
}

describe('collectAdoptedProducts', describeCollectAdoptedProducts);
function describeApplyAdopt() {
  let workspaceDir: string;

  function prepareApplyAdopt() {
    const systemTemporaryDirectory = tmpdir();
    const launchAdoptTestPath = join(systemTemporaryDirectory, 'launch-adopt-test-');
    workspaceDir = mkdtempSync(launchAdoptTestPath);
  }

  beforeEach(prepareApplyAdopt);

  function cleanupApplyAdopt() {
    rmSync(workspaceDir, { recursive: true, force: true });
  }

  afterEach(cleanupApplyAdopt);

  const IAP: InAppPurchaseConfig = {
    productId: 'com.acme.coins',
    referenceName: 'Coins',
    type: 'CONSUMABLE',
    localizations: [{ locale: 'en-US', name: 'Coins' }],
  };

  function plan(target: AdoptTarget, writes: PlannedWrite[]): TargetPlan {
    return {
      detected: { target, signal: 'x' },
      writes,
      errors: [],
    };
  }

  async function pullNothing(): Promise<void> {
    return undefined;
  }

  function applyContext(pullListing: ApplyContext['pullListing']): ApplyContext {
    return {
      cwd: workspaceDir,
      hasLaunchConfig: false,
      appRoot: null,
      pullListing,
    };
  }
  async function writesAFreshLaunchPieceTsWithTheImportedProductsWhenTheRepoHasNone() {
    const target: AdoptTarget = {
      app: appDescriptor('acme', 'com.acme.app'),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: workspaceDir,
      hasLaunchConfig: false,
    };
    const apply = applyContext(pullNothing);
    const adoptionSummary = await applyAdopt(
      [
        plan(target, [
          {
            description: 'import',
            fidelity: 'importable',
            change: {
              home: 'launch.config',
              bundleId: 'com.acme.app',
              piece: { type: 'iap', iap: IAP },
            },
          },
        ]),
      ],
      apply,
    );
    const launchPath = join(workspaceDir, 'launch.config.ts');

    expect(adoptionSummary.configWritten).toBe(launchPath);

    const joinedPath = join(workspaceDir, 'launch.config.ts');
    const written = readFileSync(joinedPath, 'utf8');

    expect(written).toContain('"com.acme.app"');
    expect(written).toContain('"com.acme.coins"');
  }

  it(
    'writes a fresh launch.config.ts with the imported products when the repo has none',
    writesAFreshLaunchPieceTsWithTheImportedProductsWhenTheRepoHasNone,
  );

  async function printsDoesNotSpliceTheProductsBlockWhenALaunchPieceTsAlreadyExists() {
    const target: AdoptTarget = {
      app: appDescriptor('acme', 'com.acme.app'),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: workspaceDir,
      hasLaunchConfig: true,
    };
    const adoptionSummary = await applyAdopt(
      [
        plan(target, [
          {
            description: 'import',
            fidelity: 'importable',
            change: {
              home: 'launch.config',
              bundleId: 'com.acme.app',
              piece: { type: 'iap', iap: IAP },
            },
          },
        ]),
      ],
      {
        cwd: workspaceDir,
        hasLaunchConfig: true,
        appRoot: null,
        pullListing: pullNothing,
      },
    );

    expect(adoptionSummary.configWritten).toBeUndefined();
    expect(adoptionSummary.configBlock).toContain('products: {');
  }

  it(
    'prints (does not splice) the products block when a launch.config.ts already exists',
    printsDoesNotSpliceTheProductsBlockWhenALaunchPieceTsAlreadyExists,
  );

  async function patchesAStaticAppPieceSEntitlementsAndReportsTheAddedKeys() {
    const configPath = join(workspaceDir, 'app.json');
    const serialized = JSON.stringify(
      { expo: { ios: { bundleIdentifier: 'com.acme.app' } } },
      null,
      2,
    );

    writeFileSync(configPath, serialized);

    const target: AdoptTarget = {
      app: appDescriptor('acme', 'com.acme.app', configPath),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: workspaceDir,
      hasLaunchConfig: true,
    };
    const adoptionSummary = await applyAdopt(
      [
        plan(target, [
          {
            description: 'ent',
            fidelity: 'advisory',
            change: { home: 'app.json', configPath, key: 'aps-environment', value: 'production' },
          },
        ]),
      ],
      {
        cwd: workspaceDir,
        hasLaunchConfig: true,
        appRoot: null,
        pullListing: pullNothing,
      },
    );

    expect(adoptionSummary.appJsonPatched).toEqual([
      { app: 'acme', configPath, added: ['aps-environment'] },
    ]);

    const loadedFile = readFileSync(configPath, 'utf8');
    const patchedDocument: unknown = JSON.parse(loadedFile);

    expect(patchedDocument).toMatchObject({
      expo: { ios: { entitlements: { 'aps-environment': 'production' } } },
    });
  }

  it(
    "patches a static app.json's entitlements and reports the added keys",
    patchesAStaticAppPieceSEntitlementsAndReportsTheAddedKeys,
  );

  async function printsAPasteBlockWritesNothingForADynamicAppPieceJs() {
    const configPath = join(workspaceDir, 'app.config.js');
    const target: AdoptTarget = {
      app: appDescriptor('acme', 'com.acme.app', configPath),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: workspaceDir,
      hasLaunchConfig: true,
    };
    const adoptionSummary = await applyAdopt(
      [
        plan(target, [
          {
            description: 'ent',
            fidelity: 'advisory',
            change: { home: 'app.json', configPath, key: 'aps-environment', value: 'production' },
          },
        ]),
      ],
      {
        cwd: workspaceDir,
        hasLaunchConfig: true,
        appRoot: null,
        pullListing: pullNothing,
      },
    );

    expect(adoptionSummary.appJsonPatched).toEqual([]);
    expect(adoptionSummary.appJsonBlocks).toHaveLength(1);

    const pasteBlock = adoptionSummary.appJsonBlocks[0];

    expect(pasteBlock).toBeDefined();

    if (pasteBlock == null) {
      return;
    }

    expect(pasteBlock.block).toContain('aps-environment');
  }

  it(
    'prints a paste block (writes nothing) for a dynamic app.config.js',
    printsAPasteBlockWritesNothingForADynamicAppPieceJs,
  );

  async function delegatesAListingPullAndRecordsSuccessCapturesADelegateFailure() {
    const target: AdoptTarget = {
      app: appDescriptor('acme', 'com.acme.app'),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: workspaceDir,
      hasLaunchConfig: true,
    };
    const storeConfig = join(workspaceDir, 'store.config.json');
    const writes: PlannedWrite[] = [
      {
        description: 'listing',
        fidelity: 'importable',
        change: {
          home: 'store.config',
          bundleId: 'com.acme.app',
          configPath: storeConfig,
          appName: 'acme',
        },
      },
    ];
    const successfulPull = vi.fn(pullNothing);
    const successfulAdoption = await applyAdopt([plan(target, writes)], {
      cwd: workspaceDir,
      hasLaunchConfig: true,
      appRoot: null,
      pullListing: successfulPull,
    });

    expect(successfulPull).toHaveBeenCalledWith('com.acme.app', storeConfig);
    expect(successfulAdoption.listingsPulled).toEqual(['acme']);

    async function failPull(): Promise<void> {
      throw new Error('App Store Connect unreachable');
    }

    const failedPull = vi.fn(failPull);
    const failedAdoption = await applyAdopt([plan(target, writes)], {
      cwd: workspaceDir,
      hasLaunchConfig: true,
      appRoot: null,
      pullListing: failedPull,
    });

    expect(failedAdoption.listingErrors).toEqual([
      { app: 'acme', message: 'App Store Connect unreachable' },
    ]);
  }

  it(
    'delegates a listing pull and records success; captures a delegate failure',
    delegatesAListingPullAndRecordsSuccessCapturesADelegateFailure,
  );
}

describe('applyAdopt', describeApplyAdopt);
