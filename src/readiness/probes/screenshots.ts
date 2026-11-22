import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { REQUIRED_APPLE_SCREENSHOT_DISPLAY_TYPES } from '@/listing/screenshots/specs.js';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';

type EditableVersion = Readonly<{
  id: string;
  copyright: string;
}> | null;

type ScreenshotSet = Readonly<{
  id: string;
  screenshotDisplayType: string;
}>;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function isVersionMissing(version: EditableVersion): version is null {
  return version == null;
}

function isIphoneSet(screenshotSet: ScreenshotSet): boolean {
  return screenshotSet.screenshotDisplayType.startsWith('APP_IPHONE');
}

function isPresentDisplayType(displayType: string | null): displayType is string {
  return displayType != null;
}

async function populatedIphoneDisplayTypes(
  api: AscReadinessApi,
  versionId: string,
): Promise<Set<string>> {
  const localizations = await api.listAppStoreVersionLocalizations(versionId);

  function listSets(localization: { id: string }): Promise<readonly ScreenshotSet[]> {
    return api.listScreenshotSets(localization.id);
  }

  const setsPerLocale = await Promise.all(localizations.map(listSets));
  const iphoneSets = setsPerLocale.flat().filter(isIphoneSet);

  async function readPopulatedDisplayType(screenshotSet: ScreenshotSet): Promise<string | null> {
    const screenshots = await api.listScreenshots(screenshotSet.id);
    const hasScreenshots = screenshots.length > 0;

    if (hasScreenshots) {
      return screenshotSet.screenshotDisplayType;
    }

    return null;
  }

  const populatedDisplayTypes = await Promise.all(iphoneSets.map(readPopulatedDisplayType));

  return new Set(populatedDisplayTypes.filter(isPresentDisplayType));
}

async function readScreenshots(
  api: AscReadinessApi,
  app: { name: string; identifier: string },
): Promise<AppReadiness> {
  const appId = await api.getAppId(app.identifier);

  if (isAppRecordMissing(appId)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - no app record yet",
      hint: 'create the app record first (see the app-record check)',
    };
  }

  const version = await api.findEditableAppStoreVersion(appId, 'IOS');

  if (isVersionMissing(version)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - no editable app version",
      hint: 'create a new version in App Store Connect, then re-run',
    };
  }

  const populated = await populatedIphoneDisplayTypes(api, version.id);

  function hasRequiredDisplayType(displayType: string): boolean {
    return populated.has(displayType);
  }

  const hasEveryRequired = REQUIRED_APPLE_SCREENSHOT_DISPLAY_TYPES.every(hasRequiredDisplayType);

  if (hasEveryRequired) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: '6.7" iPhone screenshots uploaded',
    };
  }

  const hasSomeIphoneShots = populated.size > 0;

  if (hasSomeIphoneShots) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: 'iPhone screenshots present, but none for the required 6.7" class',
      hint: 'upload at least one 6.7" iPhone screenshot (App Store Connect -> the version -> Previews and Screenshots)',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'blocker',
    detail: 'no iPhone screenshots uploaded',
    hint: 'add iPhone screenshots (App Store Connect -> the version -> Previews and Screenshots) before submitting',
  };
}

/** The App Store Connect iPhone-screenshot readiness probe - a listing-completeness check and submit blocker. */
export const screenshotsProbe = {
  id: 'apple-screenshots',
  title: 'iPhone screenshots uploaded',
  store: 'appstore',
  categories: ['listing', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(readinessContext.apps);
    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const api = await readinessContext.resolveAscApi();

    if (isAppleAccountMissing(api)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = api;

    function readShots(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readScreenshots(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readShots));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
