/**
 * Reconcile an app's App Store *release attributes* — age rating, App Store categories, the base price,
 * and the App Review (demo account + contact) details — from a declarative `release.config.json` to
 * match App Store Connect. These are the non-text version-page fields you'd otherwise click through by
 * hand before submitting; getting them wrong is a frequent rejection / duplicate-submission source, and
 * EAS automates none of them.
 *
 * Design mirrors {@link reconcileApp `core/ascSync.ts`}: a read-only PLAN pass builds the
 * {@link PlannedAction}s (idempotent — each sub-area re-reads live state and proposes a change only when
 * it actually differs), the command prints them, then an APPLY pass performs them, each action isolated
 * so one failing sub-area never aborts the rest. Each sub-area is independent: declaring only `pricing`
 * touches only pricing. The reconcile-action vocabulary (PlannedAction / ActionStatus / ReconcileReport)
 * is reused from `ascSync.ts` so plans render identically to `launch sync`, and the {@link act} / {@link skip}
 * reconcile primitives come from the shared `core/asc/storeSync.ts` vocabulary.
 *
 * This is a standalone command rather than a `launch sync` subcommand on purpose: the `launch sync`
 * orchestrator is owned by a parallel in-flight change, and these app-level attributes are a distinct
 * concern from the product catalog it reconciles.
 */

import { existsSync, readFileSync } from "node:fs";
import type {
  AgeRatingDeclarationResource,
  AgeRatingValue,
  AppInfoResource,
  AppStoreReviewDetailResource,
  PricePointResource,
} from "../apple/ascClient.js";
import { act, appRecordMissing, skip, type ReconcileContext } from "./asc/storeSync.js";
import type { ReconcileReport } from "./ascSync.js";
import { asRecord } from "./json.js";
import { resolveSecretRef } from "./secretRef.js";
import type { ReleaseAttributesConfig, ReleaseCategories, ReleasePricing, ReviewDetailsConfig } from "./types.js";

/** Default platform whose editable version owns the App Review details. */
const DEFAULT_PLATFORM = "IOS";
/** Default base territory for price-point resolution when the config doesn't name one. */
const DEFAULT_TERRITORY = "USA";
/** Demo-account password is write-only on Apple's side; it's diffed and rendered by name only, never value. */
const DEMO_PASSWORD_KEY = "demoAccountPassword";

/**
 * The exact slice of {@link AppStoreConnectClient} the release reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally.
 */
export interface AscReleaseApi {
  getAppId(bundleId: string): Promise<string | null>;
  getAppInfo(appId: string): Promise<AppInfoResource | null>;
  updateAppInfoCategories(
    appInfoId: string,
    categories: { primaryCategoryId?: string; secondaryCategoryId?: string },
  ): Promise<void>;
  getAgeRatingDeclaration(appInfoId: string): Promise<AgeRatingDeclarationResource | null>;
  updateAgeRatingDeclaration(declarationId: string, attributes: Record<string, AgeRatingValue>): Promise<void>;
  findAppPricePoint(appId: string, territory: string, customerPrice: number): Promise<PricePointResource | null>;
  getCurrentAppPrice(appId: string, territory: string): Promise<string | null>;
  createAppPriceSchedule(appId: string, baseTerritory: string, pricePointId: string): Promise<void>;
  findEditableAppStoreVersion(appId: string, platform: string): Promise<{ id: string } | null>;
  getAppStoreReviewDetail(versionId: string): Promise<AppStoreReviewDetailResource | null>;
  createAppStoreReviewDetail(versionId: string, attributes: Record<string, string | boolean>): Promise<{ id: string }>;
  updateAppStoreReviewDetail(detailId: string, attributes: Record<string, string | boolean>): Promise<void>;
}

/** Inputs to reconcile one app's release attributes. */
export interface ReleaseReconcileInput {
  /** The app's iOS bundle id — resolves the ASC app record. */
  bundleId: string;
  /** The declared release attributes. */
  config: ReleaseAttributesConfig;
  /** Platform whose editable version owns the review details (default `IOS`). */
  platform?: string;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/**
 * Reconcile one app's declared release attributes. Throws only for a precondition the user must fix (no
 * ASC app record); everything else is captured per-action so a single failure never aborts the run.
 */
export async function reconcileRelease(api: AscReleaseApi, input: ReleaseReconcileInput): Promise<ReconcileReport> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };
  const { config } = input;

  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw appRecordMissing(input.bundleId, "release-config");

  if (config.categories || (config.ageRating && Object.keys(config.ageRating).length > 0)) {
    const appInfo = await api.getAppInfo(appId);
    if (!appInfo) {
      skip(ctx, "categories / age rating: no App Info record on the app yet");
    } else {
      await reconcileCategories(ctx, api, appInfo, config.categories);
      await reconcileAgeRating(ctx, api, appInfo, config.ageRating);
    }
  }

  if (config.pricing) await reconcilePricing(ctx, api, appId, config.pricing);
  if (config.reviewDetails) {
    await reconcileReviewDetails(ctx, api, appId, input.platform ?? DEFAULT_PLATFORM, config.reviewDetails);
  }

  return { bundleId: input.bundleId, actions: ctx.actions };
}

/** Set primary/secondary categories that differ from what's live (no action when already in sync). */
async function reconcileCategories(
  ctx: ReconcileContext,
  api: AscReleaseApi,
  appInfo: AppInfoResource,
  categories: ReleaseCategories | undefined,
): Promise<void> {
  if (!categories) return;
  const change: { primaryCategoryId?: string; secondaryCategoryId?: string } = {};
  if (categories.primary && categories.primary !== appInfo.primaryCategoryId)
    change.primaryCategoryId = categories.primary;
  if (categories.secondary && categories.secondary !== appInfo.secondaryCategoryId) {
    change.secondaryCategoryId = categories.secondary;
  }
  if (Object.keys(change).length === 0) return;

  const parts = [
    change.primaryCategoryId ? `primary=${change.primaryCategoryId}` : undefined,
    change.secondaryCategoryId ? `secondary=${change.secondaryCategoryId}` : undefined,
  ].filter(Boolean);
  await act(ctx, `set categories (${parts.join(", ")})`, () => api.updateAppInfoCategories(appInfo.id, change));
}

/** PATCH the age-rating answers that differ from the live declaration (no action when already in sync). */
async function reconcileAgeRating(
  ctx: ReconcileContext,
  api: AscReleaseApi,
  appInfo: AppInfoResource,
  answers: Record<string, AgeRatingValue> | undefined,
): Promise<void> {
  if (!answers || Object.keys(answers).length === 0) return;
  const current = await api.getAgeRatingDeclaration(appInfo.id);
  if (!current) {
    skip(ctx, "age rating: no declaration on the app yet (create the version, then re-run)");
    return;
  }
  const changed: Record<string, AgeRatingValue> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (current.attributes[key] !== value) changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  await act(ctx, `set age rating (${Object.keys(changed).join(", ")})`, () =>
    api.updateAgeRatingDeclaration(current.id, changed),
  );
}

/** Set the app's base price when it differs from what's live (resolves the matching price-ladder rung). */
async function reconcilePricing(
  ctx: ReconcileContext,
  api: AscReleaseApi,
  appId: string,
  pricing: ReleasePricing,
): Promise<void> {
  const territory = pricing.baseTerritory ?? DEFAULT_TERRITORY;
  const current = await api.getCurrentAppPrice(appId, territory);
  if (current !== null && Number.parseFloat(current) === pricing.customerPrice) return;

  await act(ctx, `set app price = ${pricing.customerPrice} (${territory})`, async () => {
    const point = await api.findAppPricePoint(appId, territory, pricing.customerPrice);
    if (!point) throw new Error(`No ${territory} app price point matches ${pricing.customerPrice}.`);
    await api.createAppPriceSchedule(appId, territory, point.id);
  });
}

/**
 * Create or update the editable version's App Review details. The diff ignores `demoAccountPassword`
 * (Apple never returns it on a read), so a change to the password *alone* can't be detected — change any
 * other field, or remove the detail in App Store Connect, to force it. The password is included in the
 * write when present, and only ever rendered by field name, never by value.
 */
async function reconcileReviewDetails(
  ctx: ReconcileContext,
  api: AscReleaseApi,
  appId: string,
  platform: string,
  details: ReviewDetailsConfig,
): Promise<void> {
  const desired = reviewAttributes(details);
  if (Object.keys(desired).length === 0) return;

  const version = await api.findEditableAppStoreVersion(appId, platform);
  if (!version) {
    skip(ctx, "App Review details: no editable App Store version (create/select a version first)");
    return;
  }

  const current = await api.getAppStoreReviewDetail(version.id);
  if (!current) {
    await act(ctx, `set App Review details (${renderFields(desired)})`, async () => {
      await api.createAppStoreReviewDetail(version.id, await resolveReviewWrite(desired));
    });
    return;
  }

  const changed: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (key === DEMO_PASSWORD_KEY) continue;
    if (current.attributes[key] !== value) changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  if (desired[DEMO_PASSWORD_KEY] !== undefined) changed[DEMO_PASSWORD_KEY] = desired[DEMO_PASSWORD_KEY];
  await act(ctx, `update App Review details (${renderFields(changed)})`, async () =>
    api.updateAppStoreReviewDetail(current.id, await resolveReviewWrite(changed)),
  );
}

/**
 * Resolve a `demoAccountPassword` reference (`env:` / `keychain:`) to its real value at the moment of the
 * write, so the secret reaches Apple but never sits in the repo-committed config — a plain string still
 * works unchanged. Returns a copy; the original attribute map (used only for name-only plan rendering and
 * the readable-field diff) is left untouched, so the plan never reads or holds the secret.
 */
async function resolveReviewWrite(
  attributes: Record<string, string | boolean>,
): Promise<Record<string, string | boolean>> {
  const password = attributes[DEMO_PASSWORD_KEY];
  if (typeof password !== "string") return attributes;
  return { ...attributes, [DEMO_PASSWORD_KEY]: await resolveSecretRef(password, DEMO_PASSWORD_KEY) };
}

/** Collapse the review config to Apple's attribute map, dropping unset fields (names match Apple's). */
function reviewAttributes(details: ReviewDetailsConfig): Record<string, string | boolean> {
  const attributes: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(details)) {
    // The typeof guard both drops unset fields and narrows `Object.entries`'s widened value to a scalar.
    if (typeof value === "string" || typeof value === "boolean") attributes[key] = value;
  }
  return attributes;
}

/** Render an attribute map as a comma-joined field-name list for the plan — names only, never values. */
function renderFields(attributes: Record<string, string | boolean>): string {
  return Object.keys(attributes).join(", ");
}

/** Parse the `categories` section, keeping only string primary/secondary ids that are present. */
function parseCategories(raw: Record<string, unknown>): ReleaseCategories {
  const categories: ReleaseCategories = {};
  if (typeof raw["primary"] === "string") categories.primary = raw["primary"];
  if (typeof raw["secondary"] === "string") categories.secondary = raw["secondary"];
  return categories;
}

/** Parse the `pricing` section, requiring a non-negative numeric `customerPrice`. */
function parsePricing(raw: Record<string, unknown>): ReleasePricing {
  const customerPrice = raw["customerPrice"];
  if (typeof customerPrice !== "number" || !Number.isFinite(customerPrice) || customerPrice < 0) {
    throw new Error("release.config.json: pricing.customerPrice must be a non-negative number.");
  }
  const pricing: ReleasePricing = { customerPrice };
  if (typeof raw["baseTerritory"] === "string") pricing.baseTerritory = raw["baseTerritory"];
  return pricing;
}

/** Parse the `ageRating` section, accepting only string-enum or boolean answers. */
function parseAgeRating(raw: Record<string, unknown>): Record<string, AgeRatingValue> {
  const answers: Record<string, AgeRatingValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "boolean") answers[key] = value;
    else throw new Error(`release.config.json: ageRating.${key} must be a string or boolean (got ${typeof value}).`);
  }
  return answers;
}

/** Parse the `reviewDetails` section, keeping the known string fields plus the boolean `demoAccountRequired`. */
function parseReviewDetails(raw: Record<string, unknown>): ReviewDetailsConfig {
  const details: ReviewDetailsConfig = {};
  // `as const` keeps these to exactly the string-typed fields, so the indexed write below stays a string.
  const stringFields = [
    "contactFirstName",
    "contactLastName",
    "contactPhone",
    "contactEmail",
    "demoAccountName",
    "demoAccountPassword",
    "notes",
  ] as const;
  for (const field of stringFields) {
    const value = raw[field];
    if (typeof value === "string") details[field] = value;
  }
  if (typeof raw["demoAccountRequired"] === "boolean") details.demoAccountRequired = raw["demoAccountRequired"];
  return details;
}

/**
 * Parse and validate a raw `release.config.json` value into a typed {@link ReleaseAttributesConfig}. Rejects a
 * non-object document, an empty document (no recognized section), and malformed values, so a bad file
 * fails loudly instead of silently reconciling nothing.
 */
export function parseReleaseConfig(raw: unknown): ReleaseAttributesConfig {
  const record = asRecord(raw);
  if (!record) throw new Error("release.config.json must be a JSON object.");

  const config: ReleaseAttributesConfig = {};
  const ageRating = asRecord(record["ageRating"]);
  if (ageRating) config.ageRating = parseAgeRating(ageRating);
  const categories = asRecord(record["categories"]);
  if (categories) config.categories = parseCategories(categories);
  const pricing = asRecord(record["pricing"]);
  if (pricing) config.pricing = parsePricing(pricing);
  const reviewDetails = asRecord(record["reviewDetails"]);
  if (reviewDetails) config.reviewDetails = parseReviewDetails(reviewDetails);

  if (!config.ageRating && !config.categories && !config.pricing && !config.reviewDetails) {
    throw new Error(
      "release.config.json has no recognized section — declare at least one of " +
        "ageRating / categories / pricing / reviewDetails.",
    );
  }
  return config;
}

/** Read and parse a `release.config.json` from disk. */
export function loadReleaseConfig(path: string): ReleaseAttributesConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No release config at ${path}. Create one (see \`launch release-config --help\`) or pass --config.`,
    );
  }
  return parseReleaseConfig(JSON.parse(readFileSync(path, "utf8")));
}
