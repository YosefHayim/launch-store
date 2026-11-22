import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { Logger } from '../services/platform/logger.js';
import { isApplePlatform } from '../services/stores/platform.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import { isCloudStorage, resolveStorageProvider } from './storage.js';
import { installLandingPage, iosInstallManifestPlist, itmsServicesUrl } from './installManifest.js';

type DistributeOptions = Readonly<{
  readonly config: LaunchConfig;
  readonly app: AppDescriptor;
  readonly platform: Platform;
  readonly artifactPath: string;
  readonly version: string;
  readonly buildNumber: number;
  readonly bundleId?: string;
  readonly dryRun: boolean;
  readonly log: Logger;
}>;

type DistributionFailure = Readonly<{
  readonly _tag: 'DistributionFailure';
  readonly reason: 'BundleIdentifierRequired' | 'CloudStorageRequired';
  readonly platform: Platform;
}>;

const CONTENT_TYPE = {
  ipa: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  plist: 'application/xml',
  html: 'text/html; charset=utf-8',
} as const;

function makeDistributionFailure(
  reason: DistributionFailure['reason'],
  platform: Platform,
): DistributionFailure {
  return { _tag: 'DistributionFailure', reason, platform };
}

function shouldPublishAppleInstallPage(platform: Platform): boolean {
  if (isApplePlatform(platform) == false) {
    return false;
  }

  return platform != 'macos';
}

async function publishAppleInstallPage(distributeOptions: DistributeOptions): Promise<void> {
  const { config, app, platform, artifactPath, version, buildNumber, bundleId, dryRun, log } =
    distributeOptions;

  if (bundleId == null) {
    throw makeDistributionFailure('BundleIdentifierRequired', platform);
  }

  const storageProvider = await resolveStorageProvider(config);
  const objectPrefix = `internal/${app.name}/${platform}/${buildNumber}`;
  const landingPageKey = `${objectPrefix}/index.html`;
  const landingPageUrl = storageProvider.publicUrl(landingPageKey);
  const ipaKey = `${objectPrefix}/${app.name}.ipa`;
  const installManifestKey = `${objectPrefix}/manifest.plist`;
  const ipaUrl = storageProvider.publicUrl(ipaKey);
  const installManifestUrl = storageProvider.publicUrl(installManifestKey);
  const installUrl = itmsServicesUrl(installManifestUrl);
  const manifestText = iosInstallManifestPlist({
    ipaUrl,
    bundleId,
    version,
    title: app.name,
  });
  const landingPageHtml = installLandingPage({
    title: app.name,
    version,
    buildNumber,
    platform,
    installUrl,
  });

  if (dryRun) {
    log.step(
      'distribute',
      `would upload .ipa + manifest + page to ${objectPrefix}/`,
      'ad-hoc-distribution',
    );
    log.note(`install page -> ${landingPageUrl}`);

    return;
  }

  const artifactBytes = await readFile(artifactPath);

  await storageProvider.putObject(ipaKey, artifactBytes, CONTENT_TYPE.ipa);
  await storageProvider.putObject(installManifestKey, manifestText, CONTENT_TYPE.plist);
  await storageProvider.putObject(landingPageKey, landingPageHtml, CONTENT_TYPE.html);
  log.step('distribute', 'ad-hoc install link ready', 'ad-hoc-distribution');
  log.box('Install link', [
    `${app.name} ${version} (${buildNumber})`,
    landingPageUrl,
    `direct: ${installUrl}`,
  ]);
}

async function publishDirectInstallPage(distributeOptions: DistributeOptions): Promise<void> {
  const { config, app, platform, artifactPath, version, buildNumber, dryRun, log } =
    distributeOptions;
  const storageProvider = await resolveStorageProvider(config);
  const objectPrefix = `internal/${app.name}/${platform}/${buildNumber}`;
  const landingPageKey = `${objectPrefix}/index.html`;
  const landingPageUrl = storageProvider.publicUrl(landingPageKey);
  let artifactExtension = extname(artifactPath);

  if (artifactExtension == '') {
    if (platform == 'android') {
      artifactExtension = '.apk';
    }
  }

  const artifactKey = `${objectPrefix}/${app.name}${artifactExtension}`;
  const artifactUrl = storageProvider.publicUrl(artifactKey);
  let artifactContentType: string = CONTENT_TYPE.ipa;

  if (platform == 'android') {
    artifactContentType = CONTENT_TYPE.apk;
  }

  const landingPageHtml = installLandingPage({
    title: app.name,
    version,
    buildNumber,
    platform,
    installUrl: artifactUrl,
  });

  if (dryRun) {
    let artifactLabel = artifactExtension;

    if (artifactLabel == '') {
      artifactLabel = 'artifact';
    }

    log.step(
      'distribute',
      `would upload ${artifactLabel} + page to ${objectPrefix}/`,
      'ad-hoc-distribution',
    );
    log.note(`install page -> ${landingPageUrl}`);

    return;
  }

  const artifactBytes = await readFile(artifactPath);

  await storageProvider.putObject(artifactKey, artifactBytes, artifactContentType);
  await storageProvider.putObject(landingPageKey, landingPageHtml, CONTENT_TYPE.html);
  log.step('distribute', 'install link ready', 'ad-hoc-distribution');
  log.box('Install link', [
    `${app.name} ${version} (${buildNumber})`,
    landingPageUrl,
    `direct: ${artifactUrl}`,
  ]);
}

/** Upload an internal build and publish its tester-facing installation page. */
export async function distributeArtifact(distributeOptions: DistributeOptions): Promise<void> {
  if (isCloudStorage(distributeOptions.config) == false) {
    throw makeDistributionFailure('CloudStorageRequired', distributeOptions.platform);
  }

  if (shouldPublishAppleInstallPage(distributeOptions.platform)) {
    await publishAppleInstallPage(distributeOptions);

    return;
  }

  await publishDirectInstallPage(distributeOptions);
}
