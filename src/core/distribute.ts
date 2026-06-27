/**
 * The internal-distribution tail: turn a freshly built ad-hoc artifact into a tester install link hosted
 * on the user's own bucket.
 *
 * Uploads the artifact, an `itms-services` manifest plist (iOS/tvOS/visionOS only), and a small landing
 * page to the configured cloud {@link StorageProvider}, then prints the install URL. This is the
 * `launch build --distribution internal` analog of the submit step — no TestFlight, no Play track, no
 * shared cloud queue. It requires a cloud storage provider, since a `file://` path can't serve an
 * install link; the guard fails loud with the fix when `storage` is still `local`.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { isApplePlatform } from './platform.js';
import type { AppDescriptor, LaunchConfig, Platform } from './types.js';
import type { Logger } from './logger.js';
import { isCloudStorage, resolveStorageProvider } from './storage.js';
import { installLandingPage, iosInstallManifestPlist, itmsServicesUrl } from './installManifest.js';

/** Inputs for {@link distributeArtifact}. */
export interface DistributeOptions {
  config: LaunchConfig;
  app: AppDescriptor;
  platform: Platform;
  /** Absolute path to the built ad-hoc artifact: `.ipa` (iOS/tvOS/visionOS), `.apk` (Android), `.pkg`/`.app`/`.dmg` (macOS). */
  artifactPath: string;
  /** Marketing version, e.g. `1.0.0`. */
  version: string;
  /** Build number (iOS `CFBundleVersion`) / versionCode (Android). */
  buildNumber: number;
  /** iOS bundle id, required for the install manifest. Absent on Android. */
  bundleId?: string | undefined;
  dryRun: boolean;
  log: Logger;
}

/** Content types for the files an internal distribution uploads. */
const CONTENT_TYPE = {
  ipa: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  plist: 'application/xml',
  html: 'text/html; charset=utf-8',
} as const;

/**
 * Upload the artifact + install manifest + landing page and return the tester-facing install link.
 * The keys are namespaced per app/platform/build so successive internal builds don't overwrite each
 * other. In `--dry-run` it computes the same public URLs (no credentials needed) and uploads nothing.
 */
export async function distributeArtifact(options: DistributeOptions): Promise<void> {
  const { config, app, platform, artifactPath, version, buildNumber, bundleId, dryRun, log } =
    options;

  if (!isCloudStorage(config)) {
    throw new Error(
      'Internal distribution needs a cloud storage provider to host the install link. Set `storage: "s3"` ' +
        '(or `supabase`) + a `storageConfig` block in launch.config.ts.',
    );
  }

  const storage = resolveStorageProvider(config);
  const base = `internal/${app.name}/${platform}/${buildNumber}`;
  const pageKey = `${base}/index.html`;
  const pageUrl = storage.publicUrl(pageKey);

  // iOS, tvOS, and visionOS install over the air via an `itms-services` manifest. macOS has no
  // itms-services OTA, so (like Android) it falls through to the direct-download path below.
  if (isApplePlatform(platform) && platform !== 'macos') {
    if (!bundleId)
      throw new Error(
        'An Apple internal build needs a bundle identifier to build the install manifest.',
      );
    const ipaKey = `${base}/${app.name}.ipa`;
    const manifestKey = `${base}/manifest.plist`;
    const ipaUrl = storage.publicUrl(ipaKey);
    const manifestUrl = storage.publicUrl(manifestKey);
    const installUrl = itmsServicesUrl(manifestUrl);
    const manifest = iosInstallManifestPlist({ ipaUrl, bundleId, version, title: app.name });
    const page = installLandingPage({
      title: app.name,
      version,
      buildNumber,
      platform,
      installUrl,
    });

    if (dryRun) {
      log.step(
        'distribute',
        `would upload .ipa + manifest + page to ${base}/`,
        'ad-hoc-distribution',
      );
      log.info(`install page → ${pageUrl}`);
      return;
    }
    await storage.putObject(ipaKey, readFileSync(artifactPath), CONTENT_TYPE.ipa);
    await storage.putObject(manifestKey, manifest, CONTENT_TYPE.plist);
    await storage.putObject(pageKey, page, CONTENT_TYPE.html);
    log.step('distribute', `ad-hoc install link ready`, 'ad-hoc-distribution');
    log.box('Install link', [
      `${app.name} ${version} (${buildNumber})`,
      pageUrl,
      `direct: ${installUrl}`,
    ]);
    return;
  }

  // Direct download: Android (.apk installs directly) and macOS (.pkg/.app/.dmg) — the landing page links
  // straight to the artifact, no install manifest. The artifact keeps its own extension; the .apk has its
  // own MIME, every other binary is served as octet-stream.
  const ext = extname(artifactPath) || (platform === 'android' ? '.apk' : '');
  const fileKey = `${base}/${app.name}${ext}`;
  const fileUrl = storage.publicUrl(fileKey);
  const contentType = platform === 'android' ? CONTENT_TYPE.apk : CONTENT_TYPE.ipa;
  const page = installLandingPage({
    title: app.name,
    version,
    buildNumber,
    platform,
    installUrl: fileUrl,
  });

  if (dryRun) {
    log.step(
      'distribute',
      `would upload ${ext || 'artifact'} + page to ${base}/`,
      'ad-hoc-distribution',
    );
    log.info(`install page → ${pageUrl}`);
    return;
  }
  await storage.putObject(fileKey, readFileSync(artifactPath), contentType);
  await storage.putObject(pageKey, page, CONTENT_TYPE.html);
  log.step('distribute', `install link ready`, 'ad-hoc-distribution');
  log.box('Install link', [
    `${app.name} ${version} (${buildNumber})`,
    pageUrl,
    `direct: ${fileUrl}`,
  ]);
}
