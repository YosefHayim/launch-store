import { describe, expect, it } from 'vitest';
import type {
  GameCenterAchievementCreate,
  GameCenterAchievementResource,
  GameCenterLeaderboardCreate,
  GameCenterLeaderboardResource,
} from '../../types/apple-catalog.ts';
import { summarize } from '../shared/reconcile.ts';
import {
  type AscGameCenterApi,
  parseGameCenterConfig,
  reconcileGameCenter,
} from './game-center.ts';
import type { GameCenterConfig } from '../../types/store-surface.ts';
import { expectArrayElement, expectDefined } from '../../testkit/assertions-testkit.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

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
function makeGameCenterApi(stateOverrides: Partial<FakeGameCenterState>): {
  api: AscGameCenterApi;
  writes: RecordedWrites;
} {
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
    getAppId() {
      return Promise.resolve(fakeState.appId);
    },
    getGameCenterDetail() {
      if (fakeState.detailId == null) return Promise.resolve(null);

      return Promise.resolve({ id: fakeState.detailId });
    },
    createGameCenterDetail() {
      if (fakeState.enableFailure != null) return Promise.reject(fakeState.enableFailure);

      writes.detailCreated++;
      return Promise.resolve({ id: 'detail-new' });
    },
    listGameCenterAchievements() {
      return Promise.resolve(fakeState.achievements);
    },
    createGameCenterAchievement(detailId, achievement) {
      writes.achievements.push({ detailId, achievement });
      return Promise.resolve({ id: 'ach-new', versionId: fakeState.achievementVersionId });
    },
    createGameCenterAchievementLocalization(versionId, localization) {
      if (fakeState.achievementLocalizationFailure != null) {
        return Promise.reject(fakeState.achievementLocalizationFailure);
      }

      writes.achievementLocales.push({
        versionId,
        locale: localization.locale,
        name: localization.name,
        beforeEarnedDescription: localization.beforeEarnedDescription,
        afterEarnedDescription: localization.afterEarnedDescription,
      });

      return Promise.resolve();
    },
    listGameCenterLeaderboards() {
      return Promise.resolve(fakeState.leaderboards);
    },
    createGameCenterLeaderboard(detailId, leaderboard) {
      writes.leaderboards.push({ detailId, leaderboard });
      return Promise.resolve({ id: 'lb-new', versionId: fakeState.leaderboardVersionId });
    },
    createGameCenterLeaderboardLocalization(versionId, localization) {
      writes.leaderboardLocales.push({
        versionId,
        locale: localization.locale,
        name: localization.name,
      });

      return Promise.resolve();
    },
  };

  return { api, writes };
}

/** Execute the Game Center reconciler at the test boundary. */
function runReconcile(
  api: AscGameCenterApi,
  reconcileInput: Parameters<typeof reconcileGameCenter>[1],
) {
  return reconcileGameCenter(api, reconcileInput);
}

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

function decodeGameCenterConfig(rawDocument: unknown) {
  return parseGameCenterConfig(rawDocument);
}
function describeParseGameCenterPiece() {
  function parsesAchievementsAndLeaderboards() {
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
  }

  it('parses achievements and leaderboards', parsesAchievementsAndLeaderboards);

  function rejectsANonObjectAnArrayAndAFileDeclaringNeitherList() {
    function callDecodeGameCenterPiece() {
      return decodeGameCenterConfig('nope');
    }

    expect(callDecodeGameCenterPiece).toThrow(/must be a JSON object/);

    function callDecodeGameCenterPiece2() {
      return decodeGameCenterConfig([]);
    }

    expect(callDecodeGameCenterPiece2).toThrow(/must be a JSON object/);

    function callDecodeGameCenterPiece3() {
      return decodeGameCenterConfig({});
    }

    expect(callDecodeGameCenterPiece3).toThrow(/at least one entry/);

    function callDecodeGameCenterPiece4() {
      return decodeGameCenterConfig({ achievements: [], leaderboards: [] });
    }

    expect(callDecodeGameCenterPiece4).toThrow(/at least one entry/);
  }

  it(
    'rejects a non-object, an array, and a file declaring neither list',
    rejectsANonObjectAnArrayAndAFileDeclaringNeitherList,
  );

  function rejectsBadPointsAndBadEnumValues() {
    function expectCall() {
      const arrayElement = expectArrayElement(
        expectDefined(SAMPLE_CONFIG.achievements, 'achievements'),
        0,
      );

      return decodeGameCenterConfig({
        achievements: [
          {
            ...arrayElement,
            points: -1,
          },
        ],
      });
    }

    expect(expectCall).toThrow(/points must be a non-negative integer/);

    function expectCall2() {
      const arrayElement = expectArrayElement(
        expectDefined(SAMPLE_CONFIG.leaderboards, 'leaderboards'),
        0,
      );

      return decodeGameCenterConfig({
        leaderboards: [
          {
            ...arrayElement,
            defaultFormatter: 'BOGUS',
          },
        ],
      });
    }

    expect(expectCall2).toThrow(/defaultFormatter/);

    function expectCall3() {
      const arrayElement = expectArrayElement(
        expectDefined(SAMPLE_CONFIG.leaderboards, 'leaderboards'),
        0,
      );

      return decodeGameCenterConfig({
        leaderboards: [
          {
            ...arrayElement,
            scoreSortType: 'SIDEWAYS',
          },
        ],
      });
    }

    expect(expectCall3).toThrow(/scoreSortType/);
  }

  it('rejects bad points and bad enum values', rejectsBadPointsAndBadEnumValues);

  function rejectsAnAchievementMissingRequiredLocalizationPiece() {
    const achievement = expectArrayElement(
      expectDefined(SAMPLE_CONFIG.achievements, 'achievements'),
      0,
    );
    const { afterEarnedDescription: _omit, ...partialAchievement } = achievement;

    function callDecodeGameCenterPiece5() {
      return decodeGameCenterConfig({ achievements: [partialAchievement] });
    }

    expect(callDecodeGameCenterPiece5).toThrow(/afterEarnedDescription/);
  }

  it(
    'rejects an achievement missing required localization text',
    rejectsAnAchievementMissingRequiredLocalizationPiece,
  );
}

describe('parseGameCenterConfig', describeParseGameCenterPiece);
function describeReconcileGameCenter() {
  async function throwsWhenTheAppHasNoAppStoreConnectPiece() {
    const { api } = makeGameCenterApi({ appId: null });
    const reconcile = runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: true,
    });

    await expect(reconcile).rejects.toThrow(/No App Store Connect app record/);
  }

  it(
    'throws when the app has no App Store Connect record',
    throwsWhenTheAppHasNoAppStoreConnectPiece,
  );

  async function enablesGameCenterThenCreatesEachAchievementLeaderboardWithItsLocalizationApply() {
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
  }

  it(
    'enables Game Center, then creates each achievement & leaderboard with its localization (apply)',
    enablesGameCenterThenCreatesEachAchievementLeaderboardWithItsLocalizationApply,
  );

  async function onlyCreatesPieceTheDetailDoesnTAlreadyHaveIdempotentByVendorIdentifier() {
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
  }

  it(
    "only creates items the detail doesn't already have (idempotent by vendorIdentifier)",
    onlyCreatesPieceTheDetailDoesnTAlreadyHaveIdempotentByVendorIdentifier,
  );

  async function plansButPerformsNothingOnADryRunWhenTheDetailAlreadyExists() {
    const { api, writes } = makeGameCenterApi({});
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: true,
    });

    expect(writes.achievements).toHaveLength(0);
    expect(writes.leaderboards).toHaveLength(0);

    function everyAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(everyAction)).toBe(true);
    // 2 creates + 2 localizations planned (detail already exists, so no enable action)
    expect(report.actions).toHaveLength(4);
  }

  it(
    'plans but performs nothing on a dry-run when the detail already exists',
    plansButPerformsNothingOnADryRunWhenTheDetailAlreadyExists,
  );

  async function plansEnablePlusCreatesOnADryRunWhenGameCenterIsNotYetEnabled() {
    const { api, writes } = makeGameCenterApi({ detailId: null });
    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: true,
    });

    expect(writes.detailCreated).toBe(0);
    expect(writes.achievements).toHaveLength(0);

    function readDescription(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description;
    }

    expect(report.actions.map(readDescription)).toEqual([
      'enable Game Center for the app',
      'create achievement first_win (10 pts)',
      'set achievement first_win localization (en-US)',
      'create leaderboard high_score (INTEGER)',
      'set leaderboard high_score localization (en-US)',
    ]);

    function everyAction2(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(everyAction2)).toBe(true);
  }

  it(
    'plans enable plus creates on a dry-run when Game Center is not yet enabled',
    plansEnablePlusCreatesOnADryRunWhenGameCenterIsNotYetEnabled,
  );

  async function recordsTheLocalizationAsSkippedNotFailedWhenAppleReturnsNoVersionId() {
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
  }

  it(
    'records the localization as skipped (not failed) when Apple returns no version id',
    recordsTheLocalizationAsSkippedNotFailedWhenAppleReturnsNoVersionId,
  );

  async function capturesAFailedCreateAndSkipsThatPieceSLocalization() {
    const { api, writes } = makeGameCenterApi({});

    function runPiece() {
      return Promise.reject(new Error('vendor id taken'));
    }

    api.createGameCenterLeaderboard = runPiece;

    const report = await runReconcile(api, {
      bundleId: 'com.acme.app',
      config: SAMPLE_CONFIG,
      dryRun: false,
    });
    const summary = summarize(report.actions);

    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(writes.leaderboardLocales).toHaveLength(0);

    function findAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    const failedAction = report.actions.find(findAction);

    expect(failedAction).toBeDefined();

    if (failedAction == null) return;

    expect(failedAction.error).toBe('vendor id taken');
  }

  it(
    "captures a failed create and skips that item's localization",
    capturesAFailedCreateAndSkipsThatPieceSLocalization,
  );

  async function skipsAchievementsAndLeaderboardsWhenEnablingGameCenterFails() {
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

    function findAction2(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    const failedEnable = report.actions.find(findAction2);

    expect(failedEnable).toBeDefined();

    if (failedEnable == null) return;

    expect(failedEnable.error).toBe('enable denied');
  }

  it(
    'skips achievements and leaderboards when enabling Game Center fails',
    skipsAchievementsAndLeaderboardsWhenEnablingGameCenterFails,
  );

  async function honorsDeclaredLocaleAndAchievementFlagsOnCreate() {
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
  }

  it(
    'honors declared locale and achievement flags on create',
    honorsDeclaredLocaleAndAchievementFlagsOnCreate,
  );

  async function recordsAFailedLocalizationWhenAppleRejectsTheLocalizationCreate() {
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

    function findAction3(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    const failedLocalization = report.actions.find(findAction3);

    expect(failedLocalization).toBeDefined();

    if (failedLocalization == null) return;

    expect(failedLocalization.error).toBe('locale not allowed');
  }

  it(
    'records a failed localization when Apple rejects the localization create',
    recordsAFailedLocalizationWhenAppleRejectsTheLocalizationCreate,
  );
}

describe('reconcileGameCenter', describeReconcileGameCenter);
