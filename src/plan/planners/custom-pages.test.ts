import { runPlanner } from './planner-testkit.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { customPagesPlanner } from './custom-pages.ts';
import { makeAscApiFake } from '@/testkit/app-store-connect-api-fake-testkit.js';
import type { AppDescriptor } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@/types/plan.js';
import type { ActionStatus } from '@/types/reconcile.js';

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
  const launchPagesPath = join(systemTemporaryDirectory, 'launch-pages-');
  const dir = mkdtempSync(launchPagesPath);

  tmpDirs.push(dir);

  const path = join(dir, 'custom-pages.config.json');
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
    configFiles: { customPages: configPath },
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
const DECLARED = { pages: [{ name: 'page1' }] };

function describeCustomPagesPlanner() {
  async function omitsItselfWhenNoCustomPagesSidecarIsPresent() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(
      customPagesPlanner,
      makeCtx(ascApiFake, '/no/such/custom-pages.config.json'),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no custom-pages sidecar is present',
    omitsItselfWhenNoCustomPagesSidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(customPagesPlanner, makeCtx(null, writeConfig(DECLARED)));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsThePageAFreshPieceWouldCreateTwoWay() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(customPagesPlanner, makeCtx(ascApiFake, writeConfig(DECLARED)));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('two-way');

    function isCustomProductPage(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('custom product page');
    }

    expect(plan.apps[0]?.actions.some(isCustomProductPage)).toBe(true);
  }

  it(
    'reports the page a fresh config would create (two-way)',
    reportsThePageAFreshPieceWouldCreateTwoWay,
  );

  async function rendersInSyncWhenTheLivePageAlreadyExists() {
    const api = makeAscApiFake({
      listCustomProductPages: vi.fn().mockResolvedValue([{ id: 'pg1', name: 'page1' }]),
    });
    const plan = await runPlanner(customPagesPlanner, makeCtx(api, writeConfig(DECLARED)));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when the live page already exists',
    rendersInSyncWhenTheLivePageAlreadyExists,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(customPagesPlanner, makeCtx(api, writeConfig(DECLARED)));

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
    await runPlanner(customPagesPlanner, makeCtx(api, writeConfig(DECLARED)));
    expect(api.createCustomProductPage).toHaveBeenCalledTimes(0);
    expect(api.createCustomProductPageLocalization).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('customPagesPlanner', describeCustomPagesPlanner);
