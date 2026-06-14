/**
 * The asset half of `launch sync`: upload App Store **screenshots** (per locale × device target) and
 * **subscription review screenshots** to App Store Connect, idempotently. It's the deliberate follow-up
 * the catalog reconciler (`ascSync.ts`) flagged — products clear "Missing Metadata", but a screenshot is
 * a chunked binary upload, so it lives in its own pass.
 *
 * Why a sibling module (not part of `reconcileApp`): binary asset upload is a separate concern from the
 * catalog/text reconcile, and keeping it out of `AscCatalogApi` keeps that interface (and its large test
 * fake) untouched. The two passes share only the plan primitives — {@link act}, {@link ActionLog},
 * {@link PlannedAction} — imported one-directionally from `ascSync.ts`, so there's no import cycle.
 *
 * Design (mirrors `ascSync.ts`):
 * - **Declarative & stateless.** Reality is re-read each run (sets, existing screenshots, subscriptions);
 *   the local `screenshots/` tree is the source of truth.
 * - **Additive & idempotent.** A local file whose MD5 already appears on Apple (`sourceFileChecksum`) is
 *   skipped. New files are uploaded; existing ones are never deleted or reordered here (that would be a
 *   destructive follow-up), so a re-run after no change uploads nothing.
 * - **Plan, then apply.** Same `dryRun` walk as the catalog pass; each upload is isolated via {@link act}
 *   so one bad file never aborts the rest.
 *
 * Display-type resolution honors Apple's lagging enum: the target is whatever the user's folder is named
 * (see `screenshotAssets.ts`), never gated against a hardcoded list — an unknown constant is attempted and,
 * if Apple rejects it, captured as a single failed action rather than aborting the locale.
 */

import type {
  ReviewScreenshotResource,
  ScreenshotResource,
  ScreenshotSetResource,
  SubscriptionGroupResource,
  SubscriptionResource,
  ListingLocalization,
} from "../apple/ascClient.js";
import { act, DRY_RUN_ID, succeededOrPlanned, type ActionLog, type PlannedAction } from "./ascSync.js";
import {
  displayTypeLabel,
  MAX_SCREENSHOTS_PER_SET,
  type LocalAsset,
  type LocalScreenshot,
} from "./screenshotAssets.js";

/**
 * The slice of {@link AppStoreConnectClient} the screenshot reconciler depends on. Declared here (rather
 * than taking the concrete client) so the reconcile logic is unit-testable against a hand-rolled fake.
 * `AppStoreConnectClient` satisfies it structurally. The high-level `upload*` methods hide the
 * reserve→PUT→commit asset flow so this module never deals with upload operations or checksums directly.
 */
export interface ScreenshotsApi {
  getAppId(bundleId: string): Promise<string | null>;
  getEditableVersionId(appId: string): Promise<string | null>;
  /** Reused from the listing reconciler to map each declared locale to its version-localization id. */
  listVersionLocalizations(versionId: string): Promise<ListingLocalization[]>;
  listScreenshotSets(versionLocalizationId: string): Promise<ScreenshotSetResource[]>;
  createScreenshotSet(versionLocalizationId: string, displayType: string): Promise<ScreenshotSetResource>;
  listScreenshots(setId: string): Promise<ScreenshotResource[]>;
  uploadScreenshot(setId: string, fileName: string, filePath: string): Promise<void>;
  listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]>;
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]>;
  getSubscriptionReviewScreenshot(subscriptionId: string): Promise<ReviewScreenshotResource | null>;
  uploadSubscriptionReviewScreenshot(subscriptionId: string, fileName: string, filePath: string): Promise<void>;
}

/** One subscription's declared review screenshot, paired with its product id for live subscription resolution. */
export interface SubscriptionReviewScreenshot {
  /** Apple product id of the subscription the screenshot belongs to — matched against the live catalog. */
  productId: string;
  /** The fingerprinted local image (already resolved + MD5'd by the command). */
  asset: LocalAsset;
}

/** Inputs to the screenshot reconcile pass for one app. */
export interface ScreenshotReconcileInput {
  /** The app's iOS bundle id — resolves the ASC app record. */
  bundleId: string;
  /** App Store screenshots discovered from `<appDir>/screenshots/<locale>/<displayType>/`. */
  screenshots: LocalScreenshot[];
  /** Subscription review screenshots declared via `SubscriptionConfig.reviewScreenshot`. */
  subscriptionReviewScreenshots: SubscriptionReviewScreenshot[];
  /** Rehearse only: build the plan, perform no uploads. */
  dryRun: boolean;
  /** Permit destructive actions. None exist yet (upload is additive); accepted for parity with the catalog pass. */
  allowDestructive: boolean;
}

/** Group a list by a derived key, preserving first-seen order of both keys and members. */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const bucket = groups.get(key(item));
    if (bucket) bucket.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/** A skipped action with guidance — the plan still shows the work that couldn't run and why. */
function skip(log: ActionLog, description: string): void {
  log.actions.push({ description, destructive: false, status: "skipped" });
}

/**
 * Reconcile one app's App Store assets. Resolves the ASC app record once, then runs the screenshot and
 * subscription-review-screenshot passes; returns the actions planned/performed (the command merges them
 * into the app's overall sync report). Never throws for a per-asset failure — those are captured on their
 * action by {@link act}.
 */
export async function reconcileScreenshots(
  api: ScreenshotsApi,
  input: ScreenshotReconcileInput,
): Promise<PlannedAction[]> {
  const log: ActionLog = { actions: [], dryRun: input.dryRun, allowDestructive: input.allowDestructive };
  if (input.screenshots.length === 0 && input.subscriptionReviewScreenshots.length === 0) return log.actions;

  const appId = await api.getAppId(input.bundleId);
  if (!appId) {
    skip(log, `screenshots: no App Store Connect app record for ${input.bundleId} — create the app, then re-run`);
    return log.actions;
  }

  if (input.screenshots.length > 0) await reconcileAppScreenshots(api, log, appId, input.screenshots);
  if (input.subscriptionReviewScreenshots.length > 0) {
    await reconcileSubscriptionReviewScreenshots(api, log, appId, input.subscriptionReviewScreenshots);
  }
  return log.actions;
}

/** Upload screenshots into the editable App Store version, per locale → display-type set. */
async function reconcileAppScreenshots(
  api: ScreenshotsApi,
  log: ActionLog,
  appId: string,
  screenshots: LocalScreenshot[],
): Promise<void> {
  const versionId = await api.getEditableVersionId(appId);
  if (!versionId) {
    skip(log, "screenshots: no editable App Store version — prepare a version in App Store Connect, then re-run");
    return;
  }

  const localizations = await api.listVersionLocalizations(versionId);
  const localizationIdByLocale = new Map(localizations.map((localization) => [localization.locale, localization.id]));

  for (const [locale, localeShots] of groupBy(screenshots, (shot) => shot.locale)) {
    const localizationId = localizationIdByLocale.get(locale);
    if (!localizationId) {
      skip(
        log,
        `screenshots [${locale}]: locale not on the editable version — sync the listing for ${locale} first ` +
          `(${localeShots.length} screenshot(s) waiting)`,
      );
      continue;
    }

    const setByType = new Map(
      (await api.listScreenshotSets(localizationId)).map((set) => [set.screenshotDisplayType, set]),
    );
    for (const [displayType, typeShots] of groupBy(localeShots, (shot) => shot.displayType)) {
      await reconcileScreenshotSet(
        api,
        log,
        localizationId,
        setByType.get(displayType),
        displayType,
        locale,
        typeShots,
      );
    }
  }
}

/** Resolve (or create) one display-type set, then upload the local screenshots Apple doesn't already have. */
async function reconcileScreenshotSet(
  api: ScreenshotsApi,
  log: ActionLog,
  localizationId: string,
  existingSet: ScreenshotSetResource | undefined,
  displayType: string,
  locale: string,
  shots: LocalScreenshot[],
): Promise<void> {
  const label = displayTypeLabel(displayType);

  let setId: string;
  let existing: ScreenshotResource[];
  if (existingSet) {
    setId = existingSet.id;
    existing = await api.listScreenshots(setId);
  } else {
    const created = await act(log, `create screenshot set ${label} [${locale}]`, false, () =>
      api.createScreenshotSet(localizationId, displayType),
    );
    if (!succeededOrPlanned(created.status)) return;
    setId = created.value?.id ?? DRY_RUN_ID;
    existing = [];
  }

  // A FAILED delivery never finished, so don't treat its checksum as "already uploaded" — let it re-send.
  const uploadedChecksums = new Set(
    existing
      .filter((shot) => shot.assetDeliveryState !== "FAILED")
      .map((shot) => shot.sourceFileChecksum)
      .filter((sum): sum is string => !!sum),
  );
  let count = existing.length;
  for (const shot of shots) {
    if (uploadedChecksums.has(shot.checksum)) continue; // already on Apple, byte-for-byte
    if (count >= MAX_SCREENSHOTS_PER_SET) {
      skip(
        log,
        `screenshot ${label} [${locale}] ${shot.fileName}: set is full (${MAX_SCREENSHOTS_PER_SET} max) — skipped`,
      );
      continue;
    }
    await act(log, `upload screenshot ${label} [${locale}] ${shot.fileName}`, false, () =>
      api.uploadScreenshot(setId, shot.fileName, shot.path),
    );
    count++;
  }
}

/** Upload each declared subscription's review screenshot, resolving the subscription live by product id. */
async function reconcileSubscriptionReviewScreenshots(
  api: ScreenshotsApi,
  log: ActionLog,
  appId: string,
  items: SubscriptionReviewScreenshot[],
): Promise<void> {
  const subscriptionIdByProduct = new Map<string, string>();
  for (const group of await api.listSubscriptionGroups(appId)) {
    for (const subscription of await api.listSubscriptions(group.id)) {
      subscriptionIdByProduct.set(subscription.productId, subscription.id);
    }
  }

  for (const item of items) {
    const subscriptionId = subscriptionIdByProduct.get(item.productId);
    if (!subscriptionId) {
      // Expected on a first run / dry-run: the subscription is created earlier in the same sync (or not yet).
      skip(
        log,
        `subscription review screenshot ${item.productId}: subscription not on App Store Connect yet — ` +
          "re-run after it's created",
      );
      continue;
    }
    const current = await api.getSubscriptionReviewScreenshot(subscriptionId);
    // Skip only a finished upload that matches byte-for-byte; a FAILED one re-sends.
    if (current?.sourceFileChecksum === item.asset.checksum && current.assetDeliveryState !== "FAILED") continue;
    await act(log, `upload subscription review screenshot ${item.productId} (${item.asset.fileName})`, false, () =>
      api.uploadSubscriptionReviewScreenshot(subscriptionId, item.asset.fileName, item.asset.path),
    );
  }
}
