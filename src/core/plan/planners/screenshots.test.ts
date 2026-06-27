import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenshotsPlanner } from './screenshots.js';
import { makeAscApiFake } from './ascApiFake.testkit.js';
import type { AscSurfacesApi, PlanContext } from '../types.js';
import type { AppDescriptor, LaunchConfig } from '../../types.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Make a fresh app dir, optionally seeding one en-US 6.7" iPhone screenshot, and return its descriptor. */
function makeApp(withScreenshot: boolean): AppDescriptor {
  const dir = mkdtempSync(join(tmpdir(), 'launch-shots-'));
  tmpDirs.push(dir);
  if (withScreenshot) {
    const shotDir = join(dir, 'screenshots', 'en-US', 'APP_IPHONE_67');
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(join(shotDir, 'home.png'), 'not-a-real-image-but-enough-to-hash');
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
  const dir = mkdtempSync(join(tmpdir(), 'launch-shots-'));
  tmpDirs.push(dir);
  const shotDir = join(dir, 'screenshots', 'en-US', 'APP_IPHONE_67');
  mkdirSync(shotDir, { recursive: true });
  writeFileSync(join(shotDir, 'home.png'), pngBytes(width, height));
  return { name: 'alpha', dir, configPath: join(dir, 'app.json'), bundleId: 'com.acme.alpha' };
}

function makeCtx(api: AscSurfacesApi | null, app: AppDescriptor): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  return {
    config,
    apps: [app],
    resolveAscApi: () => Promise.resolve(api),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

/** A fake whose editable version carries an en-US localization, so a local screenshot plans an upload. */
function apiWithLocale(overrides: Partial<AscSurfacesApi> = {}): AscSurfacesApi {
  return makeAscApiFake({
    listVersionLocalizations: vi.fn().mockResolvedValue([{ id: 'loc1', locale: 'en-US' }]),
    ...overrides,
  });
}

describe('screenshotsPlanner', () => {
  it('omits itself when no in-scope app has on-disk assets', async () => {
    const plan = await screenshotsPlanner.plan(makeCtx(apiWithLocale(), makeApp(false)));
    expect(plan.state).toBe('omitted');
  });

  it('skips with a creds hint when no Apple account is active', async () => {
    const plan = await screenshotsPlanner.plan(makeCtx(null, makeApp(true)));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.hint).toMatch(/creds/);
  });

  it("reports an additive plan to upload a local screenshot Apple doesn't have", async () => {
    const plan = await screenshotsPlanner.plan(makeCtx(apiWithLocale(), makeApp(true)));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.direction).toBe('additive');
    expect(
      plan.apps[0]?.actions.some(
        (a) => a.description.includes('upload screenshot') && a.description.includes('[en-US]'),
      ),
    ).toBe(true);
  });

  it('is strictly read-only: never invokes an upload endpoint', async () => {
    const api = apiWithLocale();
    await screenshotsPlanner.plan(makeCtx(api, makeApp(true)));
    expect(api.createScreenshotSet).toHaveBeenCalledTimes(0);
    expect(api.uploadScreenshot).toHaveBeenCalledTimes(0);
    expect(api.uploadPreview).toHaveBeenCalledTimes(0);
  });

  it('flags an off-spec screenshot whose pixels fall outside its display type', async () => {
    const plan = await screenshotsPlanner.plan(
      makeCtx(apiWithLocale(), makeAppWithShot(1080, 1920)),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    const advisory = plan.apps[0]?.actions.find((a) =>
      a.description.includes('off-spec screenshot'),
    );
    expect(advisory).toBeDefined();
    expect(advisory?.status).toBe('skipped');
    expect(advisory?.description).toContain('[en-US/APP_IPHONE_67]');
  });

  it('does not flag an in-spec screenshot, nor an unmeasurable (non-image) one', async () => {
    const inSpec = await screenshotsPlanner.plan(
      makeCtx(apiWithLocale(), makeAppWithShot(1290, 2796)),
    );
    const unmeasurable = await screenshotsPlanner.plan(makeCtx(apiWithLocale(), makeApp(true)));
    for (const plan of [inSpec, unmeasurable]) {
      if (plan.state !== 'planned' || plan.scope !== 'app')
        throw new Error('expected an app-scoped plan');
      expect(plan.apps[0]?.actions.some((a) => a.description.includes('off-spec screenshot'))).toBe(
        false,
      );
    }
  });
});
