import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import type { Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import { isApplePlatform } from '../services/platform.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import { isCloudStorage, resolveStorageProvider } from './storage.js';
import { installLandingPage, iosInstallManifestPlist, itmsServicesUrl } from './installManifest.js';

export type DistributeOptions = Readonly<{
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

export type DistributionFailure = Readonly<{
  readonly _tag: 'DistributionFailure';
  readonly reason: 'BundleIdentifierRequired' | 'CloudStorageRequired';
  readonly platform: Platform;
}>;

export const makeDistributionFailure = Data.tagged<DistributionFailure>('DistributionFailure');

const CONTENT_TYPE = {
  ipa: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  plist: 'application/xml',
  html: 'text/html; charset=utf-8',
} as const;

/** Upload an internal build and publish its tester-facing installation page. */
export const distributeArtifact = (
  distributeOptions: DistributeOptions,
): Effect.Effect<void, unknown, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const { config, app, platform, artifactPath, version, buildNumber, bundleId, dryRun, log } =
      distributeOptions;
    if (!isCloudStorage(config)) {
      return yield* Effect.fail(
        makeDistributionFailure({ reason: 'CloudStorageRequired', platform }),
      );
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const storageProvider = yield* resolveStorageProvider(config);
    const objectPrefix = `internal/${app.name}/${platform}/${buildNumber}`;
    const landingPageKey = `${objectPrefix}/index.html`;
    const landingPageUrl = storageProvider.publicUrl(landingPageKey);
    if (isApplePlatform(platform) && platform !== 'macos') {
      if (bundleId === undefined) {
        return yield* Effect.fail(
          makeDistributionFailure({ reason: 'BundleIdentifierRequired', platform }),
        );
      }
      const ipaKey = `${objectPrefix}/${app.name}.ipa`;
      const manifestKey = `${objectPrefix}/manifest.plist`;
      const ipaUrl = storageProvider.publicUrl(ipaKey);
      const manifestUrl = storageProvider.publicUrl(manifestKey);
      const installUrl = itmsServicesUrl(manifestUrl);
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
        yield* log.step(
          'distribute',
          `would upload .ipa + manifest + page to ${objectPrefix}/`,
          'ad-hoc-distribution',
        );
        yield* log.note(`install page -> ${landingPageUrl}`);
        return;
      }
      const artifactBytes = yield* fileSystem.readFile(artifactPath);
      yield* storageProvider.putObject(ipaKey, Buffer.from(artifactBytes), CONTENT_TYPE.ipa);
      yield* storageProvider.putObject(manifestKey, manifestText, CONTENT_TYPE.plist);
      yield* storageProvider.putObject(landingPageKey, landingPageHtml, CONTENT_TYPE.html);
      yield* log.step('distribute', 'ad-hoc install link ready', 'ad-hoc-distribution');
      yield* log.box('Install link', [
        `${app.name} ${version} (${buildNumber})`,
        landingPageUrl,
        `direct: ${installUrl}`,
      ]);
      return;
    }
    let artifactExtension = pathService.extname(artifactPath);
    if (artifactExtension === '' && platform === 'android') artifactExtension = '.apk';
    const artifactKey = `${objectPrefix}/${app.name}${artifactExtension}`;
    const artifactUrl = storageProvider.publicUrl(artifactKey);
    let artifactContentType: string = CONTENT_TYPE.ipa;
    if (platform === 'android') artifactContentType = CONTENT_TYPE.apk;
    const landingPageHtml = installLandingPage({
      title: app.name,
      version,
      buildNumber,
      platform,
      installUrl: artifactUrl,
    });
    if (dryRun) {
      let artifactLabel = artifactExtension;
      if (artifactLabel === '') artifactLabel = 'artifact';
      yield* log.step(
        'distribute',
        `would upload ${artifactLabel} + page to ${objectPrefix}/`,
        'ad-hoc-distribution',
      );
      yield* log.note(`install page -> ${landingPageUrl}`);
      return;
    }
    const artifactBytes = yield* fileSystem.readFile(artifactPath);
    yield* storageProvider.putObject(artifactKey, Buffer.from(artifactBytes), artifactContentType);
    yield* storageProvider.putObject(landingPageKey, landingPageHtml, CONTENT_TYPE.html);
    yield* log.step('distribute', 'install link ready', 'ad-hoc-distribution');
    yield* log.box('Install link', [
      `${app.name} ${version} (${buildNumber})`,
      landingPageUrl,
      `direct: ${artifactUrl}`,
    ]);
  });
