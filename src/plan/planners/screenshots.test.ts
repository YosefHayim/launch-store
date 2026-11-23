import { runPlanner } from './planner-testkit.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenshotsPlanner } from './screenshots.ts';
import { makeAscApiFake } from '@/testkit/asc-api-fake-testkit.js';
import type { AppDescriptor } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AscSurfacesApi, PlanContext } from '@/types/plan.js';
import type { ActionStatus } from '@/types/reconcile.js';

const tmpDirs: string[] = [];

function cleanup() {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

afterEach(cleanup);

/** Make a fresh app dir, optionally seeding one en-US 6.7" iPhone screenshot, and return its descriptor. */
function makeApp(withScreenshot: boolean): AppDescriptor {
  const systemTemporaryDirectory = tmpdir();
  const launchShotsPath = join(systemTemporaryDirectory, 'launch-shots-');
  const dir = mkdtempSync(launchShotsPath);

  tmpDirs.push(dir);

  if (withScreenshot) {
    const shotDir = join(dir, 'screenshots', 'en-US', 'APP_IPHONE_67');
    mkdirSync(shotDir, { recursive: true });
    const homePath = join(shotDir, 'home.png');
    writeFileSync(homePath, 'not-a-real-image-but-enough-to-hash');
  }

  return { name: 'alpha', dir, configPath: join(dir, 'app.json'), bundleId: 'com.acme.alpha' };
}

/** Encode a minimal valid PNG (8-byte signature + IHDR) carrying the given pixel size. */
function pngBytes(width: number, height: number): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(16);

  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);

  return Buffer.concat([head, ihdr]);
}

/** Make an app dir seeding one en-US 6.7" iPhone screenshot of the given real pixel size. */
function makeAppWithShot(width: number, height: number): AppDescriptor {
  const systemTemporaryDirectory = tmpdir();
  const launchShotsPath = join(systemTemporaryDirectory, 'launch-shots-');
  const dir = mkdtempSync(launchShotsPath);

  tmpDirs.push(dir);

  const shotDir = join(dir, 'screenshots', 'en-US', 'APP_IPHONE_67');

  mkdirSync(shotDir, { recursive: true });

  const homePath = join(shotDir, 'home.png');

  writeFileSync(homePath, pngBytes(width, height));

  return { name: 'alpha', dir, configPath: join(dir, 'app.json'), bundleId: 'com.acme.alpha' };
}

function makeCtx(api: AscSurfacesApi | null, app: AppDescriptor): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  return {
    config,
    apps: [app],
    resolveAscApi() {
      return Promise.resolve(api);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}

/** A fake whose editable version carries an en-US localization, so a local screenshot plans an upload. */
function apiWithLocale(overrides: Partial<AscSurfacesApi> = {}): AscSurfacesApi {
  return makeAscApiFake({
    listVersionLocalizations: vi.fn().mockResolvedValue([{ id: 'loc1', locale: 'en-US' }]),
    ...overrides,
  });
}

function describeScreenshotsPlanner() {
  async function omitsItselfWhenNoInScopeAppHasOnDiskAssets() {
    const plan = await runPlanner(screenshotsPlanner, makeCtx(apiWithLocale(), makeApp(false)));
    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no in-scope app has on-disk assets',
    omitsItselfWhenNoInScopeAppHasOnDiskAssets,
  );

  async function skipsWithACredsHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(screenshotsPlanner, makeCtx(null, makeApp(true)));

    expect(plan.state).toBe('skipped');

    if (plan.state != 'skipped') return;

    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with a creds hint when no Apple account is active',
    skipsWithACredsHintWhenNoAppleAccountIsActive,
  );

  async function reportsAnAdditivePlanToUploadALocalScreenshotAppleDoesnTHave() {
    const plan = await runPlanner(screenshotsPlanner, makeCtx(apiWithLocale(), makeApp(true)));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    expect(plan.direction).toBe('additive');

    function isEnglishScreenshotUpload(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      const isScreenshotUpload = plannedAction.description.includes('upload screenshot');
      const isNotAScreenshotUpload = isScreenshotUpload == false;

      if (isNotAScreenshotUpload) return false;

      return plannedAction.description.includes('[en-US]');
    }

    expect(plan.apps[0]?.actions.some(isEnglishScreenshotUpload)).toBe(true);
  }

  it(
    "reports an additive plan to upload a local screenshot Apple doesn't have",
    reportsAnAdditivePlanToUploadALocalScreenshotAppleDoesnTHave,
  );

  async function isStrictlyReadOnlyNeverInvokesAnUploadEndpoint() {
    const api = apiWithLocale();

    await runPlanner(screenshotsPlanner, makeCtx(api, makeApp(true)));
    expect(api.createScreenshotSet).toHaveBeenCalledTimes(0);
    expect(api.uploadScreenshot).toHaveBeenCalledTimes(0);
    expect(api.uploadPreview).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes an upload endpoint',
    isStrictlyReadOnlyNeverInvokesAnUploadEndpoint,
  );

  async function flagsAnOffSpecScreenshotWhosePixelsFallOutsideItsDisplayType() {
    const appWithShot = makeAppWithShot(1080, 1920);
    const plan = await runPlanner(screenshotsPlanner, makeCtx(apiWithLocale(), appWithShot));

    expect(plan.state).toBe('planned');

    if (plan.state != 'planned') return;

    if (plan.scope != 'app') return;

    function isOffSpecScreenshot(plannedAction: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return plannedAction.description.includes('off-spec screenshot');
    }

    const advisory = plan.apps[0]?.actions.find(isOffSpecScreenshot);

    expect(advisory).toBeDefined();
    expect(advisory?.status).toBe('skipped');
    expect(advisory?.description).toContain('[en-US/APP_IPHONE_67]');
  }

  it(
    'flags an off-spec screenshot whose pixels fall outside its display type',
    flagsAnOffSpecScreenshotWhosePixelsFallOutsideItsDisplayType,
  );

  async function doesNotFlagAnInSpecScreenshotNorAnUnmeasurableNonImageOne() {
    const appWithShot = makeAppWithShot(1290, 2796);
    const inSpec = await runPlanner(screenshotsPlanner, makeCtx(apiWithLocale(), appWithShot));
    const unmeasurable = await runPlanner(
      screenshotsPlanner,
      makeCtx(apiWithLocale(), makeApp(true)),
    );

    for (const plan of [inSpec, unmeasurable]) {
      if (plan.state != 'planned') throw new Error('expected an app-scoped plan');

      if (plan.scope != 'app') throw new Error('expected an app-scoped plan');

      function isOffSpecScreenshot(plannedAction: {
        readonly description: string;
        readonly destructive: boolean;
        status: ActionStatus;
        error?: string;
      }) {
        return plannedAction.description.includes('off-spec screenshot');
      }

      expect(plan.apps[0]?.actions.some(isOffSpecScreenshot)).toBe(false);
    }
  }

  it(
    'does not flag an in-spec screenshot, nor an unmeasurable (non-image) one',
    doesNotFlagAnInSpecScreenshotNorAnUnmeasurableNonImageOne,
  );
}

describe('screenshotsPlanner', describeScreenshotsPlanner);
