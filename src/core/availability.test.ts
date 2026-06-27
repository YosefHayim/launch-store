import { describe, expect, it } from 'vitest';
import type { AppAvailabilityResource } from '../apple/ascClient.js';
import {
  type AscAvailabilityApi,
  parseAvailabilityConfig,
  reconcileAvailability,
} from './availability.js';

/** Records the set call the reconciler makes, so a test can assert exactly what was sent. */
interface Calls {
  set: { availableInNewTerritories: boolean; territories: string[] }[];
}

/** A hand-rolled {@link AscAvailabilityApi} — no network — serving `current` and recording the set call. */
function makeApi(
  current: AppAvailabilityResource | null,
  appId: string | null = 'app-1',
): { api: AscAvailabilityApi; calls: Calls } {
  const calls: Calls = { set: [] };
  const api: AscAvailabilityApi = {
    getAppId: () => Promise.resolve(appId),
    getAppAvailability: () => Promise.resolve(current),
    setAppAvailability: (_appId, input) => {
      calls.set.push(input);
      return Promise.resolve();
    },
  };
  return { api, calls };
}

function availability(partial: Partial<AppAvailabilityResource>): AppAvailabilityResource {
  return { id: 'avail-1', availableInNewTerritories: false, availableTerritories: [], ...partial };
}

describe('parseAvailabilityConfig', () => {
  it('parses and uppercases territory codes, with the optional flag', () => {
    expect(
      parseAvailabilityConfig({ availableInNewTerritories: true, territories: ['usa', 'gbr'] }),
    ).toEqual({
      availableInNewTerritories: true,
      territories: ['USA', 'GBR'],
    });
  });

  it('rejects a non-object, a missing/empty list, a non-string code, and a non-boolean flag', () => {
    expect(() => parseAvailabilityConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => parseAvailabilityConfig({})).toThrow(/"territories" must be an array/);
    expect(() => parseAvailabilityConfig({ territories: [] })).toThrow(/at least one territory/);
    expect(() => parseAvailabilityConfig({ territories: ['USA', ''] })).toThrow(
      /territories\[1\] must be a non-empty/,
    );
    expect(() =>
      parseAvailabilityConfig({ territories: ['USA'], availableInNewTerritories: 'yes' }),
    ).toThrow(/"availableInNewTerritories" must be a boolean/);
  });
});

describe('reconcileAvailability', () => {
  const config = { territories: ['USA', 'GBR', 'CAN'] };

  it('throws when the app has no App Store Connect record', async () => {
    const { api } = makeApi(null, null);
    await expect(
      reconcileAvailability(api, { bundleId: 'com.acme.app', config, dryRun: true }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });

  it('sets the full territory list the first time (no current availability)', async () => {
    const { api, calls } = makeApi(null);
    const report = await reconcileAvailability(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(calls.set).toEqual([
      { availableInNewTerritories: false, territories: ['CAN', 'GBR', 'USA'] },
    ]);
    expect(report.actions[0]?.status).toBe('applied');
    expect(report.actions[0]?.description).toContain('(first time)');
  });

  it('is a no-op when the territory set and flag already match', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'CAN', 'GBR'] }));
    const report = await reconcileAvailability(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(calls.set).toHaveLength(0);
    expect(report.actions).toHaveLength(0);
  });

  it('applies the desired list when territories are added or removed, flagging removals as destructive', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'FRA'] }));
    const report = await reconcileAvailability(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(calls.set).toEqual([
      { availableInNewTerritories: false, territories: ['CAN', 'GBR', 'USA'] },
    ]);
    const action = report.actions[0];
    expect(action?.destructive).toBe(true); // FRA is removed
    expect(action?.description).toContain('+2 (CAN, GBR)');
    expect(action?.description).toContain('−1 (FRA)');
  });

  it('acts when only the auto-add-new-territories flag changes', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'GBR', 'CAN'] }));
    const report = await reconcileAvailability(api, {
      bundleId: 'com.acme.app',
      config: { ...config, availableInNewTerritories: true },
      dryRun: false,
    });
    expect(calls.set).toEqual([
      { availableInNewTerritories: true, territories: ['CAN', 'GBR', 'USA'] },
    ]);
    expect(report.actions[0]?.description).toContain('auto-add new territories: on');
    expect(report.actions[0]?.destructive).toBe(false);
  });

  it('plans but performs nothing on a dry-run', async () => {
    const { api, calls } = makeApi(null);
    const report = await reconcileAvailability(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: true,
    });
    expect(calls.set).toHaveLength(0);
    expect(report.actions[0]?.status).toBe('planned');
  });

  it('captures a failed set without throwing', async () => {
    const { api } = makeApi(null);
    api.setAppAvailability = () => Promise.reject(new Error('territory USA not eligible'));
    const report = await reconcileAvailability(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(report.actions[0]?.status).toBe('failed');
    expect(report.actions[0]?.error).toBe('territory USA not eligible');
  });
});
