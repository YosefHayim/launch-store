import { Effect } from 'effect';
import { runPlanner } from './planner.testkit.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { customPagesPlanner } from './customPages.js';
import { makeAscApiFake } from '@testkit/ascApiFake.testkit.js';
import type { AppDescriptor } from '@core/types/app.js';
import type { LaunchConfig } from '@core/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@core/types/plan.js';
const ALPHA: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
};
const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** Write a sidecar config to a fresh temp file and return its path. */
const writeConfig = (json: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'launch-pages-'));
  tmpDirs.push(dir);
  const path = join(dir, 'custom-pages.config.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
};
const makeCtx = (api: AscSurfacesApi | null, configPath: string): PlanContext => {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    configFiles: { customPages: configPath },
  };
  return {
    config,
    apps: [ALPHA],
    resolveAscApi: () => Effect.succeed(api),
    resolvePlayApi: () => Effect.succeed(null),
  };
};
const DECLARED = { pages: [{ name: 'page1' }] };
describe('customPagesPlanner', () => {
  it('omits itself when no custom-pages sidecar is present', async () => {
    const plan = await runPlanner(
      customPagesPlanner,
      makeCtx(makeAscApiFake(), '/no/such/custom-pages.config.json'),
    );
    expect(plan.state).toBe('omitted');
  });
  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await runPlanner(customPagesPlanner, makeCtx(null, writeConfig(DECLARED)));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });
  it('reports the page a fresh config would create (two-way)', async () => {
    const plan = await runPlanner(
      customPagesPlanner,
      makeCtx(makeAscApiFake(), writeConfig(DECLARED)),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.direction).toBe('two-way');
    expect(plan.apps[0]?.actions.some((a) => a.description.includes('custom product page'))).toBe(
      true,
    );
  });
  it('renders in sync when the live page already exists', async () => {
    const api = makeAscApiFake({
      listCustomProductPages: vi.fn().mockResolvedValue([{ id: 'pg1', name: 'page1' }]),
    });
    const plan = await runPlanner(customPagesPlanner, makeCtx(api, writeConfig(DECLARED)));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });
  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(customPagesPlanner, makeCtx(api, writeConfig(DECLARED)));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });
  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await runPlanner(customPagesPlanner, makeCtx(api, writeConfig(DECLARED)));
    expect(api.createCustomProductPage).toHaveBeenCalledTimes(0);
    expect(api.createCustomProductPageLocalization).toHaveBeenCalledTimes(0);
  });
});
