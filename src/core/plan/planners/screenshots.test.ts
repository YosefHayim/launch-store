import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screenshotsPlanner } from "./screenshots.js";
import { makeAscApiFake } from "./ascApiFake.testkit.js";
import type { AscSurfacesApi, PlanContext } from "../types.js";
import type { AppDescriptor, LaunchConfig } from "../../types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Make a fresh app dir, optionally seeding one en-US 6.7" iPhone screenshot, and return its descriptor. */
function makeApp(withScreenshot: boolean): AppDescriptor {
  const dir = mkdtempSync(join(tmpdir(), "launch-shots-"));
  tmpDirs.push(dir);
  if (withScreenshot) {
    const shotDir = join(dir, "screenshots", "en-US", "APP_IPHONE_67");
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(join(shotDir, "home.png"), "not-a-real-image-but-enough-to-hash");
  }
  return { name: "alpha", dir, configPath: join(dir, "app.json"), bundleId: "com.acme.alpha" };
}

function makeCtx(api: AscSurfacesApi | null, app: AppDescriptor): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: "local",
    storage: "local",
    buildEngine: "fastlane",
    submit: "app-store-connect",
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
    listVersionLocalizations: vi.fn().mockResolvedValue([{ id: "loc1", locale: "en-US" }]),
    ...overrides,
  });
}

describe("screenshotsPlanner", () => {
  it("omits itself when no in-scope app has on-disk assets", async () => {
    const plan = await screenshotsPlanner.plan(makeCtx(apiWithLocale(), makeApp(false)));
    expect(plan.state).toBe("omitted");
  });

  it("skips with a creds hint when no Apple account is active", async () => {
    const plan = await screenshotsPlanner.plan(makeCtx(null, makeApp(true)));
    expect(plan.state).toBe("skipped");
    if (plan.state !== "skipped") return;
    expect(plan.hint).toMatch(/creds/);
  });

  it("reports an additive plan to upload a local screenshot Apple doesn't have", async () => {
    const plan = await screenshotsPlanner.plan(makeCtx(apiWithLocale(), makeApp(true)));
    expect(plan.state).toBe("planned");
    if (plan.state !== "planned" || plan.scope !== "app") return;
    expect(plan.direction).toBe("additive");
    expect(
      plan.apps[0]?.actions.some(
        (a) => a.description.includes("upload screenshot") && a.description.includes("[en-US]"),
      ),
    ).toBe(true);
  });

  it("is strictly read-only: never invokes an upload endpoint", async () => {
    const api = apiWithLocale();
    await screenshotsPlanner.plan(makeCtx(api, makeApp(true)));
    expect(api.createScreenshotSet).toHaveBeenCalledTimes(0);
    expect(api.uploadScreenshot).toHaveBeenCalledTimes(0);
    expect(api.uploadPreview).toHaveBeenCalledTimes(0);
  });
});
