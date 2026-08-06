import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type {
  GameCenterAchievementCreate,
  GameCenterAchievementResource,
  GameCenterLeaderboardCreate,
  GameCenterLeaderboardResource,
} from '../types/appleCatalog.js';
import { summarize } from './reconcile.js';
import { type AscGameCenterApi, parseGameCenterConfig, reconcileGameCenter } from './gameCenter.js';
import type { GameCenterConfig } from '../types/storeSurface.js';
import { expectArrayElement, expectDefined } from '@testkit/assertions.testkit.js';

/** Records every write the reconciler makes, so a test can assert what was (and wasn't) sent. */
type RecordedWrites = {
  detailCreated: number;
  achievements: {
    detailId: string;
    achievement: GameCenterAchievementCreate;
  }[];
  achievementLocales: {
    versionId: string;
    locale: string;
    name: string;
    beforeEarnedDescription: string;
    afterEarnedDescription: string;
  }[];
  leaderboards: {
    detailId: string;
    leaderboard: GameCenterLeaderboardCreate;
  }[];
  leaderboardLocales: {
    versionId: string;
    locale: string;
    name: string;
  }[];
};

/** State the fake API serves on reads - what App Store Connect already has. */
type FakeGameCenterState = {
  appId: string | null;
  detailId: string | null;
  achievements: GameCenterAchievementResource[];
  leaderboards: GameCenterLeaderboardResource[];
  achievementVersionId: string | null;
  leaderboardVersionId: string | null;
  enableFailure: Error | null;
  achievementLocalizationFailure: Error | null;
};

/** A hand-rolled {@link AscGameCenterApi} - no network - returning fake state and recording writes. */
const makeGameCenterApi = (
  stateOverrides: Partial<FakeGameCenterState>,
): {
  api: AscGameCenterApi;
  writes: RecordedWrites;
} => {
  const fakeState: FakeGameCenterState = {
    appId: 'app-1',
    detailId: 'detail-1',
    achievements: [],
    leaderboards: [],
    achievementVersionId: 'av-1',
    leaderboardVersionId: 'lv-1',
    enableFailure: null,
    achievementLocalizationFailure: null,
    ...stateOverrides,
  };
  const writes: RecordedWrites = {
    detailCreated: 0,
    achievements: [],
    achievementLocales: [],
    leaderboards: [],
    leaderboardLocales: [],
  };
  const api: AscGameCenterApi = {
    getAppId: () => Effect.succeed(fakeState.appId),
    getGameCenterDetail: () => {
      if (fakeState.detailId === null) return Effect.succeed(null);
      return Effect.succeed({ id: fakeState.detailId });
    },
    createGameCenterDetail: () => {
      if (fakeState.enableFailure !== null) return Effect.fail(fakeState.enableFailure);
      writes.detailCreated++;
      return Effect.succeed({ id: 'detail-new' });
    },
    listGameCenterAchievements: () => Effect.succeed(fakeState.achievements),
    createGameCenterAchievement: (detailId, achievement) => {
      writes.achievements.push({ detailId, achievement });
      return Effect.succeed({ id: 'ach-new', versionId: fakeState.achievementVersionId });
    },
    createGameCenterAchievementLocalization: (versionId, localization) => {
      if (fakeState.achievementLocalizationFailure !== null) {
        return Effect.fail(fakeState.achievementLocalizationFailure);
      }
      writes.achievementLocales.push({
        versionId,
        locale: localization.locale,
        name: localization.name,
        beforeEarnedDescription: localization.beforeEarnedDescription,
        afterEarnedDescription: localization.afterEarnedDescription,
      });
      return Effect.void;
    },
    listGameCenterLeaderboards: () => Effect.succeed(fakeState.leaderboards),
    createGameCenterLeaderboard: (detailId, leaderboard) => {
      writes.leaderboards.push({ detailId, leaderboard });
      return Effect.succeed({ id: 'lb-new', versionId: fakeState.leaderboardVersionId });
    },
    createGameCenterLeaderboardLocalization: (versionId, localization) => {
      writes.leaderboardLocales.push({
        versionId,
        locale: localization.locale,
        name: localization.name,
      });
      return Effect.void;
    },
  };
  return { api, writes };
};

/** Execute the Game Center reconciler at the test boundary. */
const runReconcile = (
  api: AscGameCenterApi,
  reconcileInput: Parameters<typeof reconcileGameCenter>[1],
) => Effect.runPromise(reconcileGameCenter(api, reconcileInput));

const SAMPLE_CONFIG: GameCenterConfig = {
  achievements: [
    {
      vendorIdentifier: 'first_win',
      referenceName: 'First Win',
      points: 10,
      name: 'First Win',
      beforeEarnedDescription: 'Win a game',
      afterEarnedDescription: 'You won!',
    },
  ],
  leaderboards: [
    {
      vendorIdentifier: 'high_score',
      referenceName: 'High Score',
      defaultFormatter: 'INTEGER',
      submissionType: 'BEST_SCORE',
      scoreSortType: 'DESC',
      name: 'High Score',
    },
  ],
};

const decodeGameCenterConfig = (rawDocument: unknown) =>
  Effect.runSync(parseGameCenterConfig(rawDocument));

describe('parseGameCenterConfig', () => {
  it('parses achievements and leaderboards', () => {
    const gameCenterConfig = decodeGameCenterConfig(SAMPLE_CONFIG);
    const firstAchievement = expectArrayElement(
      expectDefined(gameCenterConfig.achievements, 'achievements'),
      0,
    );
    const firstLeaderboard = expectArrayElement(
      expectDefined(gameCenterConfig.leaderboards, 'leaderboards'),
      0,
    );
    expect(firstAchievement.vendorIdentifier).toBe('first_win');
    expect(firstLeaderboard.defaultFormatter).toBe('INTEGER');
  });

  it('rejects a non-object, an array, and a file declaring neither list', () => {
    expect(() => decodeGameCenterConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => decodeGameCenterConfig([])).toThrow(/must be a JSON object/);
    expect(() => decodeGameCenterConfig({})).toThrow(/at least one entry/);
    expect(() => decodeGameCenterConfig({ achievements: [], leaderboards: [] })).toThrow(
      /at least one entry/,
    );
  });

  it('rejects bad points and bad enum values', () => {
    expect(() =>
      decodeGameCenterConfig({
        achievements: [
          {
            ...expectArrayElement(expectDefined(SAMPLE_CONFIG.achievements, 'achievements'), 0),
            points: -1,
          },
        ],
      }),
    ).toThrow(/points must be a non-negative integer/);
    expect(() =>
      decodeGameCenterConfig({
        leaderboards: [
          {
            ...expectArrayElement(expectDefined(SAMPLE_CONFIG.leaderboards, 'leaderboards'), 0),
            defaultFormatter: 'BOGUS',
          },
        ],
      }),
    ).toThrow(/defaultFormatter/);
    expect(() =>
      decodeGameCenterConfig({
        leaderboards: [
          {
            ...expectArrayElement(expectDefined(SAMPLE_CONFIG.leaderboards, 'leaderboards'), 0),
            scoreSortType: 'SIDEWAYS',
          },
        ],
      }),
    ).toThrow(/scoreSortType/);
  });

  it('rejects an achievement missing required localization text', () => {
    const achievement = expectArrayElement(
      expectDefined(SAMPLE_CONFIG.achievements, 'achievements'),
      0,
    );
    const { afterEarnedDescription: _omit, ...partialAchievement } = achievement;
    expect(() => decodeGameCenterConfig({ achievements: [partialAchievement] })).toThrow(
      /afterEarnedDescription/,
    );
  });
});

describe('reconcileGameCenter', () => {
  it('throws when the app has no App Store Connect record', async () => {
    const { api } = makeGameCenterApi({ appId: null });
    await expect(
      runReconcile(api, { bundleId: 'com.acme.app', config: SAMPLE_CONFIG, dryRun: true }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });

  it('enables Game Center, then creates each achievement & leaderboard with its localization (apply)', async () => {
    const { api, writes } = makeGameCenterApi({ detailId: null });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: false,
    });
    expect(writes.detailCreated).toBe(1);
    expect(writes.achievements).toEqual([
      {
        detailId: 'detail-new',
        achievement: {
          referenceName: 'First Win',
          vendorIdentifier: 'first_win',
          points: 10,
          showBeforeEarned: false,
          repeatable: false,
        },
      },
    ]);
    expect(writes.achievementLocales).toEqual([
      {
        versionId: 'av-1',
        locale: 'en-US',
        name: 'First Win',
        beforeEarnedDescription: 'Win a game',
        afterEarnedDescription: 'You won!',
      },
    ]);
    expect(writes.leaderboards).toEqual([
      {
        detailId: 'detail-new',
        leaderboard: {
          referenceName: 'High Score',
          vendorIdentifier: 'high_score',
          defaultFormatter: 'INTEGER',
          submissionType: 'BEST_SCORE',
          scoreSortType: 'DESC',
        },
      },
    ]);
    expect(writes.leaderboardLocales).toEqual([
      { versionId: 'lv-1', locale: 'en-US', name: 'High Score' },
    ]);
    // enable + 2 creates + 2 localizations = 5 applied
    expect(summarize(report.actions)).toEqual({ applied: 5, failed: 0, skipped: 0 });
  });

  it("only creates items the detail doesn't already have (idempotent by vendorIdentifier)", async () => {
    const { api, writes } = makeGameCenterApi({
      achievements: [{ id: 'a1', vendorIdentifier: 'first_win' }],
      leaderboards: [],
    });
    await runReconcile(api, { bundleId: 'com.acme.app', config: SAMPLE_CONFIG, dryRun: false });
    expect(writes.achievements).toHaveLength(0);
    expect(writes.leaderboards).toEqual([
      {
        detailId: 'detail-1',
        leaderboard: {
          referenceName: 'High Score',
          vendorIdentifier: 'high_score',
          defaultFormatter: 'INTEGER',
          submissionType: 'BEST_SCORE',
          scoreSortType: 'DESC',
        },
      },
    ]);
  });

  it('plans but performs nothing on a dry-run when the detail already exists', async () => {
    const { api, writes } = makeGameCenterApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: true,
    });
    expect(writes.achievements).toHaveLength(0);
    expect(writes.leaderboards).toHaveLength(0);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    // 2 creates + 2 localizations planned (detail already exists, so no enable action)
    expect(report.actions).toHaveLength(4);
  });

  it('plans enable plus creates on a dry-run when Game Center is not yet enabled', async () => {
    const { api, writes } = makeGameCenterApi({ detailId: null });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: true,
    });
    expect(writes.detailCreated).toBe(0);
    expect(writes.achievements).toHaveLength(0);
    expect(report.actions.map((action) => action.description)).toEqual([
      'enable Game Center for the app',
      'create achievement first_win (10 pts)',
      'set achievement first_win localization (en-US)',
      'create leaderboard high_score (INTEGER)',
      'set leaderboard high_score localization (en-US)',
    ]);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
  });

  it('records the localization as skipped (not failed) when Apple returns no version id', async () => {
    const { api, writes } = makeGameCenterApi({ achievementVersionId: null });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: {
        achievements: expectDefined(SAMPLE_CONFIG.achievements, 'SAMPLE_CONFIG.achievements'),
      },
      dryRun: false,
    });
    expect(writes.achievements).toHaveLength(1);
    expect(writes.achievementLocales).toHaveLength(0);
    expect(summarize(report.actions)).toEqual({ applied: 1, failed: 0, skipped: 1 });
  });

  it("captures a failed create and skips that item's localization", async () => {
    const { api, writes } = makeGameCenterApi({});
    api.createGameCenterLeaderboard = () => Effect.fail(new Error('vendor id taken'));
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: false,
    });
    const summary = summarize(report.actions);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(writes.leaderboardLocales).toHaveLength(0);
    const failedAction = report.actions.find((action) => action.status === 'failed');
    expect(failedAction).toBeDefined();
    if (failedAction === undefined) return;
    expect(failedAction.error).toBe('vendor id taken');
  });

  it('skips achievements and leaderboards when enabling Game Center fails', async () => {
    const { api, writes } = makeGameCenterApi({
      detailId: null,
      enableFailure: new Error('enable denied'),
    });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: false,
    });
    expect(writes.detailCreated).toBe(0);
    expect(writes.achievements).toHaveLength(0);
    expect(writes.leaderboards).toHaveLength(0);
    expect(summarize(report.actions)).toEqual({ applied: 0, failed: 1, skipped: 1 });
    const failedEnable = report.actions.find((action) => action.status === 'failed');
    expect(failedEnable).toBeDefined();
    if (failedEnable === undefined) return;
    expect(failedEnable.error).toBe('enable denied');
  });

  it('honors declared locale and achievement flags on create', async () => {
    const { api, writes } = makeGameCenterApi({});
    await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: {
        achievements: [
          {
            vendorIdentifier: 'speed_run',
            referenceName: 'Speed Run',
            points: 25,
            showBeforeEarned: true,
            repeatable: true,
            name: 'Speed Run',
            beforeEarnedDescription: 'Finish under a minute',
            afterEarnedDescription: 'Lightning fast!',
            locale: 'ja',
          },
        ],
      },
      dryRun: false,
    });
    expect(writes.achievements).toEqual([
      {
        detailId: 'detail-1',
        achievement: {
          referenceName: 'Speed Run',
          vendorIdentifier: 'speed_run',
          points: 25,
          showBeforeEarned: true,
          repeatable: true,
        },
      },
    ]);
    expect(writes.achievementLocales).toEqual([
      {
        versionId: 'av-1',
        locale: 'ja',
        name: 'Speed Run',
        beforeEarnedDescription: 'Finish under a minute',
        afterEarnedDescription: 'Lightning fast!',
      },
    ]);
  });

  it('records a failed localization when Apple rejects the localization create', async () => {
    const { api, writes } = makeGameCenterApi({
      achievementLocalizationFailure: new Error('locale not allowed'),
    });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: {
        achievements: expectDefined(SAMPLE_CONFIG.achievements, 'SAMPLE_CONFIG.achievements'),
      },
      dryRun: false,
    });
    expect(writes.achievements).toHaveLength(1);
    expect(writes.achievementLocales).toHaveLength(0);
    expect(summarize(report.actions)).toEqual({ applied: 1, failed: 1, skipped: 0 });
    const failedLocalization = report.actions.find((action) => action.status === 'failed');
    expect(failedLocalization).toBeDefined();
    if (failedLocalization === undefined) return;
    expect(failedLocalization.error).toBe('locale not allowed');
  });
});
