import { describe, expect, it } from 'vitest';
import type { AppDescriptor } from '../types/app.ts';
import type { PlannedWrite } from '../types/adopt.ts';
import {
  adoptFidelityMarker,
  AdoptCommandInputSchema,
  countAdoptMutations,
  detectSharedAppRoot,
  selectAdoptApps,
} from './command.ts';
import type { TargetPlan } from './adoption.ts';

function discoveredApp(appName: string, dir: string = `/workspace/${appName}`): AppDescriptor {
  return {
    name: appName,
    dir,
    configPath: `${dir}/app.json`,
  };
}

function targetPlanWithWrites(writes: readonly PlannedWrite[]): TargetPlan {
  return {
    detected: {
      target: {
        app: discoveredApp('acme'),
        appId: 'a1',
        bundleId: 'com.acme.app',
        keyId: 'K',
        cwd: '/workspace',
        hasLaunchConfig: true,
      },
      signal: 'v1 live',
    },
    writes,
    errors: [],
  };
}

function describeAdoptCommandPieceSchema() {
  async function defaultsToEveryAppWithoutMutationOrConfirmationOverrides() {
    const commandInput = AdoptCommandInputSchema({});
    expect(commandInput).toEqual({ all: false, dryRun: false, yes: false });
  }

  it(
    'defaults to every app without mutation or confirmation overrides',
    defaultsToEveryAppWithoutMutationOrConfirmationOverrides,
  );
}

describe('AdoptCommandInputSchema', describeAdoptCommandPieceSchema);

describe('selectAdoptApps', () => {
  const apps = [discoveredApp('alpha'), discoveredApp('beta')];

  it('returns every discovered app when no selector is supplied', async () => {
    const selectedApps = selectAdoptApps(apps, undefined);
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['alpha', 'beta']);
  });

  it('keeps the order requested by the comma-separated selector', async () => {
    const selectedApps = selectAdoptApps(apps, 'beta, alpha');
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['beta', 'alpha']);
  });

  async function failsWithTheDiscoveredHandlesWhenASelectorIsUnknown() {
    function callSelectAdoptApps() {
      return selectAdoptApps(apps, 'missing');
    }

    expect(callSelectAdoptApps).toThrow(/Discovered apps: alpha, beta/);
  }

  it(
    'fails with the discovered handles when a selector is unknown',
    failsWithTheDiscoveredHandlesWhenASelectorIsUnknown,
  );
});

function describeCountAdoptMutations() {
  function countsPieceWritesAndIgnoresDetectOnlyKeychainReports() {
    const mutationCount = countAdoptMutations([
      targetPlanWithWrites([
        {
          description: 'import iap',
          fidelity: 'importable',
          change: {
            home: 'launch.config',
            bundleId: 'com.acme.app',
            piece: {
              type: 'iap',
              iap: {
                productId: 'coins',
                referenceName: 'Coins',
                type: 'CONSUMABLE',
                localizations: [],
              },
            },
          },
        },
        {
          description: 'cert report',
          fidelity: 'detect',
          change: { home: 'keychain' },
        },
        {
          description: 'listing',
          fidelity: 'importable',
          change: {
            home: 'listing',
            bundleId: 'com.acme.app',
            configPath: '/workspace/launch.config.ts',
            appName: 'acme',
          },
        },
      ]),
    ]);

    expect(mutationCount).toBe(2);
  }

  it(
    'counts config writes and ignores detect-only keychain reports',
    countsPieceWritesAndIgnoresDetectOnlyKeychainReports,
  );
}

describe('countAdoptMutations', describeCountAdoptMutations);

function describeAdoptFidelityMarker() {
  function mapsEachFidelityTierToItsPlanMarker() {
    const fidelityMarker = adoptFidelityMarker('importable');
    expect(fidelityMarker).toBe('+');
    expect(adoptFidelityMarker('advisory')).toBe('~');
    expect(adoptFidelityMarker('detect')).toBe('-');
  }

  it('maps each fidelity tier to its plan marker', mapsEachFidelityTierToItsPlanMarker);
}

describe('adoptFidelityMarker', describeAdoptFidelityMarker);

function describeDetectSharedAppRoot() {
  const pathService = {
    relative(from: string, to: string): string {
      return to.slice(from.length + 1);
    },
    sep: '/',
  };

  function returnsTheUniqueMonorepoSegmentWhenEveryAppSharesOneRootFolder() {
    const sharedRoot = detectSharedAppRoot(
      [
        discoveredApp('alpha', '/workspace/apps/alpha'),
        discoveredApp('beta', '/workspace/apps/beta'),
      ],
      '/workspace',
      pathService,
    );

    expect(sharedRoot).toBe('./apps');
  }

  it(
    'returns the unique monorepo segment when every app shares one root folder',
    returnsTheUniqueMonorepoSegmentWhenEveryAppSharesOneRootFolder,
  );

  function returnsNullWhenAppsSpanMultipleRootFolders() {
    const sharedRoot = detectSharedAppRoot(
      [discoveredApp('alpha', '/workspace/apps/alpha'), discoveredApp('solo', '/workspace/solo')],
      '/workspace',
      pathService,
    );

    expect(sharedRoot).toBeNull();
  }

  it(
    'returns null when apps span multiple root folders',
    returnsNullWhenAppsSpanMultipleRootFolders,
  );
}

describe('detectSharedAppRoot', describeDetectSharedAppRoot);
