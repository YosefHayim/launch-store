// Checks that the editable App Store Connect version has a copyright set.

import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

type EditableVersion = Readonly<{
  id: string;
  copyright: string;
}> | null;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function isVersionMissing(version: EditableVersion): version is null {
  return version == null;
}

function isConfiguredCopyright(copyright: string | undefined): copyright is string {
  return copyright != null;
}

function isCopyrightMissing(copyright: string | null): copyright is null {
  return copyright == null;
}

function nonEmptyCopyright(copyright: string): string | null {
  const isEmpty = copyright.length == 0;

  if (isEmpty) {
    return null;
  }

  return copyright;
}

function configuredCopyrightText(copyright: string | undefined): string | null {
  if (isConfiguredCopyright(copyright)) {
    return nonEmptyCopyright(copyright);
  }

  return null;
}

async function readVersionCopyright(
  api: AscReadinessApi,
  configuredCopyright: string | undefined,
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

  const hasLiveCopyright = version.copyright.length > 0;

  if (hasLiveCopyright) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: `copyright set ("${version.copyright}")`,
    };
  }

  const copyrightToSend = configuredCopyrightText(configuredCopyright);

  if (isCopyrightMissing(copyrightToSend)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'blocker',
      detail: 'no copyright on the editable version',
      hint: 'set `release.copyright` in launch.config.ts (sent by `launch-store release`), or fill Copyright in App Store Connect -> the version -> General',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'ok',
    detail: `copyright empty on App Store Connect - \`launch-store release\` sets "${copyrightToSend}"`,
  };
}

/** The editable-version copyright readiness probe - Apple refuses to submit a version without one. */
export const versionCopyrightProbe = {
  id: 'apple-version-copyright',
  title: 'Version copyright set',
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

    const configuredCopyright = readinessContext.config.release?.copyright;
    const appleApi = api;

    function readCopyright(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readVersionCopyright(appleApi, configuredCopyright, app);
    }

    const findings = await Promise.all(apps.map(readCopyright));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
