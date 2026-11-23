import { runPlanner } from './planner-testkit.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { experimentsPlanner } from './experiments.ts';
import { makeAscApiFake } from '@/testkit/asc-api-fake-testkit.js';
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
  const launchExpPath = join(systemTemporaryDirectory, 'launch-exp-');
  const dir = mkdtempSync(launchExpPath);

  tmpDirs.push(dir);

  const path = join(dir, 'experiments.config.json');
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
    configFiles: { experiments: configPath },
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
const DECLARED = { experiments: [{ name: 'exp1', trafficProportion: 50 }] };
function describeExperimentsPlanner() {
  async function omitsItselfWhenNoExperimentsSidecarIsPresent() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(
      experimentsPlanner,
      makeCtx(ascApiFake, '/no/such/experiments.config.json'),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no experiments sidecar is present',
    omitsItselfWhenNoExperimentsSidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(experimentsPlanner, makeCtx(null, writeConfig(DECLARED)));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsAnAdditivePlanWhenTheExperimentDoesnTExistYet() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(experimentsPlanner, makeCtx(ascApiFake, writeConfig(DECLARED)));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('additive');

    function someA(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description.includes('experiment');
    }

    expect(plan.apps[0]?.actions.some(someA)).toBe(true);
  }

  it(
    "reports an additive plan when the experiment doesn't exist yet",
    reportsAnAdditivePlanWhenTheExperimentDoesnTExistYet,
  );

  async function rendersInSyncWhenTheLiveExperimentAlreadyMatches() {
    const api = makeAscApiFake({
      listVersionExperiments: vi
        .fn()
        .mockResolvedValue([{ id: 'ex1', name: 'exp1', state: 'DRAFT', trafficProportion: 50 }]),
    });
    const plan = await runPlanner(experimentsPlanner, makeCtx(api, writeConfig(DECLARED)));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when the live experiment already matches',
    rendersInSyncWhenTheLiveExperimentAlreadyMatches,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(experimentsPlanner, makeCtx(api, writeConfig(DECLARED)));

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
    await runPlanner(experimentsPlanner, makeCtx(api, writeConfig(DECLARED)));
    expect(api.createVersionExperiment).toHaveBeenCalledTimes(0);
    expect(api.createExperimentTreatment).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('experimentsPlanner', describeExperimentsPlanner);
