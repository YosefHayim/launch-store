import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { availabilityPlanner } from './availability.js';
import { makeAscApiFake } from '../../../testkit/ascApiFake.testkit.js';
import type { AscSurfacesApi, PlanContext, AppDescriptor, LaunchConfig } from '../../types.js';

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
function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'launch-avail-'));
  tmpDirs.push(dir);
  const path = join(dir, 'availability.config.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
}

function makeCtx(api: AscSurfacesApi | null, configPath: string): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    configFiles: { availability: configPath },
  };
  return {
    config,
    apps: [ALPHA],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

describe('availabilityPlanner', () => {
  it('omits itself when no availability sidecar is present', async () => {
    const plan = await availabilityPlanner.plan(
      makeCtx(makeAscApiFake(), '/no/such/availability.config.json'),
    );
    expect(plan.state).toBe('omitted');
  });

  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await availabilityPlanner.plan(
      makeCtx(null, writeConfig({ territories: ['USA'] })),
    );
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });

  it('reports the territory change a fresh config would apply (two-way)', async () => {
    const plan = await availabilityPlanner.plan(
      makeCtx(makeAscApiFake(), writeConfig({ territories: ['USA'] })),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.direction).toBe('two-way');
    expect(plan.apps[0]?.actions.some((a) => a.description.includes('store availability'))).toBe(
      true,
    );
  });

  it('renders in sync when live availability already matches', async () => {
    const api = makeAscApiFake({
      getAppAvailability: vi.fn().mockResolvedValue({
        id: 'avail1',
        availableInNewTerritories: false,
        availableTerritories: ['USA'],
      }),
    });
    const plan = await availabilityPlanner.plan(
      makeCtx(api, writeConfig({ territories: ['USA'], availableInNewTerritories: false })),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await availabilityPlanner.plan(
      makeCtx(api, writeConfig({ territories: ['USA'] })),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });

  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await availabilityPlanner.plan(makeCtx(api, writeConfig({ territories: ['USA'] })));
    expect(api.setAppAvailability).toHaveBeenCalledTimes(0);
  });
});
