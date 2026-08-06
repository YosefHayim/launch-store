import { Effect, Schema } from 'effect';
import {
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
  type GameCenterAchievementCreate,
  type GameCenterAchievementResource,
  type GameCenterDetailResource,
  type GameCenterLeaderboardCreate,
  type GameCenterLeaderboardResource,
} from '../types/appleCatalog.js';
import { appRecordMissing, plan, skip, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { PlannedAction } from '../types/reconcile.js';
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
    achievement: GameCenterAchievementCreate,
  ): Effect.Effect<
    {
      id: string;
      versionId: string | null;
    },
    unknown
  >;
  createGameCenterAchievementLocalization(
    versionId: string,
    localization: {
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
    leaderboard: GameCenterLeaderboardCreate,
  ): Effect.Effect<
    {
      id: string;
      versionId: string | null;
    },
    unknown
  >;
  createGameCenterLeaderboardLocalization(
    versionId: string,
    localization: {
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

/**
 * Where the detail stands after ensuring it: its id (and whether it pre-existed), or `null` when
 * create failed and the rest of the walk must skip.
 */
type EnsuredDetail = {
  detailId: string | null;
  existed: boolean;
} | null;

/** Collect developer-chosen vendor identifiers already live on a detail. */
const vendorIdentifiersOf = (
  resources: ReadonlyArray<{ readonly vendorIdentifier?: string }>,
): Set<string> => {
  const vendorIdentifiers = new Set<string>();
  for (const resource of resources) {
    if (resource.vendorIdentifier === undefined) continue;
    vendorIdentifiers.add(resource.vendorIdentifier);
  }
  return vendorIdentifiers;
};

/** Localization locale declared on the config entry, else the Game Center default. */
const localizationLocale = (locale: string | undefined): string => {
  if (locale !== undefined) return locale;
  return DEFAULT_LOCALE;
};

/**
 * Run a localization create against the version returned by the parent create. When Apple didn't echo a
 * version id, the parent still succeeded - so the localization is recorded as skipped (add it in App Store
 * Connect) rather than failed.
 */
const applyLocalization = (
  localizationAction: PlannedAction,
  versionId: string | null,
  vendorIdentifier: string,
  writeLocalization: (confirmedVersionId: string) => Effect.Effect<void, unknown>,
): Effect.Effect<void> => {
  if (versionId === null) {
    localizationAction.status = 'skipped';
    localizationAction.description = `localization for ${vendorIdentifier}: created the item, but no version id was returned - add it in App Store Connect`;
    return Effect.void;
  }
  return writeLocalization(versionId).pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        localizationAction.status = 'failed';
        localizationAction.error = errorMessage(writeFailure);
      },
      onSuccess: () => {
        localizationAction.status = 'applied';
      },
    }),
  );
};

/**
 * Plan create + localization, then apply when not dry-run. Create failures skip localization;
 * a missing version id from Apple records localization as skipped (add it in App Store Connect).
 */
const createItemWithLocalization = (
  reconcileContext: ReconcileContext,
  createDescription: string,
  localizationDescription: string,
  vendorIdentifier: string,
  createItem: () => Effect.Effect<{ versionId: string | null }, unknown>,
  writeLocalization: (confirmedVersionId: string) => Effect.Effect<void, unknown>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const createAction = plan(reconcileContext, createDescription);
    const localizationAction = plan(reconcileContext, localizationDescription);
    if (reconcileContext.dryRun) return;
    const versionId = yield* createItem().pipe(
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
    if (createAction.status === 'failed') return;
    yield* applyLocalization(localizationAction, versionId, vendorIdentifier, writeLocalization);
  });

/** Read the app's Game Center detail, creating it (enabling Game Center) when absent. */
const ensureDetail = (
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  appId: string,
): Effect.Effect<EnsuredDetail, unknown> =>
  Effect.gen(function* () {
    const existingDetail = yield* api.getGameCenterDetail(appId);
    if (existingDetail !== null) return { detailId: existingDetail.id, existed: true };
    const enableAction = plan(reconcileContext, 'enable Game Center for the app');
    if (reconcileContext.dryRun) return { detailId: null, existed: false };
    return yield* api.createGameCenterDetail(appId).pipe(
      Effect.match({
        onFailure: (writeFailure): EnsuredDetail => {
          enableAction.status = 'failed';
          enableAction.error = errorMessage(writeFailure);
          return null;
        },
        onSuccess: (createdDetail): EnsuredDetail => {
          enableAction.status = 'applied';
          return { detailId: createdDetail.id, existed: false };
        },
      }),
    );
  });

/** Create each declared achievement the detail doesn't have yet (by `vendorIdentifier`), with its localization. */
const reconcileAchievements = (
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  detail: NonNullable<EnsuredDetail>,
  declaredAchievements: AchievementConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let existingIdentifiers = new Set<string>();
    if (detail.existed && detail.detailId !== null) {
      const liveAchievements = yield* api.listGameCenterAchievements(detail.detailId);
      existingIdentifiers = vendorIdentifiersOf(liveAchievements);
    }
    for (const achievement of declaredAchievements) {
      if (existingIdentifiers.has(achievement.vendorIdentifier)) continue;
      const locale = localizationLocale(achievement.locale);
      const detailId = detail.detailId;
      yield* createItemWithLocalization(
        reconcileContext,
        `create achievement ${achievement.vendorIdentifier} (${achievement.points} pts)`,
        `set achievement ${achievement.vendorIdentifier} localization (${locale})`,
        achievement.vendorIdentifier,
        () => {
          // dry-run is the only path with a null detail id; createItem is never invoked then.
          if (detailId === null) {
            return Effect.die('Game Center detail id missing on apply');
          }
          return api.createGameCenterAchievement(detailId, {
            referenceName: achievement.referenceName,
            vendorIdentifier: achievement.vendorIdentifier,
            points: achievement.points,
            showBeforeEarned: achievement.showBeforeEarned === true,
            repeatable: achievement.repeatable === true,
          });
        },
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
  declaredLeaderboards: LeaderboardConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let existingIdentifiers = new Set<string>();
    if (detail.existed && detail.detailId !== null) {
      const liveLeaderboards = yield* api.listGameCenterLeaderboards(detail.detailId);
      existingIdentifiers = vendorIdentifiersOf(liveLeaderboards);
    }
    for (const leaderboard of declaredLeaderboards) {
      if (existingIdentifiers.has(leaderboard.vendorIdentifier)) continue;
      const locale = localizationLocale(leaderboard.locale);
      const detailId = detail.detailId;
      yield* createItemWithLocalization(
        reconcileContext,
        `create leaderboard ${leaderboard.vendorIdentifier} (${leaderboard.defaultFormatter})`,
        `set leaderboard ${leaderboard.vendorIdentifier} localization (${locale})`,
        leaderboard.vendorIdentifier,
        () => {
          if (detailId === null) {
            return Effect.die('Game Center detail id missing on apply');
          }
          return api.createGameCenterLeaderboard(detailId, {
            referenceName: leaderboard.referenceName,
            vendorIdentifier: leaderboard.vendorIdentifier,
            defaultFormatter: leaderboard.defaultFormatter,
            submissionType: leaderboard.submissionType,
            scoreSortType: leaderboard.scoreSortType,
          });
        },
        (confirmedVersionId) =>
          api.createGameCenterLeaderboardLocalization(confirmedVersionId, {
            locale,
            name: leaderboard.name,
          }),
      );
    }
  });

/**
 * Reconcile one app's Game Center achievements and leaderboards. Fails only for a precondition the user
 * must fix (no ASC app record); everything else is captured per-action so a single failure never aborts
 * the run.
 */
export const reconcileGameCenter = (
  api: AscGameCenterApi,
  reconcileInput: GameCenterReconcileInput,
): Effect.Effect<{ bundleId: string; actions: PlannedAction[] }, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: reconcileInput.dryRun };
    const gameCenterConfig = reconcileInput.config;
    const appId = yield* api.getAppId(reconcileInput.bundleId);
    if (appId === null) {
      return yield* Effect.fail(appRecordMissing(reconcileInput.bundleId, 'game-center'));
    }
    const detail = yield* ensureDetail(reconcileContext, api, appId);
    if (detail === null) {
      skip(
        reconcileContext,
        'achievements / leaderboards: skipped - Game Center could not be enabled for the app',
      );
      return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
    }
    let achievements: AchievementConfig[] = [];
    if (gameCenterConfig.achievements !== undefined) achievements = gameCenterConfig.achievements;
    let leaderboards: LeaderboardConfig[] = [];
    if (gameCenterConfig.leaderboards !== undefined) leaderboards = gameCenterConfig.leaderboards;
    yield* reconcileAchievements(reconcileContext, api, detail, achievements);
    yield* reconcileLeaderboards(reconcileContext, api, detail, leaderboards);
    return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
  });

/** Decode an untrusted Game Center config document. */
export const parseGameCenterConfig = (
  rawDocument: unknown,
): Effect.Effect<GameCenterConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, GameCenterConfigSpec);

/** Read and decode gamecenter.config.json through Effect Platform. */
export const loadGameCenterConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, GameCenterConfigSpec);
