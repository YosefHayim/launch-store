import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AppAvailabilityResource } from '../types/appleCatalog.js';
import {
  type AscAvailabilityApi,
  parseAvailabilityConfig,
  reconcileAvailability,
} from './availability.js';
/** Records create/update calls so tests can assert which singleton path the reconciler selected. */
type Calls = {
  create: {
    availableInNewTerritories: boolean;
    territories: string[];
  }[];
  update: {
    availabilityId: string;
    territories: string[];
  }[];
};
/** A hand-rolled {@link AscAvailabilityApi} serving `current` and recording writes without a network. */
const makeApi = (
  current: AppAvailabilityResource | null,
  appId: string | null = 'app-1',
): {
  api: AscAvailabilityApi;
  calls: Calls;
} => {
  const calls: Calls = { create: [], update: [] };
  const api: AscAvailabilityApi = {
    getAppId: () => Effect.succeed(appId),
    getAppAvailability: () => Effect.succeed(current),
    createAppAvailability: (_appId, input) => {
      calls.create.push(input);
      return Effect.void;
    },
    updateAppAvailabilityTerritories: (availabilityId, territories) => {
      calls.update.push({ availabilityId, territories });
      return Effect.void;
    },
  };
  return { api, calls };
};
/** Execute the availability reconciler at the test boundary. */
const runReconcile = (
  api: AscAvailabilityApi,
  input: Parameters<typeof reconcileAvailability>[1],
) => Effect.runPromise(reconcileAvailability(api, input));
const availability = (partial: Partial<AppAvailabilityResource>): AppAvailabilityResource => {
  return { id: 'avail-1', availableInNewTerritories: false, availableTerritories: [], ...partial };
};
describe('parseAvailabilityConfig', () => {
  it('parses and uppercases territory codes, with the optional flag', () => {
    expect(
      parseAvailabilityConfig({ availableInNewTerritories: true, territories: ['usa', 'gbr'] }),
    ).toEqual({
      availableInNewTerritories: true,
      territories: ['USA', 'GBR'],
    });
  });
  it('accepts an empty territory list as the explicit remove-from-all-storefronts state', () => {
    expect(parseAvailabilityConfig({ territories: [] })).toEqual({ territories: [] });
  });
  it('rejects a non-object, a missing list, a non-string code, and a non-boolean flag', () => {
    expect(() => parseAvailabilityConfig('nope')).toThrow();
    expect(() => parseAvailabilityConfig({})).toThrow();
    expect(() => parseAvailabilityConfig({ territories: ['USA', ''] })).toThrow();
    expect(() =>
      parseAvailabilityConfig({ territories: ['USA'], availableInNewTerritories: 'yes' }),
    ).toThrow();
  });
});
describe('reconcileAvailability', () => {
  const config = { territories: ['USA', 'GBR', 'CAN'] };
  it('throws when the app has no App Store Connect record', async () => {
    const { api } = makeApi(null, null);
    await expect(
      runReconcile(api, { bundleId: 'com.acme.app', config, dryRun: true }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });
  it('sets the full territory list the first time (no current availability)', async () => {
    const { api, calls } = makeApi(null);
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(calls.create).toEqual([
      { availableInNewTerritories: false, territories: ['CAN', 'GBR', 'USA'] },
    ]);
    expect(calls.update).toHaveLength(0);
    expect(report.actions[0]?.status).toBe('applied');
    expect(report.actions[0]?.description).toContain('(first time)');
  });
  it('is a no-op when the territory set and flag already match', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'CAN', 'GBR'] }));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(report.actions).toHaveLength(0);
  });
  it('applies the desired list when territories are added or removed, flagging removals as destructive', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'FRA'] }));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(calls.update).toEqual([
      { availabilityId: 'avail-1', territories: ['CAN', 'GBR', 'USA'] },
    ]);
    expect(calls.create).toHaveLength(0);
    const action = report.actions[0];
    expect(action?.destructive).toBe(true); // FRA is removed
    expect(action?.description).toContain('+2 (CAN, GBR)');
    expect(action?.description).toContain('-1 (FRA)');
  });
  it('acts when only the auto-add-new-territories flag changes', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'GBR', 'CAN'] }));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { ...config, availableInNewTerritories: true },
      dryRun: false,
    });
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(report.actions[0]?.description).toContain(
      'auto-add new territories: on (manual App Store Connect change required)',
    );
    expect(report.actions[0]?.destructive).toBe(false);
    expect(report.actions[0]?.status).toBe('failed');
    expect(report.actions[0]?.error).toContain('exposes availableInNewTerritories only');
  });
  it('clears every territory through the existing singleton and marks the action destructive', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'GBR'] }));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { territories: [] },
      dryRun: false,
    });
    expect(calls.update).toEqual([{ availabilityId: 'avail-1', territories: [] }]);
    expect(report.actions[0]?.description).toContain('0 territories');
    expect(report.actions[0]?.description).toContain('-2 (GBR, USA)');
    expect(report.actions[0]?.destructive).toBe(true);
    expect(report.actions[0]?.status).toBe('applied');
  });
  it('describes removal from every storefront without writing during a dry run', async () => {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'GBR'] }));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { territories: [] },
      dryRun: true,
    });
    expect(calls.update).toHaveLength(0);
    expect(report.actions[0]).toMatchObject({ destructive: true, status: 'planned' });
    expect(report.actions[0]?.description).toContain('set store availability -> 0 territories');
    expect(report.actions[0]?.description).toContain('-2 (GBR, USA)');
  });
  it('updates territories but reports the create-only future-territory flag as unresolved', async () => {
    const { api, calls } = makeApi(
      availability({ availableTerritories: ['USA'], availableInNewTerritories: true }),
    );
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: { territories: ['GBR'], availableInNewTerritories: false },
      dryRun: false,
    });
    expect(calls.update).toEqual([{ availabilityId: 'avail-1', territories: ['GBR'] }]);
    expect(report.actions[0]?.status).toBe('failed');
    expect(report.actions[0]?.error).toMatch(/^Territories were updated, but /);
  });
  it('plans but performs nothing on a dry-run', async () => {
    const { api, calls } = makeApi(null);
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: true,
    });
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(report.actions[0]?.status).toBe('planned');
  });
  it('captures a failed set without throwing', async () => {
    const { api } = makeApi(null);
    api.createAppAvailability = () => Effect.fail(new Error('territory USA not eligible'));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });
    expect(report.actions[0]?.status).toBe('failed');
    expect(report.actions[0]?.error).toBe('territory USA not eligible');
  });
});
