import { Effect, Schema } from 'effect';
import {
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
  type GameCenterAchievementResource,
  type GameCenterDetailResource,
  type GameCenterLeaderboardResource,
  type LeaderboardFormatter,
  type LeaderboardSortType,
  type LeaderboardSubmissionType,
} from '../types/appleCatalog.js';
import { appRecordMissing, plan, skip, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { PlannedAction } from '../types/reconcile.js';
import type { MutableDeep } from '../types/mutable.js';
import type {
  AchievementConfig,
  GameCenterConfig,
  LeaderboardConfig,
} from '../types/storeSurface.js';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigFailure,
} from './surfaceConfig.js';
/** Default locale for an achievement / leaderboard localization that doesn't name one. */
const DEFAULT_LOCALE = 'en-US';

const requiredText = (fieldName: string) =>
  Schema.String.pipe(
    Schema.nonEmptyString({
      message: () => `gamecenter.config.json: ${fieldName} must be a non-empty string.`,
    }),
  );

const AchievementConfigSchema = Schema.mutable(
  Schema.Struct({
    vendorIdentifier: requiredText('vendorIdentifier'),
    referenceName: requiredText('referenceName'),
    points: Schema.Number.pipe(
      Schema.int({
        message: () => 'gamecenter.config.json: points must be a non-negative integer.',
      }),
      Schema.nonNegative({
        message: () => 'gamecenter.config.json: points must be a non-negative integer.',
      }),
    ),
    showBeforeEarned: Schema.optionalWith(Schema.Boolean, { exact: true }),
    repeatable: Schema.optionalWith(Schema.Boolean, { exact: true }),
    name: requiredText('name'),
    beforeEarnedDescription: requiredText('beforeEarnedDescription'),
    afterEarnedDescription: requiredText('afterEarnedDescription'),
    locale: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

const LeaderboardConfigSchema = Schema.mutable(
  Schema.Struct({
    vendorIdentifier: requiredText('vendorIdentifier'),
    referenceName: requiredText('referenceName'),
    defaultFormatter: Schema.Literal(...LEADERBOARD_FORMATTERS).annotations({
      message: () =>
        `gamecenter.config.json: defaultFormatter must be one of ${LEADERBOARD_FORMATTERS.join(', ')}.`,
    }),
    submissionType: Schema.Literal(...LEADERBOARD_SUBMISSION_TYPES).annotations({
      message: () =>
        'gamecenter.config.json: submissionType must be BEST_SCORE or MOST_RECENT_SCORE.',
    }),
    scoreSortType: Schema.Literal(...LEADERBOARD_SORT_TYPES).annotations({
      message: () => 'gamecenter.config.json: scoreSortType must be ASC or DESC.',
    }),
    name: requiredText('name'),
    locale: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

export const GameCenterConfigSchema = Schema.mutable(
  Schema.Struct({
    achievements: Schema.optionalWith(Schema.mutable(Schema.Array(AchievementConfigSchema)), {
      exact: true,
    }),
    leaderboards: Schema.optionalWith(Schema.mutable(Schema.Array(LeaderboardConfigSchema)), {
      exact: true,
    }),
  }),
).pipe(
  Schema.filter((gameCenterConfig) => {
    let achievementCount = 0;
    if (gameCenterConfig.achievements !== undefined) {
      achievementCount = gameCenterConfig.achievements.length;
    }
    let leaderboardCount = 0;
    if (gameCenterConfig.leaderboards !== undefined) {
      leaderboardCount = gameCenterConfig.leaderboards.length;
    }
    if (achievementCount + leaderboardCount > 0) return true;
    return 'gamecenter.config.json must declare at least one entry under "achievements" or "leaderboards".';
  }),
);

const GameCenterConfigSpec = {
  documentName: 'gamecenter.config.json',
  displayName: 'Game Center config',
  missingMessage: (configPath: string) =>
    `No Game Center config at ${configPath}. Create one (see \`launch game-center --help\`) or pass --config.`,
  schema: GameCenterConfigSchema,
};
/**
 * The exact slice of {@link AppStoreConnectClient} the Game Center reconciler depends on. Declared here
 * (rather than the concrete client) so the diff logic is unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscReleaseApi} in `releaseAttrs.ts`.
 */
export type AscGameCenterApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  getGameCenterDetail(appId: string): Effect.Effect<GameCenterDetailResource | null, unknown>;
  createGameCenterDetail(appId: string): Effect.Effect<GameCenterDetailResource, unknown>;
  listGameCenterAchievements(
    detailId: string,
  ): Effect.Effect<GameCenterAchievementResource[], unknown>;
  createGameCenterAchievement(
    detailId: string,
    attributes: {
      referenceName: string;
      vendorIdentifier: string;
      points: number;
      showBeforeEarned: boolean;
      repeatable: boolean;
    },
  ): Effect.Effect<
    {
      id: string;
      versionId: string | null;
    },
    unknown
  >;
  createGameCenterAchievementLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Effect.Effect<void, unknown>;
  listGameCenterLeaderboards(
    detailId: string,
  ): Effect.Effect<GameCenterLeaderboardResource[], unknown>;
  createGameCenterLeaderboard(
    detailId: string,
    attributes: {
      referenceName: string;
      vendorIdentifier: string;
      defaultFormatter: LeaderboardFormatter;
      submissionType: LeaderboardSubmissionType;
      scoreSortType: LeaderboardSortType;
    },
  ): Effect.Effect<
    {
      id: string;
      versionId: string | null;
    },
    unknown
  >;
  createGameCenterLeaderboardLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
    },
  ): Effect.Effect<void, unknown>;
};
/** Inputs to reconcile one app's Game Center config. */
export type GameCenterReconcileInput = {
  bundleId: string;
  config: GameCenterConfig;
  dryRun: boolean;
};
/** Where the detail stands after ensuring it: its id (and whether it pre-existed) or `null` when create failed. */
type EnsuredDetail = {
  detailId: string | null;
  existed: boolean;
} | null;
/**
 * Reconcile one app's Game Center achievements and leaderboards. Throws only for a precondition the user
 * must fix (no ASC app record); everything else is captured per-action so a single failure never aborts
 * the run.
 */
export const reconcileGameCenter = (
  api: AscGameCenterApi,
  input: GameCenterReconcileInput,
): Effect.Effect<{ bundleId: string; actions: PlannedAction[] }, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: input.dryRun };
    const { config } = input;
    const appId = yield* api.getAppId(input.bundleId);
    if (!appId) return yield* Effect.fail(appRecordMissing(input.bundleId, 'game-center'));
    const detail = yield* ensureDetail(reconcileContext, api, appId);
    if (!detail) {
      skip(
        reconcileContext,
        'achievements / leaderboards: skipped - Game Center could not be enabled for the app',
      );
      return { bundleId: input.bundleId, actions: reconcileContext.actions };
    }
    let achievements: readonly AchievementConfig[] = [];
    if (config.achievements !== undefined) achievements = config.achievements;
    let leaderboards: readonly LeaderboardConfig[] = [];
    if (config.leaderboards !== undefined) leaderboards = config.leaderboards;
    yield* reconcileAchievements(reconcileContext, api, detail, achievements);
    yield* reconcileLeaderboards(reconcileContext, api, detail, leaderboards);
    return { bundleId: input.bundleId, actions: reconcileContext.actions };
  });
/** Read the app's Game Center detail, creating it (enabling Game Center) when absent. */
const ensureDetail = (
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  appId: string,
): Effect.Effect<EnsuredDetail, unknown> =>
  Effect.gen(function* () {
    const existing = yield* api.getGameCenterDetail(appId);
    if (existing) return { detailId: existing.id, existed: true };
    const action = plan(reconcileContext, 'enable Game Center for the app');
    if (reconcileContext.dryRun) return { detailId: null, existed: false };
    return yield* api.createGameCenterDetail(appId).pipe(
      Effect.match({
        onFailure: (writeFailure): EnsuredDetail => {
          action.status = 'failed';
          action.error = errorMessage(writeFailure);
          return null;
        },
        onSuccess: (created): EnsuredDetail => {
          action.status = 'applied';
          return { detailId: created.id, existed: false };
        },
      }),
    );
  });
/** Create each declared achievement the detail doesn't have yet (by `vendorIdentifier`), with its localization. */
const reconcileAchievements = (
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  detail: NonNullable<EnsuredDetail>,
  declared: readonly AchievementConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let existingIdentifiers = new Set<string>();
    if (detail.existed && detail.detailId !== null) {
      const liveAchievements = yield* api.listGameCenterAchievements(detail.detailId);
      existingIdentifiers = new Set(
        liveAchievements.flatMap((achievement) => {
          if (achievement.vendorIdentifier !== undefined) return [achievement.vendorIdentifier];
          return [];
        }),
      );
    }
    for (const achievement of declared) {
      if (existingIdentifiers.has(achievement.vendorIdentifier)) continue;
      let locale = DEFAULT_LOCALE;
      if (achievement.locale !== undefined) locale = achievement.locale;
      const createAction = plan(
        reconcileContext,
        `create achievement ${achievement.vendorIdentifier} (${achievement.points} pts)`,
      );
      const localizationAction = plan(
        reconcileContext,
        `set achievement ${achievement.vendorIdentifier} localization (${locale})`,
      );
      if (reconcileContext.dryRun) continue;
      if (!detail.detailId) continue;
      const versionId = yield* api
        .createGameCenterAchievement(detail.detailId, {
          referenceName: achievement.referenceName,
          vendorIdentifier: achievement.vendorIdentifier,
          points: achievement.points,
          showBeforeEarned: achievement.showBeforeEarned === true,
          repeatable: achievement.repeatable === true,
        })
        .pipe(
          Effect.match({
            onFailure: (writeFailure) => {
              createAction.status = 'failed';
              createAction.error = errorMessage(writeFailure);
              localizationAction.status = 'skipped';
              return null;
            },
            onSuccess: (created) => {
              createAction.status = 'applied';
              return created.versionId;
            },
          }),
        );
      if (createAction.status === 'failed') continue;
      yield* applyLocalization(
        localizationAction,
        versionId,
        achievement.vendorIdentifier,
        (confirmedVersionId) =>
          api.createGameCenterAchievementLocalization(confirmedVersionId, {
            locale,
            name: achievement.name,
            beforeEarnedDescription: achievement.beforeEarnedDescription,
            afterEarnedDescription: achievement.afterEarnedDescription,
          }),
      );
    }
  });
/** Create each declared leaderboard the detail doesn't have yet (by `vendorIdentifier`), with its localization. */
const reconcileLeaderboards = (
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  detail: NonNullable<EnsuredDetail>,
  declared: readonly LeaderboardConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let existingIdentifiers = new Set<string>();
    if (detail.existed && detail.detailId !== null) {
      const liveLeaderboards = yield* api.listGameCenterLeaderboards(detail.detailId);
      existingIdentifiers = new Set(
        liveLeaderboards.flatMap((leaderboard) => {
          if (leaderboard.vendorIdentifier !== undefined) return [leaderboard.vendorIdentifier];
          return [];
        }),
      );
    }
    for (const leaderboard of declared) {
      if (existingIdentifiers.has(leaderboard.vendorIdentifier)) continue;
      let locale = DEFAULT_LOCALE;
      if (leaderboard.locale !== undefined) locale = leaderboard.locale;
      const createAction = plan(
        reconcileContext,
        `create leaderboard ${leaderboard.vendorIdentifier} (${leaderboard.defaultFormatter})`,
      );
      const localizationAction = plan(
        reconcileContext,
        `set leaderboard ${leaderboard.vendorIdentifier} localization (${locale})`,
      );
      if (reconcileContext.dryRun) continue;
      if (!detail.detailId) continue;
      const versionId = yield* api
        .createGameCenterLeaderboard(detail.detailId, {
          referenceName: leaderboard.referenceName,
          vendorIdentifier: leaderboard.vendorIdentifier,
          defaultFormatter: leaderboard.defaultFormatter,
          submissionType: leaderboard.submissionType,
          scoreSortType: leaderboard.scoreSortType,
        })
        .pipe(
          Effect.match({
            onFailure: (writeFailure) => {
              createAction.status = 'failed';
              createAction.error = errorMessage(writeFailure);
              localizationAction.status = 'skipped';
              return null;
            },
            onSuccess: (created) => {
              createAction.status = 'applied';
              return created.versionId;
            },
          }),
        );
      if (createAction.status === 'failed') continue;
      yield* applyLocalization(
        localizationAction,
        versionId,
        leaderboard.vendorIdentifier,
        (confirmedVersionId) =>
          api.createGameCenterLeaderboardLocalization(confirmedVersionId, {
            locale,
            name: leaderboard.name,
          }),
      );
    }
  });
/**
 * Run a localization create against the version returned by the parent create. When Apple didn't echo a
 * version id, the parent still succeeded - so the localization is recorded as skipped (add it in App Store
 * Connect) rather than failed.
 */
const applyLocalization = (
  action: MutableDeep<PlannedAction>,
  versionId: string | null,
  vendorIdentifier: string,
  createLocalization: (confirmedVersionId: string) => Effect.Effect<void, unknown>,
): Effect.Effect<void> => {
  if (!versionId) {
    action.status = 'skipped';
    action.description = `localization for ${vendorIdentifier}: created the item, but no version id was returned - add it in App Store Connect`;
    return Effect.void;
  }
  return createLocalization(versionId).pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        action.status = 'failed';
        action.error = errorMessage(writeFailure);
      },
      onSuccess: () => {
        action.status = 'applied';
      },
    }),
  );
};
/** Decode an untrusted Game Center config document. */
export const parseGameCenterConfig = (
  rawDocument: unknown,
): Effect.Effect<GameCenterConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, GameCenterConfigSpec);

/** Read and decode gamecenter.config.json through Effect Platform. */
export const loadGameCenterConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, GameCenterConfigSpec);
