import { runPlanner } from './planner-testkit.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { availabilityPlanner } from './availability.ts';
import { makeAscApiFake } from '../../testkit/asc-api-fake-testkit.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AscSurfacesApi, PlanContext } from '../../types/plan.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

const alpha: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};
const tmpDirs: string[] = [];
function cleanup() {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

afterEach(cleanup);
/** Write a sidecar config to a fresh temp file and return its path. */
function writeConfig(json: unknown): string {
  const systemTemporaryDirectory = tmpdir();
  const launchAvailPath = join(systemTemporaryDirectory, 'launch-avail-');
  const dir = mkdtempSync(launchAvailPath);

  tmpDirs.push(dir);

  const path = join(dir, 'availability.config.json');
  const serialized = JSON.stringify(json);

  writeFileSync(path, serialized);

  return path;
}
function makeCtx(api: AscSurfacesApi | null, configPath: string): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
    configFiles: { availability: configPath },
  };

  return {
    config,
    apps: [alpha],
    resolveAscApi() {
      return Promise.resolve(api);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}
function describeAvailabilityPlanner() {
  async function omitsItselfWhenNoAvailabilitySidecarIsPresent() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(
      availabilityPlanner,
      makeCtx(ascApiFake, '/no/such/availability.config.json'),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no availability sidecar is present',
    omitsItselfWhenNoAvailabilitySidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(
      availabilityPlanner,
      makeCtx(null, writeConfig({ territories: ['USA'] })),
    );

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsTheTerritoryChangeAFreshPieceWouldApplyTwoWay() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(
      availabilityPlanner,
      makeCtx(ascApiFake, writeConfig({ territories: ['USA'] })),
    );

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('two-way');

    function someA(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description.includes('store availability');
    }

    expect(plan.apps[0]?.actions.some(someA)).toBe(true);
  }

  it(
    'reports the territory change a fresh config would apply (two-way)',
    reportsTheTerritoryChangeAFreshPieceWouldApplyTwoWay,
  );

  async function rendersInSyncWhenLiveAvailabilityAlreadyMatches() {
    const api = makeAscApiFake({
      getAppAvailability: vi.fn().mockResolvedValue({
        id: 'avail1',
        availableInNewTerritories: false,
        availableTerritories: ['USA'],
      }),
    });
    const plan = await runPlanner(
      availabilityPlanner,
      makeCtx(api, writeConfig({ territories: ['USA'], availableInNewTerritories: false })),
    );

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when live availability already matches',
    rendersInSyncWhenLiveAvailabilityAlreadyMatches,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(
      availabilityPlanner,
      makeCtx(api, writeConfig({ territories: ['USA'] })),
    );

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  }

  it(
    'captures a missing app record as a per-app error, not a thrown plan',
    capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan,
  );

  async function isStrictlyReadOnlyNeverInvokesAWriteEndpoint() {
    const api = makeAscApiFake();
    await runPlanner(availabilityPlanner, makeCtx(api, writeConfig({ territories: ['USA'] })));
    expect(api.createAppAvailability).toHaveBeenCalledTimes(0);
    expect(api.updateAppAvailabilityTerritories).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('availabilityPlanner', describeAvailabilityPlanner);
