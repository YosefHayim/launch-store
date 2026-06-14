import { describe, expect, it } from "vitest";
import type {
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
} from "../apple/ascClient.js";
import { type AscAppClipsApi, parseAppClipsConfig, reconcileAppClips, summarizeAppClips } from "./appClips.js";
import type { AppClipsConfig } from "./types.js";

/** Records every write the reconciler makes, so a test can assert what was (and wasn't) sent. */
interface Calls {
  createdExperiences: { appClipId: string; versionId: string; action?: string }[];
  updatedActions: { experienceId: string; action: string }[];
  createdLocalizations: { experienceId: string; locale: string; subtitle: string }[];
  updatedLocalizations: { localizationId: string; subtitle: string }[];
}

/** State the fake API serves on reads — what App Store Connect already has. */
interface State {
  appId: string | null;
  editableVersionId: string | null;
  clips: AppClipResource[];
  experiences: Record<string, AppClipDefaultExperienceResource[]>;
  localizations: Record<string, AppClipLocalizationResource[]>;
}

/** A hand-rolled {@link AscAppClipsApi} — no network — returning `state` and recording writes in `calls`. */
function makeApi(state: Partial<State>): { api: AscAppClipsApi; calls: Calls } {
  const full: State = {
    appId: "app-1",
    editableVersionId: "ver-1",
    clips: [],
    experiences: {},
    localizations: {},
    ...state,
  };
  const calls: Calls = {
    createdExperiences: [],
    updatedActions: [],
    createdLocalizations: [],
    updatedLocalizations: [],
  };
  let nextId = 0;
  const api: AscAppClipsApi = {
    getAppId: () => Promise.resolve(full.appId),
    findEditableAppStoreVersion: () => Promise.resolve(full.editableVersionId ? { id: full.editableVersionId } : null),
    listAppClips: () => Promise.resolve(full.clips),
    listAppClipDefaultExperiences: (appClipId) => Promise.resolve(full.experiences[appClipId] ?? []),
    createAppClipDefaultExperience: (appClipId, versionId, action) => {
      calls.createdExperiences.push({ appClipId, versionId, ...(action ? { action } : {}) });
      return Promise.resolve({ id: `exp-new-${++nextId}` });
    },
    updateAppClipDefaultExperienceAction: (experienceId, action) => {
      calls.updatedActions.push({ experienceId, action });
      return Promise.resolve();
    },
    listAppClipDefaultExperienceLocalizations: (experienceId) =>
      Promise.resolve(full.localizations[experienceId] ?? []),
    createAppClipDefaultExperienceLocalization: (experienceId, locale, subtitle) => {
      calls.createdLocalizations.push({ experienceId, locale, subtitle });
      return Promise.resolve();
    },
    updateAppClipDefaultExperienceLocalization: (localizationId, subtitle) => {
      calls.updatedLocalizations.push({ localizationId, subtitle });
      return Promise.resolve();
    },
  };
  return { api, calls };
}

const ONE_CLIP: AppClipsConfig = {
  clips: { "com.acme.app.Clip": { action: "OPEN", localizations: { "en-US": { subtitle: "Order now" } } } },
};

describe("parseAppClipsConfig", () => {
  it("parses a clip with an action and localizations", () => {
    const config = parseAppClipsConfig(ONE_CLIP);
    expect(config.clips["com.acme.app.Clip"]).toEqual({
      action: "OPEN",
      localizations: { "en-US": { subtitle: "Order now" } },
    });
  });

  it("rejects a non-object document, an array, and an empty clips map", () => {
    expect(() => parseAppClipsConfig("nope")).toThrow(/must be a JSON object/);
    expect(() => parseAppClipsConfig([])).toThrow(/must be a JSON object/);
    expect(() => parseAppClipsConfig({})).toThrow(/at least one App Clip/);
    expect(() => parseAppClipsConfig({ clips: {} })).toThrow(/at least one App Clip/);
    expect(() => parseAppClipsConfig({ clips: [] })).toThrow(/at least one App Clip/);
  });

  it("rejects an invalid action and a non-string subtitle", () => {
    expect(() => parseAppClipsConfig({ clips: { c: { action: "TAP" } } })).toThrow(/OPEN \/ VIEW \/ PLAY/);
    expect(() => parseAppClipsConfig({ clips: { c: { localizations: { "en-US": { subtitle: 1 } } } } })).toThrow(
      /subtitle must be a string/,
    );
  });

  it("rejects a clip that declares neither an action nor localizations", () => {
    expect(() => parseAppClipsConfig({ clips: { c: {} } })).toThrow(/declares nothing/);
  });
});

describe("reconcileAppClips", () => {
  const clip: AppClipResource = { id: "clip-1", bundleId: "com.acme.app.Clip" };

  it("throws when the app has no App Store Connect record", async () => {
    const { api } = makeApi({ appId: null });
    await expect(reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: true })).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it("skips every clip when there's no editable App Store version", async () => {
    const { api, calls } = makeApi({ editableVersionId: null, clips: [clip] });
    const report = await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: false });
    expect(report.actions).toEqual([
      {
        description: "App Clips: no editable App Store version (create/select a version first)",
        destructive: false,
        status: "skipped",
      },
    ]);
    expect(calls.createdExperiences).toHaveLength(0);
  });

  it("skips a declared clip whose build hasn't produced a clip record", async () => {
    const { api } = makeApi({ clips: [] });
    const report = await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: false });
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]?.status).toBe("skipped");
    expect(report.actions[0]?.description).toMatch(/upload a build with this App Clip target first/);
  });

  it("creates the default experience and its subtitle when none exists (apply)", async () => {
    const { api, calls } = makeApi({ clips: [clip] });
    const report = await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: false });

    expect(calls.createdExperiences).toEqual([{ appClipId: "clip-1", versionId: "ver-1", action: "OPEN" }]);
    expect(calls.createdLocalizations).toEqual([{ experienceId: "exp-new-1", locale: "en-US", subtitle: "Order now" }]);
    expect(summarizeAppClips(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  });

  it("plans (but does not perform) creates on a dry-run, including the subtitle of a not-yet-created experience", async () => {
    const { api, calls } = makeApi({ clips: [clip] });
    const report = await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: true });

    expect(calls.createdExperiences).toHaveLength(0);
    expect(calls.createdLocalizations).toHaveLength(0);
    expect(report.actions.map((action) => action.status)).toEqual(["planned", "planned"]);
    expect(report.actions[1]?.description).toBe("set com.acme.app.Clip card subtitle (en-US)");
  });

  it("updates only the action and the changed subtitle, leaving in-sync fields untouched", async () => {
    const { api, calls } = makeApi({
      clips: [clip],
      experiences: { "clip-1": [{ id: "exp-1", action: "VIEW", versionId: "ver-1" }] },
      localizations: { "exp-1": [{ id: "loc-1", locale: "en-US", subtitle: "Old copy" }] },
    });
    const report = await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: false });

    expect(calls.updatedActions).toEqual([{ experienceId: "exp-1", action: "OPEN" }]);
    expect(calls.updatedLocalizations).toEqual([{ localizationId: "loc-1", subtitle: "Order now" }]);
    expect(calls.createdExperiences).toHaveLength(0);
    expect(summarizeAppClips(report.actions)).toEqual({ applied: 2, failed: 0, skipped: 0 });
  });

  it("makes no changes when the experience and subtitle already match", async () => {
    const { api, calls } = makeApi({
      clips: [clip],
      experiences: { "clip-1": [{ id: "exp-1", action: "OPEN", versionId: "ver-1" }] },
      localizations: { "exp-1": [{ id: "loc-1", locale: "en-US", subtitle: "Order now" }] },
    });
    const report = await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: false });

    expect(report.actions).toHaveLength(0);
    expect(calls.updatedActions).toHaveLength(0);
    expect(calls.updatedLocalizations).toHaveLength(0);
  });

  it("ignores an experience tied to a different (non-editable) version", async () => {
    const { api, calls } = makeApi({
      clips: [clip],
      experiences: { "clip-1": [{ id: "exp-old", action: "OPEN", versionId: "ver-released" }] },
    });
    await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: false });
    // The editable-version experience doesn't exist yet → a fresh one is created, not the released one reused.
    expect(calls.createdExperiences).toEqual([{ appClipId: "clip-1", versionId: "ver-1", action: "OPEN" }]);
  });

  it("captures a failed experience create and skips that clip's subtitles", async () => {
    const { api, calls } = makeApi({ clips: [clip] });
    api.createAppClipDefaultExperience = () => Promise.reject(new Error("boom"));
    const report = await reconcileAppClips(api, { bundleId: "com.acme.app", config: ONE_CLIP, dryRun: false });

    const summary = summarizeAppClips(report.actions);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(calls.createdLocalizations).toHaveLength(0);
    expect(report.actions.find((action) => action.status === "failed")?.error).toBe("boom");
  });
});
