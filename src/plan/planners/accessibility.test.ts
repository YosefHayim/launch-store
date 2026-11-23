import { runPlanner } from './planner-testkit.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessibilityPlanner } from './accessibility.ts';
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
  const launchA11yPath = join(systemTemporaryDirectory, 'launch-a11y-');
  const dir = mkdtempSync(launchA11yPath);

  tmpDirs.push(dir);

  const path = join(dir, 'accessibility.config.json');
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
    configFiles: { accessibility: configPath },
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
const DECLARED = { declarations: [{ deviceFamily: 'IPHONE' }] };
const publishedIphone = {
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

function describeAccessibilityPlanner() {
  async function omitsItselfWhenNoAccessibilitySidecarIsPresent() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(
      accessibilityPlanner,
      makeCtx(ascApiFake, '/no/such/accessibility.config.json'),
    );

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no accessibility sidecar is present',
    omitsItselfWhenNoAccessibilitySidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(accessibilityPlanner, makeCtx(null, writeConfig(DECLARED)));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsAnAdditivePlanWhenADeclarationDoesnTExistYet() {
    const ascApiFake = makeAscApiFake();
    const plan = await runPlanner(accessibilityPlanner, makeCtx(ascApiFake, writeConfig(DECLARED)));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('additive');

    function isAccessibilityDeclaration(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('accessibility declaration');
    }

    expect(plan.apps[0]?.actions.some(isAccessibilityDeclaration)).toBe(true);
  }

  it(
    "reports an additive plan when a declaration doesn't exist yet",
    reportsAnAdditivePlanWhenADeclarationDoesnTExistYet,
  );

  async function rendersInSyncWhenTheLiveDeclarationAlreadyMatches() {
    const api = makeAscApiFake({
      listAccessibilityDeclarations: vi.fn().mockResolvedValue([publishedIphone]),
    });
    const plan = await runPlanner(accessibilityPlanner, makeCtx(api, writeConfig(DECLARED)));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'renders in sync when the live declaration already matches',
    rendersInSyncWhenTheLiveDeclarationAlreadyMatches,
  );

  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeAscApiFake({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(accessibilityPlanner, makeCtx(api, writeConfig(DECLARED)));

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
    await runPlanner(accessibilityPlanner, makeCtx(api, writeConfig(DECLARED)));
    expect(api.createAccessibilityDeclaration).toHaveBeenCalledTimes(0);
    expect(api.updateAccessibilityDeclaration).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('accessibilityPlanner', describeAccessibilityPlanner);
