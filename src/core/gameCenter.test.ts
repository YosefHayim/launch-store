import { describe, expect, it } from "vitest";
import type { GameCenterAchievementResource, GameCenterLeaderboardResource } from "../apple/ascClient.js";
import { summarize } from "./asc/storeSync.js";
import { type AscGameCenterApi, parseGameCenterConfig, reconcileGameCenter } from "./gameCenter.js";
import type { GameCenterConfig } from "./types.js";

/** Records every write the reconciler makes, so a test can assert what was (and wasn't) sent. */
interface Calls {
  detailCreated: number;
  achievements: { detailId: string; vendorIdentifier: string }[];
  achievementLocales: { versionId: string; locale: string; name: string }[];
  leaderboards: { detailId: string; vendorIdentifier: string }[];
  leaderboardLocales: { versionId: string; locale: string; name: string }[];
}

/** State the fake API serves on reads — what App Store Connect already has. */
interface State {
  appId: string | null;
  detailId: string | null;
  achievements: GameCenterAchievementResource[];
  leaderboards: GameCenterLeaderboardResource[];
  achievementVersionId: string | null;
  leaderboardVersionId: string | null;
}

/** A hand-rolled {@link AscGameCenterApi} — no network — returning `state` and recording writes in `calls`. */
function makeApi(state: Partial<State>): { api: AscGameCenterApi; calls: Calls } {
  const full: State = {
    appId: "app-1",
    detailId: "detail-1",
    achievements: [],
    leaderboards: [],
    achievementVersionId: "av-1",
    leaderboardVersionId: "lv-1",
    ...state,
  };
  const calls: Calls = {
    detailCreated: 0,
    achievements: [],
    achievementLocales: [],
    leaderboards: [],
    leaderboardLocales: [],
  };
  const api: AscGameCenterApi = {
    getAppId: () => Promise.resolve(full.appId),
    getGameCenterDetail: () => Promise.resolve(full.detailId ? { id: full.detailId } : null),
    createGameCenterDetail: () => {
      calls.detailCreated++;
      return Promise.resolve({ id: "detail-new" });
    },
    listGameCenterAchievements: () => Promise.resolve(full.achievements),
    createGameCenterAchievement: (detailId, attrs) => {
      calls.achievements.push({ detailId, vendorIdentifier: attrs.vendorIdentifier });
      return Promise.resolve({ id: "ach-new", versionId: full.achievementVersionId });
    },
    createGameCenterAchievementLocalization: (versionId, fields) => {
      calls.achievementLocales.push({ versionId, locale: fields.locale, name: fields.name });
      return Promise.resolve();
    },
    listGameCenterLeaderboards: () => Promise.resolve(full.leaderboards),
    createGameCenterLeaderboard: (detailId, attrs) => {
      calls.leaderboards.push({ detailId, vendorIdentifier: attrs.vendorIdentifier });
      return Promise.resolve({ id: "lb-new", versionId: full.leaderboardVersionId });
    },
    createGameCenterLeaderboardLocalization: (versionId, fields) => {
      calls.leaderboardLocales.push({ versionId, locale: fields.locale, name: fields.name });
      return Promise.resolve();
    },
  };
  return { api, calls };
}

const CONFIG: GameCenterConfig = {
  achievements: [
    {
      vendorIdentifier: "first_win",
      referenceName: "First Win",
      points: 10,
      name: "First Win",
      beforeEarnedDescription: "Win a game",
      afterEarnedDescription: "You won!",
    },
  ],
  leaderboards: [
    {
      vendorIdentifier: "high_score",
      referenceName: "High Score",
      defaultFormatter: "INTEGER",
      submissionType: "BEST_SCORE",
      scoreSortType: "DESC",
      name: "High Score",
    },
  ],
};

describe("parseGameCenterConfig", () => {
  it("parses achievements and leaderboards, defaulting optional flags", () => {
    const config = parseGameCenterConfig(CONFIG);
    expect(config.achievements?.[0]?.vendorIdentifier).toBe("first_win");
    expect(config.leaderboards?.[0]?.defaultFormatter).toBe("INTEGER");
  });

  it("rejects a non-object, an array, and a file declaring neither list", () => {
    expect(() => parseGameCenterConfig("nope")).toThrow(/must be a JSON object/);
    expect(() => parseGameCenterConfig([])).toThrow(/must be a JSON object/);
    expect(() => parseGameCenterConfig({})).toThrow(/at least one entry/);
    expect(() => parseGameCenterConfig({ achievements: [], leaderboards: [] })).toThrow(/at least one entry/);
  });

  it("rejects bad points and bad enum values", () => {
    expect(() => parseGameCenterConfig({ achievements: [{ ...CONFIG.achievements![0], points: -1 }] })).toThrow(
      /points must be a non-negative integer/,
    );
    expect(() =>
      parseGameCenterConfig({ leaderboards: [{ ...CONFIG.leaderboards![0], defaultFormatter: "BOGUS" }] }),
    ).toThrow(/defaultFormatter must be one of/);
    expect(() =>
      parseGameCenterConfig({ leaderboards: [{ ...CONFIG.leaderboards![0], scoreSortType: "SIDEWAYS" }] }),
    ).toThrow(/scoreSortType must be ASC or DESC/);
  });

  it("rejects an achievement missing required localization text", () => {
    const { afterEarnedDescription: _omit, ...partial } = CONFIG.achievements![0]!;
    expect(() => parseGameCenterConfig({ achievements: [partial] })).toThrow(
      /afterEarnedDescription must be a non-empty/,
    );
  });
});

describe("reconcileGameCenter", () => {
  it("throws when the app has no App Store Connect record", async () => {
    const { api } = makeApi({ appId: null });
    await expect(reconcileGameCenter(api, { bundleId: "com.acme.app", config: CONFIG, dryRun: true })).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it("enables Game Center, then creates each achievement & leaderboard with its localization (apply)", async () => {
    const { api, calls } = makeApi({ detailId: null });
    const report = await reconcileGameCenter(api, { bundleId: "com.acme.app", config: CONFIG, dryRun: false });

    expect(calls.detailCreated).toBe(1);
    expect(calls.achievements).toEqual([{ detailId: "detail-new", vendorIdentifier: "first_win" }]);
    expect(calls.achievementLocales).toEqual([{ versionId: "av-1", locale: "en-US", name: "First Win" }]);
    expect(calls.leaderboards).toEqual([{ detailId: "detail-new", vendorIdentifier: "high_score" }]);
    expect(calls.leaderboardLocales).toEqual([{ versionId: "lv-1", locale: "en-US", name: "High Score" }]);
    // enable + 2 creates + 2 localizations = 5 applied
    expect(summarize(report.actions)).toEqual({ applied: 5, failed: 0, skipped: 0 });
  });

  it("only creates items the detail doesn't already have (idempotent by vendorIdentifier)", async () => {
    const { api, calls } = makeApi({
      achievements: [{ id: "a1", vendorIdentifier: "first_win" }],
      leaderboards: [],
    });
    await reconcileGameCenter(api, { bundleId: "com.acme.app", config: CONFIG, dryRun: false });
    expect(calls.achievements).toHaveLength(0); // already present
    expect(calls.leaderboards).toEqual([{ detailId: "detail-1", vendorIdentifier: "high_score" }]);
  });

  it("plans but performs nothing on a dry-run", async () => {
    const { api, calls } = makeApi({});
    const report = await reconcileGameCenter(api, { bundleId: "com.acme.app", config: CONFIG, dryRun: true });
    expect(calls.achievements).toHaveLength(0);
    expect(calls.leaderboards).toHaveLength(0);
    expect(report.actions.every((action) => action.status === "planned")).toBe(true);
    // 2 creates + 2 localizations planned (detail already exists, so no enable action)
    expect(report.actions).toHaveLength(4);
  });

  it("records the localization as skipped (not failed) when Apple returns no version id", async () => {
    const { api, calls } = makeApi({ achievementVersionId: null });
    const report = await reconcileGameCenter(api, {
      bundleId: "com.acme.app",
      config: { achievements: CONFIG.achievements ?? [] },
      dryRun: false,
    });
    expect(calls.achievements).toHaveLength(1); // the achievement is still created
    expect(calls.achievementLocales).toHaveLength(0); // but no localization attempt
    const summary = summarize(report.actions);
    expect(summary).toEqual({ applied: 1, failed: 0, skipped: 1 });
  });

  it("captures a failed create and skips that item's localization", async () => {
    const { api, calls } = makeApi({});
    api.createGameCenterLeaderboard = () => Promise.reject(new Error("vendor id taken"));
    const report = await reconcileGameCenter(api, { bundleId: "com.acme.app", config: CONFIG, dryRun: false });

    const summary = summarize(report.actions);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1); // the leaderboard's localization
    expect(calls.leaderboardLocales).toHaveLength(0);
    expect(report.actions.find((action) => action.status === "failed")?.error).toBe("vendor id taken");
  });
});
