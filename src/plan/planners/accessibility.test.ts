import { runPlanner } from './planner-testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { accessibilityPlanner } from './accessibility.ts';
import { makeAscApiFake } from '@/testkit/app-store-connect-api-fake-testkit.js';
import type { AccessibilityConfig } from '@/apple/store/accessibility.js';
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

function contextFor(api: AscSurfacesApi | null, launchFile: LaunchConfig): PlanContext {
  return {
    config: launchFile,
    apps: [alpha],
    resolveAscApi() {
      return Promise.resolve(api);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}

function makeCtx(
  api: AscSurfacesApi | null,
  accessibilitySection: AccessibilityConfig | null,
): PlanContext {
  const fallbackLaunch: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  const isOmitted = accessibilitySection == null;

  if (isOmitted) {
    return contextFor(api, fallbackLaunch);
  }

  const declaredLaunch: LaunchConfig = {
    ...fallbackLaunch,
    accessibility: { 'com.acme.alpha': accessibilitySection },
  };

  return contextFor(api, declaredLaunch);
}

const DECLARED: AccessibilityConfig = { declarations: [{ deviceFamily: 'IPHONE' }] };
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
    const plan = await runPlanner(accessibilityPlanner, makeCtx(ascApiFake, null));

    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no accessibility sidecar is present',
    omitsItselfWhenNoAccessibilitySidecarIsPresent,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(accessibilityPlanner, makeCtx(null, DECLARED));

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
    const plan = await runPlanner(accessibilityPlanner, makeCtx(ascApiFake, DECLARED));

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
    const plan = await runPlanner(accessibilityPlanner, makeCtx(api, DECLARED));

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
    const plan = await runPlanner(accessibilityPlanner, makeCtx(api, DECLARED));

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
    await runPlanner(accessibilityPlanner, makeCtx(api, DECLARED));
    expect(api.createAccessibilityDeclaration).toHaveBeenCalledTimes(0);
    expect(api.updateAccessibilityDeclaration).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a write endpoint',
    isStrictlyReadOnlyNeverInvokesAWriteEndpoint,
  );
}

describe('accessibilityPlanner', describeAccessibilityPlanner);
