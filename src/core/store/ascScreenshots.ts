import { Effect } from 'effect';
import type {
  ListingLocalization,
  PreviewResource,
  PreviewSetResource,
  ReviewScreenshotResource,
  ScreenshotResource,
  ScreenshotSetResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from '../types/appleCatalog.js';
import { act, DRY_RUN_ID, succeededOrPlanned, type ActionLog } from './ascSync.js';
import type { PlannedAction } from '../types/reconcile.js';
import {
  MAX_PREVIEWS_PER_SET,
  MAX_SCREENSHOTS_PER_SET,
  type LocalAsset,
  type LocalPreview,
  type LocalScreenshot,
} from '../listing/screenshots/assets.js';
import { appleDisplayTypeLabel, applePreviewTypeLabel } from '../listing/screenshots/targets.js';
/**
 * The slice of {@link AppStoreConnectClient} the screenshot reconciler depends on. Declared here (rather
 * than taking the concrete client) so the reconcile logic is unit-testable against a hand-rolled fake.
 * `AppStoreConnectClient` satisfies it structurally. The high-level `upload*` methods hide the
 * reserve->PUT->commit asset flow so this module never deals with upload operations or checksums directly.
 */
export type ScreenshotsApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  getEditableVersionId(appId: string): Effect.Effect<string | null, unknown>;
  listVersionLocalizations(versionId: string): Effect.Effect<ListingLocalization[], unknown>;
  listScreenshotSets(
    versionLocalizationId: string,
  ): Effect.Effect<ScreenshotSetResource[], unknown>;
  createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Effect.Effect<ScreenshotSetResource, unknown>;
  listScreenshots(setId: string): Effect.Effect<ScreenshotResource[], unknown>;
  uploadScreenshot(setId: string, fileName: string, filePath: string): Effect.Effect<void, unknown>;
  listSubscriptionGroups(appId: string): Effect.Effect<SubscriptionGroupResource[], unknown>;
  listSubscriptions(groupId: string): Effect.Effect<SubscriptionResource[], unknown>;
  getSubscriptionReviewScreenshot(
    subscriptionId: string,
  ): Effect.Effect<ReviewScreenshotResource | null, unknown>;
  uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Effect.Effect<void, unknown>;
};
/** One subscription's declared review screenshot, paired with its product id for live subscription resolution. */
export type SubscriptionReviewScreenshot = {
  productId: string;
  asset: LocalAsset;
};
/** Inputs to the screenshot reconcile pass for one app. */
export type ScreenshotReconcileInput = {
  bundleId: string;
  screenshots: LocalScreenshot[];
  subscriptionReviewScreenshots: SubscriptionReviewScreenshot[];
  dryRun: boolean;
  allowDestructive: boolean;
};
/** Group members by a derived string key. */
const groupBy = <Member>(
  members: Member[],
  keyOf: (member: Member) => string,
): Map<string, Member[]> => {
  const groups = new Map<string, Member[]>();
  for (const member of members) {
    const existingGroup = groups.get(keyOf(member));
    if (existingGroup !== undefined) existingGroup.push(member);
    else groups.set(keyOf(member), [member]);
  }
  return groups;
};
/** A skipped action with guidance - the plan still shows the work that couldn't run and why. */
const skip = (log: ActionLog, description: string): void => {
  log.actions.push({ description, destructive: false, status: 'skipped' });
};
/**
 * Reconcile one app's App Store assets. Resolves the ASC app record once, then runs the screenshot and
 * subscription-review-screenshot passes; returns the actions planned/performed (the command merges them
 * into the app's overall sync report). Never throws for a per-asset failure - those are captured on their
 * action by {@link act}.
 */
export const reconcileScreenshots = (
  api: ScreenshotsApi,
  input: ScreenshotReconcileInput,
): Effect.Effect<PlannedAction[], unknown> =>
  Effect.gen(function* () {
    const log: ActionLog = {
      actions: [],
      dryRun: input.dryRun,
      allowDestructive: input.allowDestructive,
    };
    if (input.screenshots.length === 0 && input.subscriptionReviewScreenshots.length === 0)
      return log.actions;
    const appId = yield* api.getAppId(input.bundleId);
    if (appId === null) {
      skip(
        log,
        `screenshots: no App Store Connect app record for ${input.bundleId} - create the app, then re-run`,
      );
      return log.actions;
    }
    if (input.screenshots.length > 0)
      yield* reconcileAppScreenshots(api, log, appId, input.screenshots);
    if (input.subscriptionReviewScreenshots.length > 0) {
      yield* reconcileSubscriptionReviewScreenshots(
        api,
        log,
        appId,
        input.subscriptionReviewScreenshots,
      );
    }
    return log.actions;
  });
/** Upload screenshots into the editable App Store version, per locale -> display-type set. */
const reconcileAppScreenshots = (
  api: ScreenshotsApi,
  log: ActionLog,
  appId: string,
  screenshots: LocalScreenshot[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const versionId = yield* api.getEditableVersionId(appId);
    if (versionId === null) {
      skip(
        log,
        'screenshots: no editable App Store version - prepare a version in App Store Connect, then re-run',
      );
      return;
    }
    const localizations = yield* api.listVersionLocalizations(versionId);
    const localizationIdByLocale = new Map(
      localizations.map((localization) => [localization.locale, localization.id]),
    );
    for (const [locale, localeScreenshots] of groupBy(
      screenshots,
      (screenshot) => screenshot.locale,
    )) {
      const localizationId = localizationIdByLocale.get(locale);
      if (localizationId === undefined) {
        skip(
          log,
          `screenshots [${locale}]: locale not on the editable version - sync the listing for ${locale} first ` +
            `(${localeScreenshots.length} screenshot(s) waiting)`,
        );
        continue;
      }
      const screenshotSets = yield* api.listScreenshotSets(localizationId);
      const setByType = new Map(
        screenshotSets.map((screenshotSet) => [screenshotSet.screenshotDisplayType, screenshotSet]),
      );
      for (const [displayType, typeScreenshots] of groupBy(
        localeScreenshots,
        (screenshot) => screenshot.displayType,
      )) {
        yield* reconcileScreenshotSet(
          api,
          log,
          localizationId,
          setByType.get(displayType),
          displayType,
          locale,
          typeScreenshots,
        );
      }
    }
  });
/** Resolve (or create) one display-type set, then upload the local screenshots Apple doesn't already have. */
const reconcileScreenshotSet = (
  api: ScreenshotsApi,
  log: ActionLog,
  localizationId: string,
  existingSet: ScreenshotSetResource | undefined,
  displayType: string,
  locale: string,
  screenshots: LocalScreenshot[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const label = appleDisplayTypeLabel(displayType);
    let setId: string;
    let existingScreenshots: ScreenshotResource[];
    if (existingSet !== undefined) {
      setId = existingSet.id;
      existingScreenshots = yield* api.listScreenshots(setId);
    } else {
      const createAction = yield* act(
        log,
        `create screenshot set ${label} [${locale}]`,
        false,
        () => api.createScreenshotSet(localizationId, displayType),
      );
      if (!succeededOrPlanned(createAction.status)) return;
      const createdSetId = createAction.actionValue?.id;
      setId = DRY_RUN_ID;
      if (createdSetId !== undefined) setId = createdSetId;
      existingScreenshots = [];
    }
    const uploadedChecksums = new Set(
      existingScreenshots
        .filter((screenshot) => screenshot.assetDeliveryState !== 'FAILED')
        .map((screenshot) => screenshot.sourceFileChecksum)
        .filter((checksum): checksum is string => typeof checksum === 'string'),
    );
    let screenshotCount = existingScreenshots.length;
    for (const screenshot of screenshots) {
      if (uploadedChecksums.has(screenshot.checksum)) continue;
      if (screenshotCount >= MAX_SCREENSHOTS_PER_SET) {
        skip(
          log,
          `screenshot ${label} [${locale}] ${screenshot.fileName}: set is full (${MAX_SCREENSHOTS_PER_SET} max) - skipped`,
        );
        continue;
      }
      yield* act(log, `upload screenshot ${label} [${locale}] ${screenshot.fileName}`, false, () =>
        api.uploadScreenshot(setId, screenshot.fileName, screenshot.path),
      );
      screenshotCount++;
    }
  });
/** Upload each declared subscription's review screenshot, resolving the subscription live by product id. */
const reconcileSubscriptionReviewScreenshots = (
  api: ScreenshotsApi,
  log: ActionLog,
  appId: string,
  reviewScreenshots: SubscriptionReviewScreenshot[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const subscriptionIdByProduct = new Map<string, string>();
    const subscriptionGroups = yield* api.listSubscriptionGroups(appId);
    for (const subscriptionGroup of subscriptionGroups) {
      const subscriptions = yield* api.listSubscriptions(subscriptionGroup.id);
      for (const subscription of subscriptions) {
        subscriptionIdByProduct.set(subscription.productId, subscription.id);
      }
    }
    for (const reviewScreenshot of reviewScreenshots) {
      const subscriptionId = subscriptionIdByProduct.get(reviewScreenshot.productId);
      if (subscriptionId === undefined) {
        skip(
          log,
          `subscription review screenshot ${reviewScreenshot.productId}: subscription not on App Store Connect yet - ` +
            "re-run after it's created",
        );
        continue;
      }
      const currentScreenshot = yield* api.getSubscriptionReviewScreenshot(subscriptionId);
      if (
        currentScreenshot?.sourceFileChecksum === reviewScreenshot.asset.checksum &&
        currentScreenshot.assetDeliveryState !== 'FAILED'
      )
        continue;
      yield* act(
        log,
        `upload subscription review screenshot ${reviewScreenshot.productId} (${reviewScreenshot.asset.fileName})`,
        false,
        () =>
          api.uploadSubscriptionReviewScreenshot(
            subscriptionId,
            reviewScreenshot.asset.fileName,
            reviewScreenshot.asset.path,
          ),
      );
    }
  });
/** App Store client operations required for preview videos. */
export type PreviewsApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  getEditableVersionId(appId: string): Effect.Effect<string | null, unknown>;
  listVersionLocalizations(versionId: string): Effect.Effect<ListingLocalization[], unknown>;
  listPreviewSets(versionLocalizationId: string): Effect.Effect<PreviewSetResource[], unknown>;
  createPreviewSet(
    versionLocalizationId: string,
    previewType: string,
  ): Effect.Effect<PreviewSetResource, unknown>;
  listPreviews(setId: string): Effect.Effect<PreviewResource[], unknown>;
  uploadPreview(setId: string, fileName: string, filePath: string): Effect.Effect<void, unknown>;
};
/** Inputs to the app-preview reconcile pass for one app. */
export type PreviewReconcileInput = {
  bundleId: string;
  previews: LocalPreview[];
  dryRun: boolean;
  allowDestructive: boolean;
};
/**
 * Reconcile one app's App Store **preview videos**, the video counterpart of {@link reconcileScreenshots}.
 * Resolves the ASC app record + editable version once, then uploads per locale and `previewType` set the
 * videos Apple doesn't already have. Idempotent and additive: a local file whose MD5 already appears on
 * Apple is skipped, and because Apple records that checksum at commit time - before it finishes processing
 * the video asynchronously - a re-run mid-processing re-uploads nothing. Never throws for a per-asset
 * failure; those are captured on their action by {@link act}.
 */
export const reconcilePreviews = (
  api: PreviewsApi,
  input: PreviewReconcileInput,
): Effect.Effect<PlannedAction[], unknown> =>
  Effect.gen(function* () {
    const log: ActionLog = {
      actions: [],
      dryRun: input.dryRun,
      allowDestructive: input.allowDestructive,
    };
    if (input.previews.length === 0) return log.actions;
    const appId = yield* api.getAppId(input.bundleId);
    if (appId === null) {
      skip(
        log,
        `previews: no App Store Connect app record for ${input.bundleId} - create the app, then re-run`,
      );
      return log.actions;
    }
    const versionId = yield* api.getEditableVersionId(appId);
    if (versionId === null) {
      skip(
        log,
        'previews: no editable App Store version - prepare a version in App Store Connect, then re-run',
      );
      return log.actions;
    }
    const localizations = yield* api.listVersionLocalizations(versionId);
    const localizationIdByLocale = new Map(
      localizations.map((localization) => [localization.locale, localization.id]),
    );
    for (const [locale, localePreviews] of groupBy(input.previews, (preview) => preview.locale)) {
      const localizationId = localizationIdByLocale.get(locale);
      if (localizationId === undefined) {
        skip(
          log,
          `previews [${locale}]: locale not on the editable version - sync the listing for ${locale} first ` +
            `(${localePreviews.length} preview(s) waiting)`,
        );
        continue;
      }
      const previewSets = yield* api.listPreviewSets(localizationId);
      const setByType = new Map(
        previewSets.map((previewSet) => [previewSet.previewType, previewSet]),
      );
      for (const [previewType, typePreviews] of groupBy(
        localePreviews,
        (preview) => preview.previewType,
      )) {
        yield* reconcilePreviewSet(
          api,
          log,
          localizationId,
          setByType.get(previewType),
          previewType,
          locale,
          typePreviews,
        );
      }
    }
    return log.actions;
  });
/** Resolve (or create) one preview-type set, then upload the local previews Apple doesn't already have. */
const reconcilePreviewSet = (
  api: PreviewsApi,
  log: ActionLog,
  localizationId: string,
  existingSet: PreviewSetResource | undefined,
  previewType: string,
  locale: string,
  previews: LocalPreview[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const label = applePreviewTypeLabel(previewType);
    let setId: string;
    let existingPreviews: PreviewResource[];
    if (existingSet !== undefined) {
      setId = existingSet.id;
      existingPreviews = yield* api.listPreviews(setId);
    } else {
      const createAction = yield* act(log, `create preview set ${label} [${locale}]`, false, () =>
        api.createPreviewSet(localizationId, previewType),
      );
      if (!succeededOrPlanned(createAction.status)) return;
      const createdSetId = createAction.actionValue?.id;
      setId = DRY_RUN_ID;
      if (createdSetId !== undefined) setId = createdSetId;
      existingPreviews = [];
    }
    const uploadedChecksums = new Set(
      existingPreviews
        .filter((preview) => preview.assetDeliveryState !== 'FAILED')
        .map((preview) => preview.sourceFileChecksum)
        .filter((checksum): checksum is string => typeof checksum === 'string'),
    );
    let previewCount = existingPreviews.length;
    for (const preview of previews) {
      if (uploadedChecksums.has(preview.checksum)) continue;
      if (previewCount >= MAX_PREVIEWS_PER_SET) {
        skip(
          log,
          `preview ${label} [${locale}] ${preview.fileName}: set is full (${MAX_PREVIEWS_PER_SET} max) - skipped`,
        );
        continue;
      }
      yield* act(log, `upload preview ${label} [${locale}] ${preview.fileName}`, false, () =>
        api.uploadPreview(setId, preview.fileName, preview.path),
      );
      previewCount++;
    }
  });
