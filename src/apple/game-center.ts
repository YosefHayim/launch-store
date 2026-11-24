// Reconciles Game Center achievements and leaderboards on App Store Connect.

import {
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
  type GameCenterAchievementCreate,
  type GameCenterAchievementResource,
  type GameCenterDetailResource,
  type GameCenterLeaderboardCreate,
  type GameCenterLeaderboardResource,
} from '../types/apple/game-center.ts';
import { appRecordMissing, plan, skip, type ReconcileContext } from '../store/shared/reconcile.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import type {
  AchievementConfig,
  GameCenterConfig,
  LeaderboardConfig,
} from '../types/store-surface.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { decodeStoreSurfaceConfig } from '../store/shared/surface-config.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

const GAME_CENTER_DOCUMENT_NAME = 'launch.config.ts gameCenter';

type CreatedGameCenterItem = {
  id: string;
  versionId: string | null;
};

/** The exact slice of App Store Connect the Game Center reconciler depends on. */
export type AscGameCenterApi = {
  getAppId(bundleId: string): Promise<string | null>;

  getGameCenterDetail(appId: string): Promise<GameCenterDetailResource | null>;

  createGameCenterDetail(appId: string): Promise<GameCenterDetailResource>;

  listGameCenterAchievements(detailId: string): Promise<GameCenterAchievementResource[]>;

  createGameCenterAchievement(
    detailId: string,
    achievement: GameCenterAchievementCreate,
  ): Promise<CreatedGameCenterItem>;

  createGameCenterAchievementLocalization(
    versionId: string,
    localization: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Promise<void>;

  listGameCenterLeaderboards(detailId: string): Promise<GameCenterLeaderboardResource[]>;

  createGameCenterLeaderboard(
    detailId: string,
    leaderboard: GameCenterLeaderboardCreate,
  ): Promise<CreatedGameCenterItem>;

  createGameCenterLeaderboardLocalization(
    versionId: string,
    localization: {
      locale: string;
      name: string;
    },
  ): Promise<void>;
};

/** Inputs to reconcile one app's Game Center config. */
type GameCenterReconcileInput = {
  bundleId: string;
  config: GameCenterConfig;
  dryRun: boolean;
};

/** Where the detail stands after ensuring it */
type EnsuredDetail = {
  detailId: string | null;
  existed: boolean;
} | null;

function readRequiredText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: ${fieldName} must be a non-empty string.`);
  }

  const isEmpty = field.length == 0;

  if (isEmpty) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: ${fieldName} must be a non-empty string.`);
  }

  return field;
}

function readPoints(record: Record<string, unknown>): number {
  const points = record['points'];
  const isNumber = typeof points == 'number';

  if (isNumber == false) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: points must be a non-negative integer.`);
  }

  const isWhole = Number.isInteger(points);

  if (isWhole == false) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: points must be a non-negative integer.`);
  }

  const isNegative = points < 0;

  if (isNegative) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: points must be a non-negative integer.`);
  }

  return points;
}

function isListedText<Literal extends string>(
  candidate: unknown,
  allowed: readonly Literal[],
): candidate is Literal {
  if (typeof candidate != 'string') {
    return false;
  }

  for (const allowedText of allowed) {
    const isMatch = allowedText == candidate;

    if (isMatch) {
      return true;
    }
  }

  return false;
}

function readExactOptionalBoolean(
  record: Record<string, unknown>,
  fieldName: string,
): boolean | null {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return null;
  }

  const field = record[fieldName];
  const isBoolean = typeof field == 'boolean';

  if (isBoolean == false) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: ${fieldName} must be a boolean.`);
  }

  return field;
}

function readExactOptionalText(record: Record<string, unknown>, fieldName: string): string | null {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return null;
  }

  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: ${fieldName} must be a string.`);
  }

  return field;
}

function readAchievement(entry: unknown): AchievementConfig {
  const entryObject = readPlainObject(entry);

  if (entryObject == null) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: achievement entries must be JSON objects.`);
  }

  const achievement: {
    vendorIdentifier: string;
    referenceName: string;
    points: number;
    showBeforeEarned?: boolean;
    repeatable?: boolean;
    name: string;
    beforeEarnedDescription: string;
    afterEarnedDescription: string;
    locale?: string;
  } = {
    vendorIdentifier: readRequiredText(entryObject, 'vendorIdentifier'),
    referenceName: readRequiredText(entryObject, 'referenceName'),
    points: readPoints(entryObject),
    name: readRequiredText(entryObject, 'name'),
    beforeEarnedDescription: readRequiredText(entryObject, 'beforeEarnedDescription'),
    afterEarnedDescription: readRequiredText(entryObject, 'afterEarnedDescription'),
  };
  const showBeforeEarned = readExactOptionalBoolean(entryObject, 'showBeforeEarned');

  const hasShowBeforeEarned = showBeforeEarned != null;

  if (hasShowBeforeEarned) {
    achievement.showBeforeEarned = showBeforeEarned;
  }

  const repeatable = readExactOptionalBoolean(entryObject, 'repeatable');

  const hasRepeatable = repeatable != null;

  if (hasRepeatable) {
    achievement.repeatable = repeatable;
  }

  const locale = readExactOptionalText(entryObject, 'locale');

  const hasLocale = locale != null;

  if (hasLocale) {
    achievement.locale = locale;
  }

  return achievement;
}

function readLeaderboard(entry: unknown): LeaderboardConfig {
  const entryObject = readPlainObject(entry);

  if (entryObject == null) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: leaderboard entries must be JSON objects.`);
  }

  const defaultFormatter = entryObject['defaultFormatter'];
  const isFormatter = isListedText(defaultFormatter, LEADERBOARD_FORMATTERS);

  if (isFormatter == false) {
    throw new Error(
      `${GAME_CENTER_DOCUMENT_NAME}: defaultFormatter must be one of ${LEADERBOARD_FORMATTERS.join(', ')}.`,
    );
  }

  const submissionType = entryObject['submissionType'];
  const isSubmissionType = isListedText(submissionType, LEADERBOARD_SUBMISSION_TYPES);

  if (isSubmissionType == false) {
    throw new Error(
      `${GAME_CENTER_DOCUMENT_NAME}: submissionType must be BEST_SCORE or MOST_RECENT_SCORE.`,
    );
  }

  const scoreSortType = entryObject['scoreSortType'];
  const isScoreSortType = isListedText(scoreSortType, LEADERBOARD_SORT_TYPES);

  if (isScoreSortType == false) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: scoreSortType must be ASC or DESC.`);
  }

  const leaderboard: {
    vendorIdentifier: string;
    referenceName: string;
    defaultFormatter: LeaderboardConfig['defaultFormatter'];
    submissionType: LeaderboardConfig['submissionType'];
    scoreSortType: LeaderboardConfig['scoreSortType'];
    name: string;
    locale?: string;
  } = {
    vendorIdentifier: readRequiredText(entryObject, 'vendorIdentifier'),
    referenceName: readRequiredText(entryObject, 'referenceName'),
    defaultFormatter,
    submissionType,
    scoreSortType,
    name: readRequiredText(entryObject, 'name'),
  };
  const locale = readExactOptionalText(entryObject, 'locale');

  const hasLocale = locale != null;

  if (hasLocale) {
    leaderboard.locale = locale;
  }

  return leaderboard;
}

function readConfigList<Entry>(
  documentRecord: Record<string, unknown>,
  fieldName: string,
  readEntry: (entry: unknown) => Entry,
): readonly Entry[] | null {
  const hasField = Object.hasOwn(documentRecord, fieldName);

  if (hasField == false) {
    return null;
  }

  const field = documentRecord[fieldName];
  const isList = Array.isArray(field);

  if (isList == false) {
    throw new Error(`${GAME_CENTER_DOCUMENT_NAME}: ${fieldName} must be an array.`);
  }

  const entries: Entry[] = [];

  for (const entry of field) {
    entries.push(readEntry(entry));
  }

  return entries;
}

function listCount(entries: readonly unknown[] | null): number {
  if (entries == null) {
    return 0;
  }

  return entries.length;
}

function decodeGameCenterDocument(rawDocument: unknown): GameCenterConfig {
  const documentRecord = rawDocument as Record<string, unknown>;
  const achievements = readConfigList(documentRecord, 'achievements', readAchievement);
  const leaderboards = readConfigList(documentRecord, 'leaderboards', readLeaderboard);
  const declaredCount = listCount(achievements) + listCount(leaderboards);
  const hasDeclaration = declaredCount > 0;

  if (hasDeclaration == false) {
    throw new Error(
      'launch.config.ts gameCenter must declare at least one entry under "achievements" or "leaderboards".',
    );
  }

  const gameCenterConfig: {
    achievements?: readonly AchievementConfig[];
    leaderboards?: readonly LeaderboardConfig[];
  } = {};

  const hasAchievements = achievements != null;

  if (hasAchievements) {
    gameCenterConfig.achievements = achievements;
  }

  const hasLeaderboards = leaderboards != null;

  if (hasLeaderboards) {
    gameCenterConfig.leaderboards = leaderboards;
  }

  return gameCenterConfig;
}

const gameCenterConfigSpec = {
  documentName: GAME_CENTER_DOCUMENT_NAME,
  displayName: 'Game Center config',
  decodeDocument: decodeGameCenterDocument,
};

/** Collect developer-chosen vendor identifiers already live on a detail. */
function vendorIdentifiersOf(
  resources: ReadonlyArray<{ readonly vendorIdentifier?: string }>,
): Set<string> {
  const vendorIdentifiers = new Set<string>();

  for (const resource of resources) {
    const vendorIdentifier = resource.vendorIdentifier;

    const isMissing = vendorIdentifier == null;

    if (isMissing) {
      continue;
    }

    vendorIdentifiers.add(vendorIdentifier);
  }

  return vendorIdentifiers;
}

/** Localization locale declared on the config entry, else the Game Center default. */
function localizationLocale(locale: string | undefined): string {
  const hasLocale = locale != null;

  if (hasLocale) {
    return locale;
  }

  return 'en-US';
}

/** Run a localization create against the version returned by the parent create. */
async function applyLocalization(
  localizationAction: MutableDeep<PlannedAction>,
  versionId: string | null,
  vendorIdentifier: string,
  writeLocalization: (confirmedVersionId: string) => Promise<void>,
): Promise<void> {
  const isVersionMissing = versionId == null;

  if (isVersionMissing) {
    localizationAction.status = 'skipped';
    localizationAction.description = `localization for ${vendorIdentifier}: created the item, but no version id was returned - add it in App Store Connect`;
    return;
  }

  try {
    await writeLocalization(versionId);
    localizationAction.status = 'applied';
  } catch (writeFailure) {
    localizationAction.status = 'failed';
    localizationAction.error = errorMessage(writeFailure);
  }
}

/** Plan create + localization, then apply when not dry-run. */
async function createItemWithLocalization(
  reconcileContext: ReconcileContext,
  createDescription: string,
  localizationDescription: string,
  vendorIdentifier: string,
  createItem: () => Promise<CreatedGameCenterItem>,
  writeLocalization: (confirmedVersionId: string) => Promise<void>,
): Promise<void> {
  const createAction = plan(reconcileContext, createDescription);
  const localizationAction = plan(reconcileContext, localizationDescription);

  const isDryRun = reconcileContext.dryRun == true;

  if (isDryRun) {
    return;
  }

  try {
    const created = await createItem();
    createAction.status = 'applied';
    var versionId = created.versionId;
  } catch (writeFailure) {
    createAction.status = 'failed';
    createAction.error = errorMessage(writeFailure);
    localizationAction.status = 'skipped';
    return;
  }

  await applyLocalization(localizationAction, versionId, vendorIdentifier, writeLocalization);
}

/** Read the app's Game Center detail, creating it (enabling Game Center) when absent. */
async function ensureDetail(
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  appId: string,
): Promise<EnsuredDetail> {
  const existingDetail = await api.getGameCenterDetail(appId);

  const hasDetail = existingDetail != null;

  if (hasDetail) {
    return { detailId: existingDetail.id, existed: true };
  }

  const enableAction = plan(reconcileContext, 'enable Game Center for the app');

  const isDryRun = reconcileContext.dryRun == true;

  if (isDryRun) {
    return { detailId: null, existed: false };
  }

  try {
    const createdDetail = await api.createGameCenterDetail(appId);
    enableAction.status = 'applied';
    return { detailId: createdDetail.id, existed: false };
  } catch (writeFailure) {
    enableAction.status = 'failed';
    enableAction.error = errorMessage(writeFailure);
    return null;
  }
}

function hasExistingDetailId(detail: {
  existed: boolean;
  detailId: string | null;
}): detail is { existed: true; detailId: string } {
  if (detail.existed == false) {
    return false;
  }

  return detail.detailId != null;
}

/** Create each declared achievement the detail doesn't have yet, with its localization. */
async function reconcileAchievements(
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  detail: NonNullable<EnsuredDetail>,
  declaredAchievements: readonly AchievementConfig[],
): Promise<void> {
  let existingIdentifiers = new Set<string>();

  const shouldListExisting = hasExistingDetailId(detail);

  if (shouldListExisting) {
    const liveAchievements = await api.listGameCenterAchievements(detail.detailId);
    existingIdentifiers = vendorIdentifiersOf(liveAchievements);
  }

  for (const achievement of declaredAchievements) {
    const alreadyExists = existingIdentifiers.has(achievement.vendorIdentifier);

    if (alreadyExists) {
      continue;
    }

    const locale = localizationLocale(achievement.locale);
    const detailId = detail.detailId;

    async function createAchievement(): Promise<CreatedGameCenterItem> {
      const isDetailMissing = detailId == null;

      if (isDetailMissing) {
        throw new Error('Game Center detail id missing on apply');
      }

      return api.createGameCenterAchievement(detailId, {
        referenceName: achievement.referenceName,
        vendorIdentifier: achievement.vendorIdentifier,
        points: achievement.points,
        showBeforeEarned: achievement.showBeforeEarned == true,
        repeatable: achievement.repeatable == true,
      });
    }

    function writeAchievementLocalization(confirmedVersionId: string): Promise<void> {
      return api.createGameCenterAchievementLocalization(confirmedVersionId, {
        locale,
        name: achievement.name,
        beforeEarnedDescription: achievement.beforeEarnedDescription,
        afterEarnedDescription: achievement.afterEarnedDescription,
      });
    }

    await createItemWithLocalization(
      reconcileContext,
      `create achievement ${achievement.vendorIdentifier} (${achievement.points} pts)`,
      `set achievement ${achievement.vendorIdentifier} localization (${locale})`,
      achievement.vendorIdentifier,
      createAchievement,
      writeAchievementLocalization,
    );
  }
}

/** Create each declared leaderboard the detail doesn't have yet, with its localization. */
async function reconcileLeaderboards(
  reconcileContext: ReconcileContext,
  api: AscGameCenterApi,
  detail: NonNullable<EnsuredDetail>,
  declaredLeaderboards: readonly LeaderboardConfig[],
): Promise<void> {
  let existingIdentifiers = new Set<string>();

  const shouldListExisting = hasExistingDetailId(detail);

  if (shouldListExisting) {
    const liveLeaderboards = await api.listGameCenterLeaderboards(detail.detailId);
    existingIdentifiers = vendorIdentifiersOf(liveLeaderboards);
  }

  for (const leaderboard of declaredLeaderboards) {
    const alreadyExists = existingIdentifiers.has(leaderboard.vendorIdentifier);

    if (alreadyExists) {
      continue;
    }

    const locale = localizationLocale(leaderboard.locale);
    const detailId = detail.detailId;

    async function createLeaderboard(): Promise<CreatedGameCenterItem> {
      const isDetailMissing = detailId == null;

      if (isDetailMissing) {
        throw new Error('Game Center detail id missing on apply');
      }

      return api.createGameCenterLeaderboard(detailId, {
        referenceName: leaderboard.referenceName,
        vendorIdentifier: leaderboard.vendorIdentifier,
        defaultFormatter: leaderboard.defaultFormatter,
        submissionType: leaderboard.submissionType,
        scoreSortType: leaderboard.scoreSortType,
      });
    }

    function writeLeaderboardLocalization(confirmedVersionId: string): Promise<void> {
      return api.createGameCenterLeaderboardLocalization(confirmedVersionId, {
        locale,
        name: leaderboard.name,
      });
    }

    await createItemWithLocalization(
      reconcileContext,
      `create leaderboard ${leaderboard.vendorIdentifier} (${leaderboard.defaultFormatter})`,
      `set leaderboard ${leaderboard.vendorIdentifier} localization (${locale})`,
      leaderboard.vendorIdentifier,
      createLeaderboard,
      writeLeaderboardLocalization,
    );
  }
}

/** Reconcile one app's Game Center achievements and leaderboards. */
export async function reconcileGameCenter(
  api: AscGameCenterApi,
  reconcileInput: GameCenterReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun: reconcileInput.dryRun };
  const gameCenterConfig = reconcileInput.config;
  const appId = await api.getAppId(reconcileInput.bundleId);

  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw appRecordMissing(reconcileInput.bundleId, 'game-center');
  }

  const detail = await ensureDetail(reconcileContext, api, appId);

  const isDetailMissing = detail == null;

  if (isDetailMissing) {
    skip(
      reconcileContext,
      'achievements / leaderboards: skipped - Game Center could not be enabled for the app',
    );

    return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
  }

  let achievements: readonly AchievementConfig[] = [];

  const hasAchievements = gameCenterConfig.achievements != null;

  if (hasAchievements) {
    achievements = gameCenterConfig.achievements;
  }

  let leaderboards: readonly LeaderboardConfig[] = [];

  const hasLeaderboards = gameCenterConfig.leaderboards != null;

  if (hasLeaderboards) {
    leaderboards = gameCenterConfig.leaderboards;
  }

  await reconcileAchievements(reconcileContext, api, detail, achievements);
  await reconcileLeaderboards(reconcileContext, api, detail, leaderboards);

  return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
}

/** Decode a Game Center section from launch.config.ts. */
export function parseGameCenterConfig(rawDocument: unknown): GameCenterConfig {
  return decodeStoreSurfaceConfig(rawDocument, gameCenterConfigSpec);
}
