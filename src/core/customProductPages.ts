/**
 * Reconcile an app's **custom product pages** — alternate App Store listings used for marketing campaigns
 * and deep links — from a declarative `custom-pages.config.json`, using the App Store Connect API key
 * alone. Standing up these variants is click-heavy App Store Connect work that EAS doesn't touch.
 *
 * Per app, for each declared page (matched by its `name`):
 * 1. **Create** the page when it's missing — Apple seeds it with an editable version cloned from the
 *    default listing.
 * 2. Reconcile its **promotional text** per locale on the editable version: create the locale's
 *    localization, or update it when the text differs.
 *
 * Mirrors {@link reconcileGameCenter `core/gameCenter.ts`}: a read-only PLAN pass builds idempotent
 * {@link PlannedAction}s, the command prints them, then an APPLY pass performs them, each action isolated.
 * Additive on pages (a page not in config is left untouched) and never deletes. Screenshots, app previews,
 * page visibility, and publishing a version live are out of scope (a deliberate follow-up).
 */

import { existsSync, readFileSync } from "node:fs";
import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from "../apple/ascClient.js";
import type { PlannedAction } from "./ascSync.js";

/** Custom-product-page version states Apple still lets us edit localizations in. */
const EDITABLE_VERSION_STATES = new Set(["PREPARE_FOR_SUBMISSION", "REJECTED"]);

/** One declared custom product page: a name plus optional per-locale promotional text. */
export interface CustomProductPageConfig {
  /** The page name (Apple's match key; shown in App Store Connect). */
  name: string;
  /** Locale → promotional text to set on the page's editable version. */
  promotionalText?: Record<string, string>;
}

/** The full `custom-pages.config.json` document. */
export interface CustomProductPagesConfig {
  /** One entry per custom product page; at least one required. */
  pages: CustomProductPageConfig[];
}

/**
 * The exact slice of {@link AppStoreConnectClient} the custom-pages reconciler depends on, declared here so
 * the diff logic is unit-testable with a hand-rolled fake (mirrors {@link AscGameCenterApi}).
 */
export interface AscCustomPagesApi {
  getAppId(bundleId: string): Promise<string | null>;
  listCustomProductPages(appId: string): Promise<CustomProductPageResource[]>;
  createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource>;
  listCustomProductPageVersions(pageId: string): Promise<CustomProductPageVersionResource[]>;
  listCustomProductPageLocalizations(versionId: string): Promise<CustomProductPageLocalizationResource[]>;
  createCustomProductPageLocalization(versionId: string, locale: string, promotionalText: string): Promise<void>;
  updateCustomProductPageLocalization(localizationId: string, promotionalText: string): Promise<void>;
}

/** Inputs to reconcile one app's custom product pages. */
export interface CustomPagesReconcileInput {
  bundleId: string;
  config: CustomProductPagesConfig;
  dryRun: boolean;
}

/** Mutable per-run context threaded through the reconcile walk (mirrors `core/gameCenter.ts`). */
interface ReconcileContext {
  actions: PlannedAction[];
  dryRun: boolean;
}

/** Push a planned action and return its handle, so the caller can mark it applied/failed after running. */
function plan(ctx: ReconcileContext, description: string): PlannedAction {
  const action: PlannedAction = { description, destructive: false, status: "planned" };
  ctx.actions.push(action);
  return action;
}

/** Record a sub-area we can't act on (e.g. a page that couldn't be created) as a skip with a reason. */
function skip(ctx: ReconcileContext, description: string): void {
  ctx.actions.push({ description, destructive: false, status: "skipped" });
}

/** A short message for a thrown value (these paths carry no secrets). */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The actionable error when an app has no App Store Connect record (Apple has no API to create one). */
function appRecordMissing(bundleId: string): Error {
  return new Error(
    `No App Store Connect app record for ${bundleId}. Create the app once in App Store Connect ` +
      `(Apple has no API to create the app record), then re-run \`launch custom-pages\`.`,
  );
}

/**
 * Reconcile one app's custom product pages. Throws only for a precondition the user must fix (no App
 * Store Connect app record); per-action failures are captured so one never aborts the rest.
 */
export async function reconcileCustomProductPages(
  api: AscCustomPagesApi,
  input: CustomPagesReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };

  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw appRecordMissing(input.bundleId);

  const existing = new Map((await api.listCustomProductPages(appId)).map((page) => [page.name, page]));
  for (const page of input.config.pages) {
    const pageId = await ensurePage(ctx, api, appId, page.name, existing.get(page.name));
    await reconcilePromoText(ctx, api, page, pageId);
  }
  return { bundleId: input.bundleId, actions: ctx.actions };
}

/** Read the page by name, creating it when absent. Returns its id, or null when create failed / was rehearsed. */
async function ensurePage(
  ctx: ReconcileContext,
  api: AscCustomPagesApi,
  appId: string,
  name: string,
  existing: CustomProductPageResource | undefined,
): Promise<string | null> {
  if (existing) return existing.id;

  const action = plan(ctx, `create custom product page "${name}"`);
  if (ctx.dryRun) return null;
  try {
    const created = await api.createCustomProductPage(appId, name);
    action.status = "applied";
    return created.id;
  } catch (error) {
    action.status = "failed";
    action.error = errorMessage(error);
    return null;
  }
}

/** Reconcile a page's promotional text per declared locale on its editable version. */
async function reconcilePromoText(
  ctx: ReconcileContext,
  api: AscCustomPagesApi,
  page: CustomProductPageConfig,
  pageId: string | null,
): Promise<void> {
  const locales = Object.entries(page.promotionalText ?? {});
  if (locales.length === 0) return;

  // No page id: either rehearsing a not-yet-created page (plan the sets) or its create failed (skip them).
  if (!pageId) {
    for (const [locale] of locales) {
      if (ctx.dryRun) plan(ctx, `set promotional text on "${page.name}" (${locale})`);
      else skip(ctx, `promotional text on "${page.name}" (${locale}): skipped — page create failed`);
    }
    return;
  }

  const version = (await api.listCustomProductPageVersions(pageId)).find((entry) =>
    EDITABLE_VERSION_STATES.has(entry.state),
  );
  if (!version) {
    skip(ctx, `promotional text on "${page.name}": skipped — no editable version`);
    return;
  }

  const current = new Map(
    (await api.listCustomProductPageLocalizations(version.id)).map((localization) => [
      localization.locale,
      localization,
    ]),
  );
  for (const [locale, text] of locales) {
    const existing = current.get(locale);
    if (existing && (existing.promotionalText ?? "") === text) continue; // already in sync

    const action = plan(
      ctx,
      existing
        ? `update promotional text on "${page.name}" (${locale})`
        : `set promotional text on "${page.name}" (${locale})`,
    );
    if (ctx.dryRun) continue;
    try {
      if (existing) await api.updateCustomProductPageLocalization(existing.id, text);
      else await api.createCustomProductPageLocalization(version.id, locale, text);
      action.status = "applied";
    } catch (error) {
      action.status = "failed";
      action.error = errorMessage(error);
    }
  }
}

/** Narrow an unknown value to a plain object, or null. Arrays are rejected so a malformed section fails loudly. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse one page entry, validating its name and any promotional-text strings. */
function parsePage(raw: unknown, index: number): CustomProductPageConfig {
  const record = asRecord(raw);
  const where = `pages[${index}]`;
  if (!record) throw new Error(`custom-pages.config.json: ${where} must be an object.`);

  const name = record["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`custom-pages.config.json: ${where}.name must be a non-empty string.`);
  }

  const config: CustomProductPageConfig = { name };
  if (record["promotionalText"] !== undefined) {
    const promo = asRecord(record["promotionalText"]);
    if (!promo) throw new Error(`custom-pages.config.json: ${where}.promotionalText must be a locale → text object.`);
    const text: Record<string, string> = {};
    for (const [locale, value] of Object.entries(promo)) {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`custom-pages.config.json: ${where}.promotionalText["${locale}"] must be a non-empty string.`);
      }
      text[locale] = value;
    }
    if (Object.keys(text).length > 0) config.promotionalText = text;
  }
  return config;
}

/**
 * Parse and validate a raw `custom-pages.config.json` value into a typed {@link CustomProductPagesConfig}.
 * Rejects a non-object document, a missing/empty `pages` list, and a duplicate page name so a bad file
 * fails loudly instead of racing itself.
 */
export function parseCustomProductPagesConfig(raw: unknown): CustomProductPagesConfig {
  const record = asRecord(raw);
  if (!record) throw new Error("custom-pages.config.json must be a JSON object.");

  const rawPages = record["pages"];
  if (!Array.isArray(rawPages)) throw new Error('custom-pages.config.json: "pages" must be an array.');
  if (rawPages.length === 0) {
    throw new Error('custom-pages.config.json must declare at least one entry under "pages".');
  }
  const pages = rawPages.map(parsePage);

  const seen = new Set<string>();
  for (const page of pages) {
    if (seen.has(page.name)) throw new Error(`custom-pages.config.json: duplicate page name "${page.name}".`);
    seen.add(page.name);
  }
  return { pages };
}

/** Read and parse a `custom-pages.config.json` from disk. */
export function loadCustomProductPagesConfig(path: string): CustomProductPagesConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No custom-pages config at ${path}. Create one (see \`launch custom-pages --help\`) or pass --config.`,
    );
  }
  return parseCustomProductPagesConfig(JSON.parse(readFileSync(path, "utf8")));
}

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export function summarizeCustomPages(actions: PlannedAction[]): { applied: number; failed: number; skipped: number } {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === "applied") applied++;
    else if (action.status === "failed") failed++;
    else if (action.status === "skipped") skipped++;
  }
  return { applied, failed, skipped };
}
