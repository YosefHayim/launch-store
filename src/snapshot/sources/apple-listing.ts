import type {
  AppEntities,
  JsonValue,
  RestoreInput,
  SnapshotAscApi,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
} from '@/types/snapshot.js';
import type { PlannedAction } from '@/types/reconcile.js';
import { readAppleLocaleFields, readLocaleInfo } from '@/store/apple/apple-listing-read.js';
import type { AppleLocaleInfo, AppleStoreConfig } from '@/store/shared/store-config.js';
import { reconcileAppListing } from '@/store/apple/asc-sync.js';
import { iosApps } from '@/readiness/app-scopes.js';
import { readPlainObject } from '@/services/platform/plain-object.js';
/** One locale's merged listing fields -> a snapshot entity keyed by the locale (its natural, stable id). */
function readSnapshotEntity(locale: string, fields: Record<string, string>): SnapshotEntity {
  return {
    key: locale,
    summary: `listing ${locale} (${Object.keys(fields).length} field(s))`,
    data: { locale, fields },
  };
}
async function captureListing(api: SnapshotAscApi, appId: string): Promise<SnapshotEntity[]> {
  const localeFields = await readAppleLocaleFields(api, appId);

  return localeFields.map(function listingEntity(localeField) {
    return readSnapshotEntity(localeField.locale, localeField.fields);
  });
}
/** Rebuild the `AppleStoreConfig` listing from one app's captured per-locale entities (skips malformed ones). */
function readSavedListing(saved: AppEntities): AppleStoreConfig {
  const localeInfoByLocale: Record<string, AppleLocaleInfo> = {};

  for (const entity of saved.entities) {
    const capturedListing = readPlainObject(entity.data);

    if (capturedListing == null) continue;

    const locale = capturedListing['locale'];
    const fields = readPlainObject(capturedListing['fields']);

    if (typeof locale != 'string') continue;

    if (fields == null) continue;

    localeInfoByLocale[locale] = readLocaleInfo(fields as Readonly<{ [key: string]: JsonValue }>);
  }

  return { info: localeInfoByLocale };
}
/** The App Store Connect store-listing snapshot source. */
export const appleListingSource: SnapshotSource = {
  id: 'apple-listing',
  title: 'App Store listing',
  store: 'appstore',
  capture: captureAppleListing,
  /** Restore each app's captured listing copy back to App Store Connect */
  restore: restoreAppleListing,
};

function keepApp<AppRecord>(app: AppRecord | null): AppRecord[] {
  if (app == null) {
    return [];
  }

  return [app];
}

async function captureOneListing(api: SnapshotAscApi, app: { name: string; identifier: string }) {
  const appId = await api.getAppId(app.identifier);

  if (appId == null) {
    return null;
  }

  const entities = await captureListing(api, appId);

  return { app: app.name, identifier: app.identifier, entities };
}

async function captureAppleListing(snapshotContext: SnapshotContext) {
  const apps = iosApps(snapshotContext.apps);

  if (apps.length == 0) {
    return { state: 'omitted' as const };
  }

  const api = await snapshotContext.resolveAscApi();

  if (api == null) {
    return {
      state: 'skipped' as const,
      reason: 'no active Apple account',
      hint: 'run `launch-store creds set-key`',
    };
  }

  const captured = await Promise.all(
    apps.map(function captureNamedApp(app) {
      return captureOneListing(api, app);
    }),
  );

  return { state: 'captured' as const, apps: captured.flatMap(keepApp) };
}

async function restoreOneListing(
  client: NonNullable<Awaited<ReturnType<RestoreInput['ctx']['resolveAscWriteClient']>>>,
  app: AppEntities,
  dryRun: boolean,
): Promise<PlannedAction[]> {
  const listing = readSavedListing(app);

  if (Object.keys(listing.info).length == 0) {
    return [];
  }

  try {
    const reconciliation = await reconcileAppListing(client, {
      bundleId: app.identifier,
      listing,
      dryRun,
    });

    const actions = [...reconciliation.actions];

    return actions;
  } catch (reconciliationFailure) {
    const skippedListing: PlannedAction = {
      description: `App Store listing ${app.identifier}: ${listingFailureMessage(reconciliationFailure)}`,
      destructive: false,
      status: 'skipped',
    };

    return [skippedListing];
  }
}

function listingFailureMessage(reconciliationFailure: unknown): string {
  if (reconciliationFailure instanceof Error) {
    return reconciliationFailure.message;
  }

  return String(reconciliationFailure);
}

async function restoreAppleListing({
  ctx: restoreContext,
  saved,
  dryRun,
}: RestoreInput): Promise<{ actions: readonly PlannedAction[] }> {
  const client = await restoreContext.resolveAscWriteClient();

  if (client == null) {
    const skippedListing: PlannedAction = {
      description: 'App Store listing: skipped - no active Apple account',
      destructive: false,
      status: 'skipped',
    };

    return { actions: [skippedListing] };
  }

  const actions: PlannedAction[] = [];

  for (const app of saved) {
    const appActions = await restoreOneListing(client, app, dryRun);
    actions.push(...appActions);
  }

  return { actions };
}
