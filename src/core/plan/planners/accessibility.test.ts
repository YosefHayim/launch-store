import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessibilityPlanner } from './accessibility.js';
import { makeAscApiFake } from '../../../testkit/ascApiFake.testkit.js';
import type { AscSurfacesApi, PlanContext } from '../types.js';
import type { AppDescriptor, LaunchConfig } from '../../types.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'launch-a11y-'));
  tmpDirs.push(dir);
  const path = join(dir, 'accessibility.config.json');
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
    configFiles: { accessibility: configPath },
  };
  return {
    config,
    apps: [ALPHA],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

const DECLARED = { declarations: [{ deviceFamily: 'IPHONE' }] };

const PUBLISHED_IPHONE = {
  id: 'decl1',
  deviceFamily: 'IPHONE',
  state: 'PUBLISHED',
  support: {
    supportsAudioDescriptions: false,
    supportsCaptions: false,
    supportsDarkInterface: false,
    supportsDifferentiateWithoutColorAlone: false,
    supportsLargerText: false,
    supportsReducedMotion: false,
    supportsSufficientContrast: false,
    supportsVoiceControl: false,
    supportsVoiceover: false,
  },
};

describe('accessibilityPlanner', () => {
  it('omits itself when no accessibility sidecar is present', async () => {
    const plan = await accessibilityPlanner.plan(
      makeCtx(makeAscApiFake(), '/no/such/accessibility.config.json'),
    );
    expect(plan.state).toBe('omitted');
  });

  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await accessibilityPlanner.plan(makeCtx(null, writeConfig(DECLARED)));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });

  it("reports an additive plan when a declaration doesn't exist yet", async () => {
    const plan = await accessibilityPlanner.plan(makeCtx(makeAscApiFake(), writeConfig(DECLARED)));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.direction).toBe('additive');
    expect(
      plan.apps[0]?.actions.some((a) => a.description.includes('accessibility declaration')),
    ).toBe(true);
  });

  it('renders in sync when the live declaration already matches', async () => {
    const api = makeAscApiFake({
      listAccessibilityDeclarations: vi.fn().mockResolvedValue([PUBLISHED_IPHONE]),
    });
    const plan = await accessibilityPlanner.plan(makeCtx(api, writeConfig(DECLARED)));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await accessibilityPlanner.plan(makeCtx(api, writeConfig(DECLARED)));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
  });

  it('is strictly read-only: never invokes a write endpoint', async () => {
    const api = makeAscApiFake();
    await accessibilityPlanner.plan(makeCtx(api, writeConfig(DECLARED)));
    expect(api.createAccessibilityDeclaration).toHaveBeenCalledTimes(0);
    expect(api.updateAccessibilityDeclaration).toHaveBeenCalledTimes(0);
  });
});
