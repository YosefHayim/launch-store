import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AppDescriptor } from '../types/app.js';
import type { PlannedWrite } from '../types/adopt.js';
import {
  adoptFidelityMarker,
  AdoptCommandInputSchema,
  countAdoptMutations,
  detectSharedAppRoot,
  selectAdoptApps,
} from './command.js';
import type { TargetPlan } from './orchestrator.js';

const discoveredApp = (appName: string, dir = `/workspace/${appName}`): AppDescriptor => ({
  name: appName,
  dir,
  configPath: `${dir}/app.json`,
});

const targetPlanWithWrites = (writes: readonly PlannedWrite[]): TargetPlan => ({
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
});

describe('AdoptCommandInputSchema', () => {
  it('defaults to every app without mutation or confirmation overrides', async () => {
    const commandInput = await Effect.runPromise(Schema.decodeUnknown(AdoptCommandInputSchema)({}));
    expect(commandInput).toEqual({ all: false, dryRun: false, yes: false });
  });
});

describe('selectAdoptApps', () => {
  const apps = [discoveredApp('alpha'), discoveredApp('beta')];

  it('returns every discovered app when no selector is supplied', async () => {
    const selectedApps = await Effect.runPromise(selectAdoptApps(apps, undefined));
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['alpha', 'beta']);
  });

  it('keeps the order requested by the comma-separated selector', async () => {
    const selectedApps = await Effect.runPromise(selectAdoptApps(apps, 'beta, alpha'));
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['beta', 'alpha']);
  });

  it('fails with the discovered handles when a selector is unknown', async () => {
    await expect(Effect.runPromise(selectAdoptApps(apps, 'missing'))).rejects.toThrow(
      /Discovered apps: alpha, beta/,
    );
  });
});

describe('countAdoptMutations', () => {
  it('counts config writes and ignores detect-only keychain reports', () => {
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
            home: 'store.config',
            bundleId: 'com.acme.app',
            configPath: '/workspace/store.config.json',
            appName: 'acme',
          },
        },
      ]),
    ]);
    expect(mutationCount).toBe(2);
  });
});

describe('adoptFidelityMarker', () => {
  it('maps each fidelity tier to its plan marker', () => {
    expect(adoptFidelityMarker('importable')).toBe('+');
    expect(adoptFidelityMarker('advisory')).toBe('~');
    expect(adoptFidelityMarker('detect')).toBe('-');
  });
});

describe('detectSharedAppRoot', () => {
  const pathService = {
    relative: (from: string, to: string): string => to.slice(from.length + 1),
    sep: '/',
  };

  it('returns the unique monorepo segment when every app shares one root folder', () => {
    const sharedRoot = detectSharedAppRoot(
      [
        discoveredApp('alpha', '/workspace/apps/alpha'),
        discoveredApp('beta', '/workspace/apps/beta'),
      ],
      '/workspace',
      pathService,
    );
    expect(sharedRoot).toBe('./apps');
  });

  it('returns null when apps span multiple root folders', () => {
    const sharedRoot = detectSharedAppRoot(
      [discoveredApp('alpha', '/workspace/apps/alpha'), discoveredApp('solo', '/workspace/solo')],
      '/workspace',
      pathService,
    );
    expect(sharedRoot).toBeNull();
  });
});
