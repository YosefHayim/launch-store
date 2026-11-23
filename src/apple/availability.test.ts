import { describe, expect, it } from 'vitest';
import type { AppAvailabilityResource } from '../types/apple-catalog.ts';
import {
  type AscAvailabilityApi,
  parseAvailabilityConfig,
  reconcileAvailability,
} from './availability.ts';

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
function makeApi(
  current: AppAvailabilityResource | null,
  appId: string | null = 'app-1',
): {
  api: AscAvailabilityApi;
  calls: Calls;
} {
  const calls: Calls = { create: [], update: [] };
  const api: AscAvailabilityApi = {
    getAppId() {
      return Promise.resolve(appId);
    },
    getAppAvailability() {
      return Promise.resolve(current);
    },
    createAppAvailability(_appId, input) {
      calls.create.push(input);
      return Promise.resolve();
    },
    updateAppAvailabilityTerritories(availabilityId, territories) {
      calls.update.push({ availabilityId, territories });
      return Promise.resolve();
    },
  };

  return { api, calls };
}

/** Execute the availability reconciler at the test boundary. */
function runReconcile(api: AscAvailabilityApi, input: Parameters<typeof reconcileAvailability>[1]) {
  return reconcileAvailability(api, input);
}

function availability(partial: Partial<AppAvailabilityResource>): AppAvailabilityResource {
  return { id: 'avail-1', availableInNewTerritories: false, availableTerritories: [], ...partial };
}

function describeParseAvailabilityPiece() {
  function parsesAndUppercasesTerritoryCodesWithTheOptionalFlag() {
    const parseAvailability = parseAvailabilityConfig({
      availableInNewTerritories: true,
      territories: ['usa', 'gbr'],
    });

    expect(parseAvailability).toEqual({
      availableInNewTerritories: true,
      territories: ['USA', 'GBR'],
    });
  }

  it(
    'parses and uppercases territory codes, with the optional flag',
    parsesAndUppercasesTerritoryCodesWithTheOptionalFlag,
  );

  function acceptsAnEmptyTerritoryListAsTheExplicitRemoveFromAllStorefrontsPiece() {
    const parseAvailability = parseAvailabilityConfig({ territories: [] });
    expect(parseAvailability).toEqual({ territories: [] });
  }

  it(
    'accepts an empty territory list as the explicit remove-from-all-storefronts state',
    acceptsAnEmptyTerritoryListAsTheExplicitRemoveFromAllStorefrontsPiece,
  );

  function rejectsANonObjectAMissingListANonStringCodeAndANonBooleanFlag() {
    function callParseAvailabilityPiece() {
      return parseAvailabilityConfig('nope');
    }

    expect(callParseAvailabilityPiece).toThrow();

    function callParseAvailabilityPiece2() {
      return parseAvailabilityConfig({});
    }

    expect(callParseAvailabilityPiece2).toThrow();

    function callParseAvailabilityPiece3() {
      return parseAvailabilityConfig({ territories: ['USA', ''] });
    }

    expect(callParseAvailabilityPiece3).toThrow();

    function callParseAvailabilityPiece4() {
      return parseAvailabilityConfig({ territories: ['USA'], availableInNewTerritories: 'yes' });
    }

    expect(callParseAvailabilityPiece4).toThrow();
  }

  it(
    'rejects a non-object, a missing list, a non-string code, and a non-boolean flag',
    rejectsANonObjectAMissingListANonStringCodeAndANonBooleanFlag,
  );
}

describe('parseAvailabilityConfig', describeParseAvailabilityPiece);

function describeReconcileAvailability() {
  const config = { territories: ['USA', 'GBR', 'CAN'] };

  async function throwsWhenTheAppHasNoAppStoreConnectPiece() {
    const { api } = makeApi(null, null);
    const reconcile = runReconcile(api, { bundleId: 'com.acme.app', config, dryRun: true });
    await expect(reconcile).rejects.toThrow(/No App Store Connect app record/);
  }

  it(
    'throws when the app has no App Store Connect record',
    throwsWhenTheAppHasNoAppStoreConnectPiece,
  );

  async function setsTheFullTerritoryListTheFirstTimeNoCurrentAvailability() {
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
  }

  it(
    'sets the full territory list the first time (no current availability)',
    setsTheFullTerritoryListTheFirstTimeNoCurrentAvailability,
  );

  async function isANoOpWhenTheTerritorySetAndFlagAlreadyPiece() {
    const { api, calls } = makeApi(availability({ availableTerritories: ['USA', 'CAN', 'GBR'] }));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });

    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(report.actions).toHaveLength(0);
  }

  it(
    'is a no-op when the territory set and flag already match',
    isANoOpWhenTheTerritorySetAndFlagAlreadyPiece,
  );

  async function appliesTheDesiredListWhenTerritoriesAreAddedOrRemovedFlaggingRemovalsAsDestructive() {
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
  }

  it(
    'applies the desired list when territories are added or removed, flagging removals as destructive',
    appliesTheDesiredListWhenTerritoriesAreAddedOrRemovedFlaggingRemovalsAsDestructive,
  );

  async function actsWhenOnlyTheAutoAddNewTerritoriesFlagChanges() {
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
  }

  it(
    'acts when only the auto-add-new-territories flag changes',
    actsWhenOnlyTheAutoAddNewTerritoriesFlagChanges,
  );

  async function clearsEveryTerritoryThroughTheExistingSingletonAndMarksTheActionDestructive() {
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
  }

  it(
    'clears every territory through the existing singleton and marks the action destructive',
    clearsEveryTerritoryThroughTheExistingSingletonAndMarksTheActionDestructive,
  );

  async function describesRemovalFromEveryStorefrontWithoutWritingDuringADryRun() {
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
  }

  it(
    'describes removal from every storefront without writing during a dry run',
    describesRemovalFromEveryStorefrontWithoutWritingDuringADryRun,
  );

  async function updatesTerritoriesButReportsTheCreateOnlyFutureTerritoryFlagAsUnresolved() {
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
  }

  it(
    'updates territories but reports the create-only future-territory flag as unresolved',
    updatesTerritoriesButReportsTheCreateOnlyFutureTerritoryFlagAsUnresolved,
  );

  async function plansButPerformsNothingOnADryRun() {
    const { api, calls } = makeApi(null);
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: true,
    });

    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(report.actions[0]?.status).toBe('planned');
  }

  it('plans but performs nothing on a dry-run', plansButPerformsNothingOnADryRun);

  async function capturesAFailedSetWithoutThrowing() {
    const { api } = makeApi(null);

    function runPiece() {
      return Promise.reject(new Error('territory USA not eligible'));
    }

    api.createAppAvailability = runPiece;

    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config,
      dryRun: false,
    });

    expect(report.actions[0]?.status).toBe('failed');
    expect(report.actions[0]?.error).toBe('territory USA not eligible');
  }

  it('captures a failed set without throwing', capturesAFailedSetWithoutThrowing);
}

describe('reconcileAvailability', describeReconcileAvailability);
