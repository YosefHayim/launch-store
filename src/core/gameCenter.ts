/**
 * Reconcile an app's **Game Center achievements and leaderboards** from a declarative `gamecenter.config.json`
 * to match App Store Connect, using the App Store Connect API key alone. Defining achievements and
 * leaderboards is repeatable, click-heavy App Store Connect work that EAS doesn't touch at all.
 *
 * The flow, per app:
 * 1. Ensure the app's **Game Center detail** exists (the container that enables Game Center) — created if
 *    absent, since achievements and leaderboards hang off it.
 * 2. **Additively** create each declared achievement / leaderboard the detail doesn't already have, matched
 *    on its developer-chosen `vendorIdentifier`, each with its default-locale localization. Apple's V2
 *    model couples an achievement/leaderboard to an initial *version* and attaches localizations to that
 *    version; the ASC client hides that (create returns the new version id, the localization targets it).
 *
 * Design mirrors {@link reconcileRelease `core/releaseAttrs.ts`} / {@link reconcileApp `core/ascSync.ts`}:
 * a read-only PLAN pass builds idempotent {@link PlannedAction}s, the command prints them, then an APPLY
 * pass performs them, each action isolated so one failure never aborts the rest. The diff is additive —
 * existing achievements/leaderboards are left untouched (re-run safe); editing one means a new version,
 * which is a deliberate App Store Connect action, not config drift.
 *
 * Scope: achievements and leaderboards plus their **default-locale** localization. Out of scope (deliberate
 * follow-ups): updating existing items, extra locales, leaderboard sets, groups, achievement/leaderboard
 * images, activities, score recurrence, challenges, and **publishing a version live** — Game Center
 * requires a separate release step that this reconcile leaves to App Store Connect.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  LEADERBOARD_FORMATTERS,
  type GameCenterAchievementResource,
  type GameCenterDetailResource,
  type GameCenterLeaderboardResource,
  type LeaderboardFormatter,
  type LeaderboardSortType,
  type LeaderboardSubmissionType,
} from "../apple/ascClient.js";
import { appRecordMissing, plan, skip, type PlannedAction, type ReconcileContext } from "./asc/storeSync.js";
import { errorMessage } from "./errorMessage.js";
import { asRecord } from "./json.js";
import type { AchievementConfig, GameCenterConfig, LeaderboardConfig } from "./types.js";

/** Default locale for an achievement / leaderboard localization that doesn't name one. */
const DEFAULT_LOCALE = "en-US";
const SUBMISSION_TYPES: readonly LeaderboardSubmissionType[] = ["BEST_SCORE", "MOST_RECENT_SCORE"];
const SORT_TYPES: readonly LeaderboardSortType[] = ["ASC", "DESC"];

/**
 * The exact slice of {@link AppStoreConnectClient} the Game Center reconciler depends on. Declared here
 * (rather than the concrete client) so the diff logic is unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscReleaseApi} in `releaseAttrs.ts`.
 */
export interface AscGameCenterApi {
  getAppId(bundleId: string): Promise<string | null>;
  getGameCenterDetail(appId: string): Promise<GameCenterDetailResource | null>;
  createGameCenterDetail(appId: string): Promise<GameCenterDetailResource>;
  listGameCenterAchievements(detailId: string): Promise<GameCenterAchievementResource[]>;
  createGameCenterAchievement(
    detailId: string,
    attributes: {
      referenceName: string;
      vendorIdentifier: string;
      points: number;
      showBeforeEarned: boolean;
      repeatable: boolean;
    },
  ): Promise<{ id: string; versionId: string | null }>;
  createGameCenterAchievementLocalization(
    versionId: string,
    fields: { locale: string; name: string; beforeEarnedDescription: string; afterEarnedDescription: string },
  ): Promise<void>;
  listGameCenterLeaderboards(detailId: string): Promise<GameCenterLeaderboardResource[]>;
  createGameCenterLeaderboard(
    detailId: string,
    attributes: {
      referenceName: string;
      vendorIdentifier: string;
      defaultFormatter: LeaderboardFormatter;
      submissionType: LeaderboardSubmissionType;
      scoreSortType: LeaderboardSortType;
    },
  ): Promise<{ id: string; versionId: string | null }>;
  createGameCenterLeaderboardLocalization(versionId: string, fields: { locale: string; name: string }): Promise<void>;
}

/** Inputs to reconcile one app's Game Center config. */
export interface GameCenterReconcileInput {
  /** The app's iOS bundle id — resolves the ASC app record and its Game Center detail. */
  bundleId: string;
  config: GameCenterConfig;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** Where the detail stands after ensuring it: its id (and whether it pre-existed) or `null` when create failed. */
type EnsuredDetail = { detailId: string | null; existed: boolean } | null;

/**
 * Reconcile one app's Game Center achievements and leaderboards. Throws only for a precondition the user
 * must fix (no ASC app record); everything else is captured per-action so a single failure never aborts
 * the run.
 */
export async function reconcileGameCenter(
  api: AscGameCenterApi,
  input: GameCenterReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };
  const { config } = input;

  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw appRecordMissing(input.bundleId, "game-center");

  const detail = await ensureDetail(ctx, api, appId);
  if (!detail) {
    skip(ctx, "achievements / leaderboards: skipped — Game Center could not be enabled for the app");
    return { bundleId: input.bundleId, actions: ctx.actions };
  }

  await reconcileAchievements(ctx, api, detail, config.achievements ?? []);
  await reconcileLeaderboards(ctx, api, detail, config.leaderboards ?? []);
  return { bundleId: input.bundleId, actions: ctx.actions };
}

/** Read the app's Game Center detail, creating it (enabling Game Center) when absent. */
async function ensureDetail(ctx: ReconcileContext, api: AscGameCenterApi, appId: string): Promise<EnsuredDetail> {
  const existing = await api.getGameCenterDetail(appId);
  if (existing) return { detailId: existing.id, existed: true };

  const action = plan(ctx, "enable Game Center for the app");
  if (ctx.dryRun) return { detailId: null, existed: false };
  try {
    const created = await api.createGameCenterDetail(appId);
    action.status = "applied";
    return { detailId: created.id, existed: false };
  } catch (error) {
    action.status = "failed";
    action.error = errorMessage(error);
    return null;
  }
}

/** Create each declared achievement the detail doesn't have yet (by `vendorIdentifier`), with its localization. */
async function reconcileAchievements(
  ctx: ReconcileContext,
  api: AscGameCenterApi,
  detail: NonNullable<EnsuredDetail>,
  declared: AchievementConfig[],
): Promise<void> {
  const existing =
    detail.existed && detail.detailId
      ? new Set(
          (await api.listGameCenterAchievements(detail.detailId)).flatMap((a) =>
            a.vendorIdentifier ? [a.vendorIdentifier] : [],
          ),
        )
      : new Set<string>();

  for (const achievement of declared) {
    if (existing.has(achievement.vendorIdentifier)) continue;
    const locale = achievement.locale ?? DEFAULT_LOCALE;
    const create = plan(ctx, `create achievement ${achievement.vendorIdentifier} (${achievement.points} pts)`);
    const locAction = plan(ctx, `set achievement ${achievement.vendorIdentifier} localization (${locale})`);
    if (ctx.dryRun || !detail.detailId) continue;

    let versionId: string | null;
    try {
      const result = await api.createGameCenterAchievement(detail.detailId, {
        referenceName: achievement.referenceName,
        vendorIdentifier: achievement.vendorIdentifier,
        points: achievement.points,
        showBeforeEarned: achievement.showBeforeEarned ?? false,
        repeatable: achievement.repeatable ?? false,
      });
      create.status = "applied";
      versionId = result.versionId;
    } catch (error) {
      create.status = "failed";
      create.error = errorMessage(error);
      locAction.status = "skipped";
      continue;
    }
    await applyLocalization(locAction, versionId, achievement.vendorIdentifier, () =>
      api.createGameCenterAchievementLocalization(versionId ?? "", {
        locale,
        name: achievement.name,
        beforeEarnedDescription: achievement.beforeEarnedDescription,
        afterEarnedDescription: achievement.afterEarnedDescription,
      }),
    );
  }
}

/** Create each declared leaderboard the detail doesn't have yet (by `vendorIdentifier`), with its localization. */
async function reconcileLeaderboards(
  ctx: ReconcileContext,
  api: AscGameCenterApi,
  detail: NonNullable<EnsuredDetail>,
  declared: LeaderboardConfig[],
): Promise<void> {
  const existing =
    detail.existed && detail.detailId
      ? new Set(
          (await api.listGameCenterLeaderboards(detail.detailId)).flatMap((l) =>
            l.vendorIdentifier ? [l.vendorIdentifier] : [],
          ),
        )
      : new Set<string>();

  for (const leaderboard of declared) {
    if (existing.has(leaderboard.vendorIdentifier)) continue;
    const locale = leaderboard.locale ?? DEFAULT_LOCALE;
    const create = plan(ctx, `create leaderboard ${leaderboard.vendorIdentifier} (${leaderboard.defaultFormatter})`);
    const locAction = plan(ctx, `set leaderboard ${leaderboard.vendorIdentifier} localization (${locale})`);
    if (ctx.dryRun || !detail.detailId) continue;

    let versionId: string | null;
    try {
      const result = await api.createGameCenterLeaderboard(detail.detailId, {
        referenceName: leaderboard.referenceName,
        vendorIdentifier: leaderboard.vendorIdentifier,
        defaultFormatter: leaderboard.defaultFormatter,
        submissionType: leaderboard.submissionType,
        scoreSortType: leaderboard.scoreSortType,
      });
      create.status = "applied";
      versionId = result.versionId;
    } catch (error) {
      create.status = "failed";
      create.error = errorMessage(error);
      locAction.status = "skipped";
      continue;
    }
    await applyLocalization(locAction, versionId, leaderboard.vendorIdentifier, () =>
      api.createGameCenterLeaderboardLocalization(versionId ?? "", { locale, name: leaderboard.name }),
    );
  }
}

/**
 * Run a localization create against the version returned by the parent create. When Apple didn't echo a
 * version id, the parent still succeeded — so the localization is recorded as skipped (add it in App Store
 * Connect) rather than failed.
 */
async function applyLocalization(
  action: PlannedAction,
  versionId: string | null,
  vendorIdentifier: string,
  run: () => Promise<void>,
): Promise<void> {
  if (!versionId) {
    action.status = "skipped";
    action.description = `localization for ${vendorIdentifier}: created the item, but no version id was returned — add it in App Store Connect`;
    return;
  }
  try {
    await run();
    action.status = "applied";
  } catch (error) {
    action.status = "failed";
    action.error = errorMessage(error);
  }
}

/** Read a required non-empty string field, throwing a located error when missing or the wrong type. */
function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`gamecenter.config.json: ${where}.${key} must be a non-empty string.`);
  }
  return value;
}

/** Read an optional boolean field, throwing a located error when present but not a boolean. */
function optionalBoolean(record: Record<string, unknown>, key: string, where: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`gamecenter.config.json: ${where}.${key} must be a boolean.`);
  return value;
}

/** Parse one achievement entry, validating its required attributes and localization text. */
function parseAchievement(raw: unknown, index: number): AchievementConfig {
  const record = asRecord(raw);
  const where = `achievements[${index}]`;
  if (!record) throw new Error(`gamecenter.config.json: ${where} must be an object.`);
  const points = record["points"];
  if (typeof points !== "number" || !Number.isInteger(points) || points < 0) {
    throw new Error(`gamecenter.config.json: ${where}.points must be a non-negative integer.`);
  }
  const config: AchievementConfig = {
    vendorIdentifier: requireString(record, "vendorIdentifier", where),
    referenceName: requireString(record, "referenceName", where),
    points,
    name: requireString(record, "name", where),
    beforeEarnedDescription: requireString(record, "beforeEarnedDescription", where),
    afterEarnedDescription: requireString(record, "afterEarnedDescription", where),
  };
  const showBeforeEarned = optionalBoolean(record, "showBeforeEarned", where);
  if (showBeforeEarned !== undefined) config.showBeforeEarned = showBeforeEarned;
  const repeatable = optionalBoolean(record, "repeatable", where);
  if (repeatable !== undefined) config.repeatable = repeatable;
  if (typeof record["locale"] === "string") config.locale = record["locale"];
  return config;
}

/** Type guard: is the string one of Apple's leaderboard formatters? */
function isFormatter(value: string): value is LeaderboardFormatter {
  return (LEADERBOARD_FORMATTERS as readonly string[]).includes(value);
}

/** Type guard: is the string a valid leaderboard submission type? */
function isSubmissionType(value: string): value is LeaderboardSubmissionType {
  return (SUBMISSION_TYPES as readonly string[]).includes(value);
}

/** Type guard: is the string a valid leaderboard score sort type? */
function isSortType(value: string): value is LeaderboardSortType {
  return (SORT_TYPES as readonly string[]).includes(value);
}

/** Parse one leaderboard entry, validating its formatter / submission / sort enums and localization name. */
function parseLeaderboard(raw: unknown, index: number): LeaderboardConfig {
  const record = asRecord(raw);
  const where = `leaderboards[${index}]`;
  if (!record) throw new Error(`gamecenter.config.json: ${where} must be an object.`);

  const defaultFormatter = requireString(record, "defaultFormatter", where);
  if (!isFormatter(defaultFormatter)) {
    throw new Error(
      `gamecenter.config.json: ${where}.defaultFormatter must be one of ${LEADERBOARD_FORMATTERS.join(", ")}.`,
    );
  }
  const submissionType = requireString(record, "submissionType", where);
  if (!isSubmissionType(submissionType)) {
    throw new Error(`gamecenter.config.json: ${where}.submissionType must be BEST_SCORE or MOST_RECENT_SCORE.`);
  }
  const scoreSortType = requireString(record, "scoreSortType", where);
  if (!isSortType(scoreSortType)) {
    throw new Error(`gamecenter.config.json: ${where}.scoreSortType must be ASC or DESC.`);
  }
  const config: LeaderboardConfig = {
    vendorIdentifier: requireString(record, "vendorIdentifier", where),
    referenceName: requireString(record, "referenceName", where),
    defaultFormatter,
    submissionType,
    scoreSortType,
    name: requireString(record, "name", where),
  };
  if (typeof record["locale"] === "string") config.locale = record["locale"];
  return config;
}

/** Parse one list ("achievements" / "leaderboards") via `parse`, or undefined when absent. */
function parseList<T>(raw: unknown, key: string, parse: (entry: unknown, index: number) => T): T[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error(`gamecenter.config.json: ${key} must be an array.`);
  return raw.map(parse);
}

/**
 * Parse and validate a raw `gamecenter.config.json` value into a typed {@link GameCenterConfig}. Rejects a
 * non-object document and a file declaring neither achievements nor leaderboards, so a bad file fails
 * loudly instead of silently reconciling nothing.
 */
export function parseGameCenterConfig(raw: unknown): GameCenterConfig {
  const record = asRecord(raw);
  if (!record) throw new Error("gamecenter.config.json must be a JSON object.");

  const config: GameCenterConfig = {};
  const achievements = parseList(record["achievements"], "achievements", parseAchievement);
  if (achievements) config.achievements = achievements;
  const leaderboards = parseList(record["leaderboards"], "leaderboards", parseLeaderboard);
  if (leaderboards) config.leaderboards = leaderboards;

  if ((config.achievements?.length ?? 0) === 0 && (config.leaderboards?.length ?? 0) === 0) {
    throw new Error('gamecenter.config.json must declare at least one entry under "achievements" or "leaderboards".');
  }
  return config;
}

/** Read and parse a `gamecenter.config.json` from disk. */
export function loadGameCenterConfig(path: string): GameCenterConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No Game Center config at ${path}. Create one (see \`launch game-center --help\`) or pass --config.`,
    );
  }
  return parseGameCenterConfig(JSON.parse(readFileSync(path, "utf8")));
}
