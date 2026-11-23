// Pulls and pushes listing text for App Store Connect and Google Play.

import { loadActiveAscKey } from '@/credentials/accounts.js';
import {
  describeMissingPlayServiceAccount,
  loadServiceAccount,
} from '@/credentials/android-keystore-assets.js';
import { errorMessage } from '@/services/platform/error-message.js';
import { createLogger } from '@/services/platform/logger.js';
import type { AppStoreConnect } from '@/apple/app-store-connect.js';
import type { GooglePlayClient } from '@/google/play-client.js';
import { AppleStoreClientService } from '@/services/stores/apple-store-client.js';
import { GoogleStoreClientService } from '@/services/stores/google-store-client.js';
import { isApplePlatform, parsePlatform, platformLabel } from '@/services/stores/platform.js';
import type { AppDescriptor, Platform } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AscKey } from '@/types/credentials.js';
import type { PlayListing } from '@/types/google-play.js';
import { readAppleListing } from '@/apple/store/apple-listing-read.js';
import { reconcileAppListing } from '@/apple/store/app-store-sync.js';
import { loadStoreAppContext } from './select-store-app.ts';
import type {
  AndroidLocaleInfo,
  AndroidStoreConfig,
  AppleStoreConfig,
  StoreConfig,
} from './store-config.ts';
import { readPlainObject } from '@/services/platform/plain-object.js';

export type MetadataCommandInput = {
  operation: 'pull' | 'push';
  platform?: string;
  app?: string;
  dryRun: boolean;
};

/** A metadata command step failed. */
export type MetadataCommandFailure = Readonly<{
  readonly _tag: 'MetadataCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

type MetadataTarget = Readonly<{
  readonly app: AppDescriptor;
  readonly listing: StoreConfig | null;
}>;

type ListingAction = Readonly<{
  status: string;
  description: string;
  error?: string;
}>;

function makeMetadataCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): MetadataCommandFailure {
  return { _tag: 'MetadataCommandFailure', ...fields };
}

function metadataFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): MetadataCommandFailure {
  let message = errorMessage(cause);

  if (explicitMessage != null) {
    message = explicitMessage;
  }

  return makeMetadataCommandFailure({ operation, message, cause });
}

function isMetadataCommandFailure(cause: unknown): cause is MetadataCommandFailure {
  if (typeof cause != 'object') {
    return false;
  }

  if (cause == null) {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  if (cause._tag != 'MetadataCommandFailure') {
    return false;
  }

  if ('operation' in cause == false) {
    return false;
  }

  if (typeof cause.operation != 'string') {
    return false;
  }

  if ('message' in cause == false) {
    return false;
  }

  if (typeof cause.message != 'string') {
    return false;
  }

  if ('cause' in cause == false) {
    return false;
  }

  return true;
}

function normalizeMetadataFailure(operation: string, cause: unknown): MetadataCommandFailure {
  if (isMetadataCommandFailure(cause)) {
    return cause;
  }

  return metadataFailure(operation, cause);
}

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  if (Object.hasOwn(record, fieldName) == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function readOperation(record: Record<string, unknown>): 'pull' | 'push' {
  const operation = record['operation'];

  if (operation == 'pull') {
    return 'pull';
  }

  if (operation == 'push') {
    return 'push';
  }

  throw new Error('operation must be pull or push');
}

function decodeMetadataCommandInput(rawCommandInput: unknown): MetadataCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Metadata command input must be an object.');
  }

  const commandInput: MetadataCommandInput = {
    operation: readOperation(rawCommandInputObject),
    dryRun: readRequiredBoolean(rawCommandInputObject, 'dryRun'),
  };
  const platform = readExactOptionalString(rawCommandInputObject, 'platform');
  const appName = readExactOptionalString(rawCommandInputObject, 'app');

  if (platform != null) {
    commandInput.platform = platform;
  }

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const MetadataCommandInputSchema = decodeMetadataCommandInput;

/** Restrict listing sync to the two platforms with a store listing API. */
export function assertListingPlatform(platform: Platform): void {
  if (platform == 'ios') {
    return;
  }

  if (platform == 'android') {
    return;
  }

  throw metadataFailure(
    'validate metadata platform',
    platform,
    `\`launch-store metadata\` syncs the iOS and Android store listing only - ${platformLabel(platform)} isn't supported yet. Build and ship it with \`launch-store build ${platform}\` / \`launch-store release ${platform}\`, and manage its listing in App Store Connect for now.`,
  );
}

function listingForKey(
  listings: LaunchConfig['listing'],
  listingKey: string | undefined,
): StoreConfig | null {
  if (listings == null) {
    return null;
  }

  if (listingKey == null) {
    return null;
  }

  const storeListing = listings[listingKey];

  if (storeListing == null) {
    return null;
  }

  return storeListing;
}

function declaredListing(launchFile: LaunchConfig, app: AppDescriptor): StoreConfig | null {
  const bundleListing = listingForKey(launchFile.listing, app.bundleId);

  if (bundleListing != null) {
    return bundleListing;
  }

  return listingForKey(launchFile.listing, app.packageName);
}

async function selectMetadataTarget(appSelector: string | undefined): Promise<MetadataTarget> {
  let storeAppContext: Awaited<ReturnType<typeof loadStoreAppContext>>;

  try {
    storeAppContext = await loadStoreAppContext(appSelector);
  } catch (cause) {
    throw metadataFailure('select metadata app', cause);
  }

  const listing = declaredListing(storeAppContext.config, storeAppContext.app);

  return { app: storeAppContext.app, listing };
}

async function requireActiveAscKey(): Promise<AscKey> {
  let ascKey: AscKey | null = null;

  try {
    ascKey = await loadActiveAscKey();
  } catch (cause) {
    throw metadataFailure('load active Apple account', cause);
  }

  if (ascKey == null) {
    throw metadataFailure(
      'load active Apple account',
      'missing-active-account',
      'No active Apple account. Run `launch-store creds set-key` first.',
    );
  }

  return ascKey;
}

async function requirePlayServiceAccount(packageName: string, appName: string): Promise<string> {
  let serviceAccountJson: string | null = null;

  try {
    serviceAccountJson = await loadServiceAccount(packageName);
  } catch (cause) {
    throw metadataFailure('load Play service account', cause);
  }

  if (serviceAccountJson != null) {
    return serviceAccountJson;
  }

  let missingMessage = '';

  try {
    missingMessage = await describeMissingPlayServiceAccount(appName);
  } catch (cause) {
    throw metadataFailure('load Play service account', cause);
  }

  throw metadataFailure('load Play service account', 'missing-service-account', missingMessage);
}

async function createAppleClient(): Promise<AppStoreConnect> {
  const ascKey = await requireActiveAscKey();

  return new AppleStoreClientService().createClient(ascKey);
}

async function createPlayClient(packageName: string, appName: string): Promise<GooglePlayClient> {
  const serviceAccountJson = await requirePlayServiceAccount(packageName, appName);

  try {
    return new GoogleStoreClientService().createClient(serviceAccountJson);
  } catch (cause) {
    throw metadataFailure('create Google Play client', cause);
  }
}

async function requireAppId(ascClient: AppStoreConnect, bundleId: string): Promise<string> {
  let appId: string | null = null;

  try {
    appId = await ascClient.getAppId(bundleId);
  } catch (cause) {
    throw metadataFailure('look up App Store app', cause);
  }

  if (appId == null) {
    throw metadataFailure(
      'look up App Store app',
      bundleId,
      `No App Store Connect app for ${bundleId}. Create it first (launch-store setup).`,
    );
  }

  return appId;
}

/** Print the live App Store listing so it can be pasted under `listing` in launch.config.ts. */
export async function pullAppleListing(bundleId: string, dryRun: boolean): Promise<void> {
  try {
    const logger = createLogger(false);
    const ascClient = await createAppleClient();
    const appId = await requireAppId(ascClient, bundleId);
    let appleListing: AppleStoreConfig;

    try {
      appleListing = await readAppleListing(ascClient, appId);
    } catch (cause) {
      throw metadataFailure('read App Store listing', cause);
    }

    const localeCount = Object.keys(appleListing.info).length;
    const printedListing = JSON.stringify({ apple: appleListing }, null, 2);

    logger.line(printedListing);

    if (dryRun) {
      logger.step(
        'metadata',
        `would add ${localeCount} App Store locale(s) for ${bundleId} under listing in launch.config.ts`,
      );

      return;
    }

    logger.step(
      'metadata',
      `read ${localeCount} App Store locale(s) for ${bundleId}. Add them under listing.${bundleId} in launch.config.ts.`,
    );
  } catch (cause) {
    throw normalizeMetadataFailure('pull App Store metadata', cause);
  }
}

function androidStoreConfigFromListings(listings: readonly PlayListing[]): AndroidStoreConfig {
  const localeInfoByLanguage: Record<string, AndroidLocaleInfo> = {};

  for (const listing of listings) {
    const { language, ...localeInfo } = listing;

    const hasLocaleFields = Object.keys(localeInfo).length > 0;

    if (hasLocaleFields) {
      localeInfoByLanguage[language] = localeInfo;
    }
  }

  return { info: localeInfoByLanguage };
}

async function pullAndroidListing(
  packageName: string,
  appName: string,
  dryRun: boolean,
): Promise<void> {
  try {
    const logger = createLogger(false);
    const playClient = await createPlayClient(packageName, appName);
    let listings: readonly PlayListing[] = [];

    try {
      listings = await playClient.listListings(packageName);
    } catch (cause) {
      throw metadataFailure('read Play listings', cause);
    }

    const androidListing = androidStoreConfigFromListings(listings);
    const localeCount = Object.keys(androidListing.info).length;

    const printedListing = JSON.stringify({ android: androidListing }, null, 2);

    logger.line(printedListing);

    if (dryRun) {
      logger.step(
        'metadata',
        `would add ${localeCount} Play locale(s) for ${packageName} under listing in launch.config.ts`,
      );

      return;
    }

    logger.step(
      'metadata',
      `read ${localeCount} Play locale(s) for ${packageName}. Add them under listing.${packageName} in launch.config.ts.`,
    );
  } catch (cause) {
    throw normalizeMetadataFailure('pull Play metadata', cause);
  }
}

function isFailedListingAction(action: ListingAction): boolean {
  return action.status == 'failed';
}

function describeFailedListingAction(action: ListingAction): string {
  return `${action.description}: ${action.error}`;
}

async function pushAppleListing(
  bundleId: string,
  storeListing: StoreConfig | null,
  dryRun: boolean,
): Promise<void> {
  try {
    const logger = createLogger(false);
    const appleListing = storeListing?.apple;

    if (appleListing == null) {
      throw metadataFailure(
        'read App Store metadata',
        bundleId,
        `No App Store listing for ${bundleId}. Add a listing entry to launch.config.ts.`,
      );
    }

    const ascClient = await createAppleClient();
    let reconciliation: { actions: readonly ListingAction[] };

    try {
      reconciliation = await reconcileAppListing(ascClient, {
        bundleId,
        listing: appleListing,
        dryRun,
      });
    } catch (cause) {
      throw metadataFailure('push App Store listing', cause);
    }

    for (const action of reconciliation.actions) {
      logger.step('metadata', `${action.status}: ${action.description}`);
    }

    const failedActions = reconciliation.actions.filter(isFailedListingAction);

    if (failedActions.length > 0) {
      const failureText = failedActions.map(describeFailedListingAction).join('; ');

      throw metadataFailure(
        'push App Store listing',
        failureText,
        `App Store push failed: ${failureText}`,
      );
    }

    if (dryRun) {
      logger.note('dry run: nothing was written to App Store Connect');
      return;
    }

    logger.step('metadata', `pushed App Store listing for ${bundleId}`);
  } catch (cause) {
    throw normalizeMetadataFailure('push App Store metadata', cause);
  }
}

function playListingFromLocale(localeEntry: [string, AndroidLocaleInfo]): PlayListing {
  const language = localeEntry[0];
  const localeInfo = localeEntry[1];

  return { language, ...localeInfo };
}

function listingsFromAndroidStoreConfig(androidStoreConfig: AndroidStoreConfig): PlayListing[] {
  return Object.entries(androidStoreConfig.info).map(playListingFromLocale);
}

function isNotLanguage(fieldName: string): boolean {
  return fieldName != 'language';
}

async function pushAndroidListing(
  packageName: string,
  appName: string,
  storeListing: StoreConfig | null,
  dryRun: boolean,
): Promise<void> {
  try {
    const logger = createLogger(false);
    const androidListing = storeListing?.android;

    if (androidListing == null) {
      throw metadataFailure(
        'read Play metadata',
        packageName,
        `No Play listing for ${packageName}. Add a listing entry to launch.config.ts.`,
      );
    }

    const listings = listingsFromAndroidStoreConfig(androidListing);

    if (dryRun) {
      for (const listing of listings) {
        const fieldNames = Object.keys(listing).filter(isNotLanguage);

        logger.step(
          'metadata',
          `planned: update Play listing ${listing.language} (${fieldNames.join(', ')}) for ${packageName}`,
        );
      }

      logger.note('dry run: nothing was written to Google Play');

      return;
    }

    if (listings.length == 0) {
      logger.note(`${packageName} has no Play locales to push.`);
      return;
    }

    const playClient = await createPlayClient(packageName, appName);

    try {
      await playClient.updateListings(packageName, listings);
    } catch (cause) {
      throw metadataFailure('upload Play listings', cause);
    }

    logger.step('metadata', `pushed ${listings.length} Play listing(s) for ${packageName}`);
  } catch (cause) {
    throw normalizeMetadataFailure('push Play metadata', cause);
  }
}

async function runAppleMetadataCommand(
  commandInput: MetadataCommandInput,
  metadataTarget: MetadataTarget,
): Promise<void> {
  const bundleId = metadataTarget.app.bundleId;

  if (bundleId == null) {
    throw metadataFailure(
      'resolve App Store listing',
      metadataTarget.app,
      'No bundle identifier for this app (set ios.bundleIdentifier).',
    );
  }

  if (commandInput.operation == 'pull') {
    await pullAppleListing(bundleId, commandInput.dryRun);
    return;
  }

  await pushAppleListing(bundleId, metadataTarget.listing, commandInput.dryRun);
}

async function runAndroidMetadataCommand(
  commandInput: MetadataCommandInput,
  metadataTarget: MetadataTarget,
): Promise<void> {
  const packageName = metadataTarget.app.packageName;

  if (packageName == null) {
    throw metadataFailure(
      'resolve Play listing',
      metadataTarget.app,
      'No Android application id for this app (set android.package).',
    );
  }

  if (commandInput.operation == 'pull') {
    await pullAndroidListing(packageName, metadataTarget.app.name, commandInput.dryRun);

    return;
  }

  await pushAndroidListing(
    packageName,
    metadataTarget.app.name,
    metadataTarget.listing,
    commandInput.dryRun,
  );
}

/** Decode and run one metadata pull or push. */
export async function metadataCommandProgram(rawCommandInput: unknown): Promise<void> {
  let commandInput: MetadataCommandInput;

  try {
    commandInput = decodeMetadataCommandInput(rawCommandInput);
  } catch (cause) {
    throw metadataFailure('decode metadata command input', cause);
  }

  let platformText = 'ios';

  if (commandInput.platform != null) {
    platformText = commandInput.platform;
  }

  let platform: Platform;

  try {
    platform = await parsePlatform(platformText);
  } catch (cause) {
    throw metadataFailure('parse metadata platform', cause);
  }

  assertListingPlatform(platform);

  const metadataTarget = await selectMetadataTarget(commandInput.app);

  if (isApplePlatform(platform)) {
    await runAppleMetadataCommand(commandInput, metadataTarget);
    return;
  }

  await runAndroidMetadataCommand(commandInput, metadataTarget);
}
