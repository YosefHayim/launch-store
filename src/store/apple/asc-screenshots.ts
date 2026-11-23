import type {
  ListingLocalization,
  PreviewResource,
  PreviewSetResource,
  ReviewScreenshotResource,
  ScreenshotResource,
  ScreenshotSetResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from '../../types/apple-catalog.ts';
import { act, DRY_RUN_ID, succeededOrPlanned, type ActionLog } from './asc-sync.ts';
import type { PlannedAction } from '../../types/reconcile.ts';
import {
  MAX_PREVIEWS_PER_SET,
  MAX_SCREENSHOTS_PER_SET,
  type LocalAsset,
  type LocalPreview,
  type LocalScreenshot,
} from '../../listing/screenshots/assets.ts';
import { appleDisplayTypeLabel, applePreviewTypeLabel } from '../../listing/screenshots/targets.ts';
/** The slice of {@link AppStoreConnectClient} the screenshot reconciler depends on. */
export type ScreenshotsApi = {
  getAppId(bundleId: string): Promise<string | null>;
  getEditableVersionId(appId: string): Promise<string | null>;
  listVersionLocalizations(versionId: string): Promise<ListingLocalization[]>;
  listScreenshotSets(versionLocalizationId: string): Promise<ScreenshotSetResource[]>;
  createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource>;
  listScreenshots(setId: string): Promise<ScreenshotResource[]>;
  uploadScreenshot(setId: string, fileName: string, filePath: string): Promise<string>;
  deleteScreenshot(screenshotId: string): Promise<void>;
  reorderScreenshots(setId: string, screenshotIds: readonly string[]): Promise<void>;
  listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]>;
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]>;
  getSubscriptionReviewScreenshot(subscriptionId: string): Promise<ReviewScreenshotResource | null>;
  uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void>;
};
/** The screenshot calls one set needs once its owner (version or treatment localization) is known. */
export type ScreenshotSetApi = Pick<
  ScreenshotsApi,
  'listScreenshots' | 'uploadScreenshot' | 'deleteScreenshot' | 'reorderScreenshots'
>;
/** One localization that owns screenshot sets: its locale plus how to list and create its sets. */
export type ScreenshotSetOwner = Readonly<{
  locale: string;
  exact: boolean;
  listSets: () => Promise<ScreenshotSetResource[]>;
  createSet: (displayType: string) => Promise<ScreenshotSetResource>;
}>;
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
export function groupBy<Member>(
  members: readonly Member[],
  keyOf: (member: Member) => string,
): Map<string, Member[]> {
  const groups = new Map<string, Member[]>();

  for (const member of members) {
    const groupKey = keyOf(member);
    const existingGroup = groups.get(groupKey);

    const hasGroup = existingGroup != null;

    if (hasGroup) {
      existingGroup.push(member);
      continue;
    }

    groups.set(groupKey, [member]);
  }

  return groups;
}

async function mapWithConcurrency<Member, Mapped>(
  members: readonly Member[],
  concurrency: number,
  mapMember: (member: Member) => Promise<Mapped>,
): Promise<Mapped[]> {
  const mappedMembers: Mapped[] = new Array(members.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < members.length) {
      const memberIndex = nextIndex;

      nextIndex += 1;

      const member = members[memberIndex];

      const isMemberMissing = member == null;

      if (isMemberMissing) {
        continue;
      }

      mappedMembers[memberIndex] = await mapMember(member);
    }
  }

  const workerCount = Math.min(concurrency, members.length);
  const workers: Promise<void>[] = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const worker = runWorker();
    workers.push(worker);
  }

  await Promise.all(workers);

  return mappedMembers;
}

/** Reconcile sets a few at a time, each into its own log, then append their actions in set order. */
async function reconcileSetsInOrder<SetMember>(
  log: ActionLog,
  setGroups: Map<string, SetMember[]>,
  reconcileSet: (setLog: ActionLog, setType: string, setMembers: SetMember[]) => Promise<void>,
): Promise<void> {
  const setUploadConcurrency = 4;
  const setGroupsList = [...setGroups.entries()];

  async function reconcileSetGroup(setGroup: [string, SetMember[]]): Promise<ActionLog> {
    const setType = setGroup[0];
    const setMembers = setGroup[1];
    const setLog: ActionLog = { ...log, actions: [] };

    await reconcileSet(setLog, setType, setMembers);

    return setLog;
  }

  const setLogs = await mapWithConcurrency(setGroupsList, setUploadConcurrency, reconcileSetGroup);

  for (const setLog of setLogs) {
    log.actions.push(...setLog.actions);
  }
}
/** A skipped action with guidance - the plan still shows the work that couldn't run and why. */
function skip(log: ActionLog, description: string): void {
  log.actions.push({ description, destructive: false, status: 'skipped' });
}

function hasNoScreenshotWork(reconcileInput: ScreenshotReconcileInput): boolean {
  if (reconcileInput.screenshots.length != 0) {
    return false;
  }

  return reconcileInput.subscriptionReviewScreenshots.length == 0;
}

/** Reconcile one app's App Store assets. */
export async function reconcileScreenshots(
  api: ScreenshotsApi,
  reconcileInput: ScreenshotReconcileInput,
): Promise<PlannedAction[]> {
  const log: ActionLog = {
    actions: [],
    dryRun: reconcileInput.dryRun,
    allowDestructive: reconcileInput.allowDestructive,
  };

  const isNothingToUpload = hasNoScreenshotWork(reconcileInput);

  if (isNothingToUpload) {
    return log.actions;
  }

  const appId = await api.getAppId(reconcileInput.bundleId);

  const isAppMissing = appId == null;

  if (isAppMissing) {
    skip(
      log,
      `screenshots: no App Store Connect app record for ${reconcileInput.bundleId} - create the app, then re-run`,
    );

    return log.actions;
  }

  const hasScreenshots = reconcileInput.screenshots.length > 0;

  if (hasScreenshots) {
    await reconcileAppScreenshots(api, log, appId, reconcileInput.screenshots);
  }

  const hasReviewScreenshots = reconcileInput.subscriptionReviewScreenshots.length > 0;

  if (hasReviewScreenshots) {
    await reconcileSubscriptionReviewScreenshots(
      api,
      log,
      appId,
      reconcileInput.subscriptionReviewScreenshots,
    );
  }

  return log.actions;
}
/** Upload screenshots into the editable App Store version, per locale -> display-type set. */
async function reconcileAppScreenshots(
  api: ScreenshotsApi,
  log: ActionLog,
  appId: string,
  screenshots: readonly LocalScreenshot[],
): Promise<void> {
  const versionId = await api.getEditableVersionId(appId);

  const isVersionMissing = versionId == null;

  if (isVersionMissing) {
    skip(
      log,
      'screenshots: no editable App Store version - prepare a version in App Store Connect, then re-run',
    );

    return;
  }

  const localizations = await api.listVersionLocalizations(versionId);
  const localizationIdByLocale = new Map<string, string>();

  for (const localization of localizations) {
    localizationIdByLocale.set(localization.locale, localization.id);
  }

  function screenshotLocale(screenshot: LocalScreenshot): string {
    return screenshot.locale;
  }

  for (const [locale, localeScreenshots] of groupBy(screenshots, screenshotLocale)) {
    const localizationId = localizationIdByLocale.get(locale);

    const isLocaleMissing = localizationId == null;

    if (isLocaleMissing) {
      skip(
        log,
        `screenshots [${locale}]: locale not on the editable version - sync the listing for ${locale} first ` +
          `(${localeScreenshots.length} screenshot(s) waiting)`,
      );

      continue;
    }

    const setOwner: ScreenshotSetOwner = {
      locale,
      listSets: function listSets() {
        return api.listScreenshotSets(localizationId);
      },
      createSet: function createSet(displayType: string) {
        return api.createScreenshotSet(localizationId, displayType);
      },
      exact: false,
    };

    await reconcileOwnerScreenshots(api, log, setOwner, localeScreenshots);
  }
}
/** Reconcile one localization's display-type sets against its local screenshots. */
export async function reconcileOwnerScreenshots(
  api: ScreenshotSetApi,
  log: ActionLog,
  setOwner: ScreenshotSetOwner,
  screenshots: readonly LocalScreenshot[],
): Promise<void> {
  const screenshotSets = await setOwner.listSets();
  const setByType = new Map<string, ScreenshotSetResource>();

  for (const screenshotSet of screenshotSets) {
    setByType.set(screenshotSet.screenshotDisplayType, screenshotSet);
  }

  function screenshotDisplayType(screenshot: LocalScreenshot): string {
    return screenshot.displayType;
  }

  const screenshotGroups = groupBy(screenshots, screenshotDisplayType);

  async function reconcileDisplayType(
    setLog: ActionLog,
    displayType: string,
    typeScreenshots: LocalScreenshot[],
  ): Promise<void> {
    await reconcileScreenshotSet(
      api,
      setLog,
      setOwner,
      setByType.get(displayType),
      displayType,
      typeScreenshots,
    );
  }

  await reconcileSetsInOrder(log, screenshotGroups, reconcileDisplayType);
}
/** True when Apple stored the screenshot without a processing failure and with one of `checksums`. */
function holdsChecksumOf(screenshot: ScreenshotResource, checksums: ReadonlySet<string>): boolean {
  const isFailed = screenshot.assetDeliveryState == 'FAILED';

  if (isFailed) {
    return false;
  }

  const checksum = screenshot.sourceFileChecksum;

  const isChecksumMissing = checksum == null;

  if (isChecksumMissing) {
    return false;
  }

  return checksums.has(checksum);
}
/** Delete an exact set's screenshots that are not local files; returns the screenshots still in the set. */
async function removeUnlistedScreenshots(
  api: ScreenshotSetApi,
  log: ActionLog,
  setLabel: string,
  existingScreenshots: readonly ScreenshotResource[],
  screenshots: readonly LocalScreenshot[],
): Promise<ScreenshotResource[]> {
  const localChecksums = new Set<string>();

  for (const screenshot of screenshots) {
    localChecksums.add(screenshot.checksum);
  }

  const keptScreenshots: ScreenshotResource[] = [];

  for (const existingScreenshot of existingScreenshots) {
    const isLocalFile = holdsChecksumOf(existingScreenshot, localChecksums);

    if (isLocalFile) {
      keptScreenshots.push(existingScreenshot);
      continue;
    }

    const removeAction = await act(
      log,
      `remove screenshot ${setLabel} ${existingScreenshot.fileName}: not a local file`,
      false,
      function deleteScreenshot() {
        return api.deleteScreenshot(existingScreenshot.id);
      },
    );
    const wasRemoved = succeededOrPlanned(removeAction.status);

    if (wasRemoved == false) {
      keptScreenshots.push(existingScreenshot);
    }
  }

  return keptScreenshots;
}
/** A local screenshot the set holds after this run, by its Apple id. */
type HeldScreenshot = Readonly<{ checksum: string; id: string }>;

function needsScreenshotReorder(holdsEveryScreenshot: boolean, inFileOrder: boolean): boolean {
  if (holdsEveryScreenshot == false) {
    return false;
  }

  return inFileOrder == false;
}

function readOrderedScreenshotIds(
  localChecksums: readonly string[],
  idByChecksum: ReadonlyMap<string, string>,
): string[] {
  const orderedIds: string[] = [];

  for (const checksum of localChecksums) {
    const screenshotId = idByChecksum.get(checksum);

    const isIdMissing = screenshotId == null;

    if (isIdMissing) {
      continue;
    }

    orderedIds.push(screenshotId);
  }

  return orderedIds;
}

/** Put an exact set in file order when kept and newly uploaded screenshots ended up out of order. */
async function orderScreenshots(
  api: ScreenshotSetApi,
  log: ActionLog,
  setId: string,
  setLabel: string,
  setSize: number,
  heldScreenshots: readonly HeldScreenshot[],
  screenshots: readonly LocalScreenshot[],
): Promise<void> {
  const localChecksums: string[] = [];

  for (const screenshot of screenshots) {
    localChecksums.push(screenshot.checksum);
  }

  const holdsEveryScreenshot = heldScreenshots.length == localChecksums.length;
  let inFileOrder = true;

  for (let position = 0; position < heldScreenshots.length; position += 1) {
    const heldScreenshot = heldScreenshots[position];

    const isPositionMissing = heldScreenshot == null;

    if (isPositionMissing) {
      inFileOrder = false;
      continue;
    }

    const matchesFile = heldScreenshot.checksum == localChecksums[position];

    if (matchesFile == false) {
      inFileOrder = false;
    }
  }

  const needsReorder = needsScreenshotReorder(holdsEveryScreenshot, inFileOrder);

  if (needsReorder == false) {
    return;
  }

  const idByChecksum = new Map<string, string>();

  for (const heldScreenshot of heldScreenshots) {
    idByChecksum.set(heldScreenshot.checksum, heldScreenshot.id);
  }

  const orderedIds = readOrderedScreenshotIds(localChecksums, idByChecksum);
  const listsWholeSet = orderedIds.length == setSize;

  async function reorderSet(): Promise<void> {
    if (listsWholeSet == false) {
      throw new Error('the set does not hold exactly the local screenshots');
    }

    await api.reorderScreenshots(setId, orderedIds);
  }

  await act(log, `order screenshots ${setLabel} by file name`, false, reorderSet);
}

function readHeldScreenshots(existingScreenshots: readonly ScreenshotResource[]): HeldScreenshot[] {
  const heldScreenshots: HeldScreenshot[] = [];

  for (const screenshot of existingScreenshots) {
    const isFailed = screenshot.assetDeliveryState == 'FAILED';

    if (isFailed) {
      continue;
    }

    const checksum = screenshot.sourceFileChecksum;

    const isChecksumMissing = checksum == null;

    if (isChecksumMissing) {
      continue;
    }

    heldScreenshots.push({ checksum, id: screenshot.id });
  }

  return heldScreenshots;
}

/** Resolve (or create) one display-type set, then upload the local screenshots Apple doesn't already have. */
async function reconcileScreenshotSet(
  api: ScreenshotSetApi,
  log: ActionLog,
  setOwner: ScreenshotSetOwner,
  existingSet: ScreenshotSetResource | undefined,
  displayType: string,
  screenshots: readonly LocalScreenshot[],
): Promise<void> {
  const label = appleDisplayTypeLabel(displayType);
  const locale = setOwner.locale;
  const setLabel = `${label} [${locale}]`;
  let setId: string;
  let existingScreenshots: ScreenshotResource[];

  if (existingSet != null) {
    setId = existingSet.id;
    existingScreenshots = await api.listScreenshots(setId);
  } else {
    const createAction = await act(
      log,
      `create screenshot set ${label} [${locale}]`,
      false,
      function createSet() {
        return setOwner.createSet(displayType);
      },
    );
    const wasCreated = succeededOrPlanned(createAction.status);

    if (wasCreated == false) {
      return;
    }

    const createdSetId = createAction.actionValue?.id;

    setId = DRY_RUN_ID;

    const hasCreatedSetId = createdSetId != null;

    if (hasCreatedSetId) {
      setId = createdSetId;
    }

    existingScreenshots = [];
  }

  const isExactSet = setOwner.exact == true;

  if (isExactSet) {
    existingScreenshots = await removeUnlistedScreenshots(
      api,
      log,
      setLabel,
      existingScreenshots,
      screenshots,
    );
  }

  const heldScreenshots = readHeldScreenshots(existingScreenshots);
  const uploadedChecksums = new Set<string>();

  for (const heldScreenshot of heldScreenshots) {
    uploadedChecksums.add(heldScreenshot.checksum);
  }

  let screenshotCount = existingScreenshots.length;

  for (const screenshot of screenshots) {
    const isAlreadyUploaded = uploadedChecksums.has(screenshot.checksum);

    if (isAlreadyUploaded) {
      continue;
    }

    const isSetFull = screenshotCount >= MAX_SCREENSHOTS_PER_SET;

    if (isSetFull) {
      skip(
        log,
        `screenshot ${label} [${locale}] ${screenshot.fileName}: set is full (${MAX_SCREENSHOTS_PER_SET} max) - skipped`,
      );

      continue;
    }

    const uploadAction = await act(
      log,
      `upload screenshot ${label} [${locale}] ${screenshot.fileName}`,
      false,
      function uploadScreenshot() {
        return api.uploadScreenshot(setId, screenshot.fileName, screenshot.path);
      },
    );

    const wasUploaded = succeededOrPlanned(uploadAction.status);

    if (wasUploaded) {
      let uploadedId = DRY_RUN_ID;
      const uploadedScreenshotId = uploadAction.actionValue;

      const hasUploadedId = uploadedScreenshotId != null;

      if (hasUploadedId) {
        uploadedId = uploadedScreenshotId;
      }

      heldScreenshots.push({ checksum: screenshot.checksum, id: uploadedId });
    }

    screenshotCount += 1;
  }

  if (isExactSet) {
    await orderScreenshots(
      api,
      log,
      setId,
      setLabel,
      screenshotCount,
      heldScreenshots,
      screenshots,
    );
  }
}

function reviewScreenshotMatches(
  currentScreenshot: ReviewScreenshotResource | null,
  asset: LocalAsset,
): boolean {
  if (currentScreenshot == null) {
    return false;
  }

  const checksumMatches = currentScreenshot.sourceFileChecksum == asset.checksum;

  if (checksumMatches == false) {
    return false;
  }

  return currentScreenshot.assetDeliveryState != 'FAILED';
}

/** Upload each declared subscription's review screenshot, resolving the subscription live by product id. */
async function reconcileSubscriptionReviewScreenshots(
  api: ScreenshotsApi,
  log: ActionLog,
  appId: string,
  reviewScreenshots: readonly SubscriptionReviewScreenshot[],
): Promise<void> {
  const subscriptionIdByProduct = new Map<string, string>();
  const subscriptionGroups = await api.listSubscriptionGroups(appId);

  for (const subscriptionGroup of subscriptionGroups) {
    const subscriptions = await api.listSubscriptions(subscriptionGroup.id);

    for (const subscription of subscriptions) {
      subscriptionIdByProduct.set(subscription.productId, subscription.id);
    }
  }

  for (const reviewScreenshot of reviewScreenshots) {
    const subscriptionId = subscriptionIdByProduct.get(reviewScreenshot.productId);

    const isSubscriptionMissing = subscriptionId == null;

    if (isSubscriptionMissing) {
      skip(
        log,
        `subscription review screenshot ${reviewScreenshot.productId}: subscription not on App Store Connect yet - ` +
          "re-run after it's created",
      );

      continue;
    }

    const currentScreenshot = await api.getSubscriptionReviewScreenshot(subscriptionId);

    const alreadyMatches = reviewScreenshotMatches(currentScreenshot, reviewScreenshot.asset);

    if (alreadyMatches) {
      continue;
    }

    await act(
      log,
      `upload subscription review screenshot ${reviewScreenshot.productId} (${reviewScreenshot.asset.fileName})`,
      false,
      function uploadReviewScreenshot() {
        return api.uploadSubscriptionReviewScreenshot(
          subscriptionId,
          reviewScreenshot.asset.fileName,
          reviewScreenshot.asset.path,
        );
      },
    );
  }
}
/** App Store client operations required for preview videos. */
export type PreviewsApi = {
  getAppId(bundleId: string): Promise<string | null>;
  getEditableVersionId(appId: string): Promise<string | null>;
  listVersionLocalizations(versionId: string): Promise<ListingLocalization[]>;
  listPreviewSets(versionLocalizationId: string): Promise<PreviewSetResource[]>;
  createPreviewSet(versionLocalizationId: string, previewType: string): Promise<PreviewSetResource>;
  listPreviews(setId: string): Promise<PreviewResource[]>;
  uploadPreview(setId: string, fileName: string, filePath: string): Promise<void>;
};
/** Inputs to the app-preview reconcile pass for one app. */
export type PreviewReconcileInput = {
  bundleId: string;
  previews: LocalPreview[];
  dryRun: boolean;
  allowDestructive: boolean;
};
/** Reconcile one app's App Store **preview videos** */
export async function reconcilePreviews(
  api: PreviewsApi,
  reconcileInput: PreviewReconcileInput,
): Promise<PlannedAction[]> {
  const log: ActionLog = {
    actions: [],
    dryRun: reconcileInput.dryRun,
    allowDestructive: reconcileInput.allowDestructive,
  };

  const hasNoPreviews = reconcileInput.previews.length == 0;

  if (hasNoPreviews) {
    return log.actions;
  }

  const appId = await api.getAppId(reconcileInput.bundleId);

  const isAppMissing = appId == null;

  if (isAppMissing) {
    skip(
      log,
      `previews: no App Store Connect app record for ${reconcileInput.bundleId} - create the app, then re-run`,
    );

    return log.actions;
  }

  const versionId = await api.getEditableVersionId(appId);

  const isVersionMissing = versionId == null;

  if (isVersionMissing) {
    skip(
      log,
      'previews: no editable App Store version - prepare a version in App Store Connect, then re-run',
    );

    return log.actions;
  }

  const localizations = await api.listVersionLocalizations(versionId);
  const localizationIdByLocale = new Map<string, string>();

  for (const localization of localizations) {
    localizationIdByLocale.set(localization.locale, localization.id);
  }

  function previewLocale(preview: LocalPreview): string {
    return preview.locale;
  }

  for (const [locale, localePreviews] of groupBy(reconcileInput.previews, previewLocale)) {
    const localizationId = localizationIdByLocale.get(locale);

    const isLocaleMissing = localizationId == null;

    if (isLocaleMissing) {
      skip(
        log,
        `previews [${locale}]: locale not on the editable version - sync the listing for ${locale} first ` +
          `(${localePreviews.length} preview(s) waiting)`,
      );

      continue;
    }

    const presentLocalizationId = localizationId;
    const previewSets = await api.listPreviewSets(presentLocalizationId);
    const setByType = new Map<string, PreviewSetResource>();

    for (const previewSet of previewSets) {
      setByType.set(previewSet.previewType, previewSet);
    }

    function previewTypeOf(preview: LocalPreview): string {
      return preview.previewType;
    }

    const previewGroups = groupBy(localePreviews, previewTypeOf);

    async function reconcilePreviewGroup(
      setLog: ActionLog,
      previewType: string,
      typePreviews: LocalPreview[],
    ): Promise<void> {
      await reconcilePreviewSet(
        api,
        setLog,
        presentLocalizationId,
        setByType.get(previewType),
        previewType,
        locale,
        typePreviews,
      );
    }

    await reconcileSetsInOrder(log, previewGroups, reconcilePreviewGroup);
  }

  return log.actions;
}

function readUploadedPreviewChecksums(existingPreviews: readonly PreviewResource[]): Set<string> {
  const uploadedChecksums = new Set<string>();

  for (const preview of existingPreviews) {
    const isFailed = preview.assetDeliveryState == 'FAILED';

    if (isFailed) {
      continue;
    }

    const checksum = preview.sourceFileChecksum;
    const isChecksum = typeof checksum == 'string';

    if (isChecksum == false) {
      continue;
    }

    uploadedChecksums.add(checksum);
  }

  return uploadedChecksums;
}

/** Resolve (or create) one preview-type set, then upload the local previews Apple doesn't already have. */
async function reconcilePreviewSet(
  api: PreviewsApi,
  log: ActionLog,
  localizationId: string,
  existingSet: PreviewSetResource | undefined,
  previewType: string,
  locale: string,
  previews: readonly LocalPreview[],
): Promise<void> {
  const label = applePreviewTypeLabel(previewType);
  let setId: string;
  let existingPreviews: PreviewResource[];

  if (existingSet != null) {
    setId = existingSet.id;
    existingPreviews = await api.listPreviews(setId);
  } else {
    const createAction = await act(
      log,
      `create preview set ${label} [${locale}]`,
      false,
      function createSet() {
        return api.createPreviewSet(localizationId, previewType);
      },
    );
    const wasCreated = succeededOrPlanned(createAction.status);

    if (wasCreated == false) {
      return;
    }

    const createdSetId = createAction.actionValue?.id;

    setId = DRY_RUN_ID;

    const hasCreatedSetId = createdSetId != null;

    if (hasCreatedSetId) {
      setId = createdSetId;
    }

    existingPreviews = [];
  }

  const uploadedChecksums = readUploadedPreviewChecksums(existingPreviews);
  let previewCount = existingPreviews.length;

  for (const preview of previews) {
    const isAlreadyUploaded = uploadedChecksums.has(preview.checksum);

    if (isAlreadyUploaded) {
      continue;
    }

    const isSetFull = previewCount >= MAX_PREVIEWS_PER_SET;

    if (isSetFull) {
      skip(
        log,
        `preview ${label} [${locale}] ${preview.fileName}: set is full (${MAX_PREVIEWS_PER_SET} max) - skipped`,
      );

      continue;
    }

    await act(
      log,
      `upload preview ${label} [${locale}] ${preview.fileName}`,
      false,
      function uploadPreview() {
        return api.uploadPreview(setId, preview.fileName, preview.path);
      },
    );
    previewCount += 1;
  }
}
