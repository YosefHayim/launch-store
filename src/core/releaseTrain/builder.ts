/**
 * Build the live {@link TrainEngine} for one `launch release-train` run. Each engine method wraps an
 * already-tested release primitive — `appStoreRelease` (iOS submit/read/release), the Play submitter
 * (Android), and `otaPublish` (OTA followers) — and the store clients / code signer resolve **lazily**, so
 * a `status` reconcile that only reads never constructs a signer or a write-capable client.
 *
 * This is the domain seam the `release-train` CLI command sits on: the command resolves config + env, calls
 * {@link buildTrainRuntime}, and hands the engine to `core/releaseTrain/orchestrator.ts`. Keeping the engine
 * construction here (not in `src/cli`) is what keeps the App Store Connect / Google Play / code-signing
 * dependencies out of the CLI layer, where only thin wiring belongs.
 */

import { join } from 'node:path';
import type {
  AndroidReleaseOptions,
  AppDescriptor,
  BuildProfile,
  LaunchConfig,
  ResolvedBuildContext,
} from '../types.js';
import { submitToStores } from '../pipeline.js';
import type { Logger } from '../logger.js';
import { loadActiveAscKey } from '../accounts.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import {
  appRecordMissingMessage,
  IOS_PLATFORM,
  pickCurrentVersion,
  readReleaseStatus,
  releaseApp,
  type ReleaseInput,
} from '../appStoreRelease.js';
import { GooglePlayClient, parseServiceAccount } from '../../google/playClient.js';
import { loadServiceAccount } from '../../google/credentials.js';
import { getCredentialsProvider } from '../registry.js';
import { ensureArtifactPresent, isCloudStorage, resolveStorageProvider } from '../storage.js';
import { ensureCodeSigner, type CodeSigner } from '../codeSign.js';
import { runWithProgress } from '../progress.js';
import { publishOtaPlatform, readExportMetadata } from '../otaPublish.js';
import { resolveReleaseType, resolveWhatsNew } from '../releaseInputs.js';
import { androidCarState, iosCarState } from './engine.js';
import type { TrainEngine } from './orchestrator.js';
import type { Car } from './types.js';

/** Memoized, lazy resolvers + the live {@link TrainEngine} for one run — clients are resolved only as a car needs them. */
export interface TrainRuntime {
  engine: TrainEngine;
}

/**
 * Build the live engine for an app: each method wraps an already-tested release primitive, and the store
 * clients / code signer resolve lazily (a `status` reconcile that only reads never touches the signer).
 * The iOS bundle id and Android package are present because cars are only created for declared platforms;
 * the per-method guards keep that explicit without a non-null assertion.
 */
export function buildTrainRuntime(
  config: LaunchConfig,
  app: AppDescriptor,
  profile: BuildProfile,
  env: Record<string, string>,
  hold: boolean,
  log: Logger,
): TrainRuntime {
  let ascClient: AppStoreConnectClient | undefined;
  let playClient: GooglePlayClient | undefined;
  let signer: CodeSigner | undefined;

  const asc = async (): Promise<AppStoreConnectClient> => {
    if (!ascClient) {
      const key = await loadActiveAscKey();
      if (!key) throw new Error('No active Apple account. Run `launch creds set-key` first.');
      ascClient = new AppStoreConnectClient(key);
    }
    return ascClient;
  };
  const play = async (): Promise<GooglePlayClient> => {
    if (!playClient) {
      const json = await loadServiceAccount();
      if (!json)
        throw new Error(
          'No Google Play service account configured. Run `launch creds set-key --platform android`.',
        );
      playClient = new GooglePlayClient(parseServiceAccount(json));
    }
    return playClient;
  };
  const codeSigner = async (): Promise<CodeSigner> =>
    (signer ??= await ensureCodeSigner(false, log));

  const bundleId = app.bundleId;
  const packageName = app.packageName;

  /** Submit the latest processed iOS build to App Store review (manual release when the train holds). */
  const submitIos = async (): Promise<{ buildId?: string }> => {
    if (!bundleId)
      throw new Error(`${app.name} has no iOS bundle id (ios.bundleIdentifier in app.json).`);
    const client = await asc();
    const appId = await client.getAppId(bundleId);
    if (!appId) throw new Error(appRecordMissingMessage(bundleId, 'launch release-train start'));
    const build =
      (await client.listBuilds(appId)).find((b) => b.processingState === 'VALID' && !b.expired) ??
      null;
    if (!build) {
      throw new Error(
        `No processed iOS build on App Store Connect for ${app.name}. Run \`launch build ios\` and upload it ` +
          `(\`launch testflight\` or \`launch release ios --no-wait\`) before starting the train.`,
      );
    }
    const versionString = app.version ?? (await client.getLatestMarketingVersion(bundleId));
    if (!versionString)
      throw new Error(
        `Could not determine a marketing version for ${app.name}. Set "version" in app.json.`,
      );
    // A holding train forces MANUAL (it releases every car together later); otherwise honor the configured
    // type — and when that's SCHEDULED, `resolveReleaseType` carries the `earliestReleaseDate` the submit needs.
    const { releaseType, earliestReleaseDate } = resolveReleaseType(config.release, {
      manual: hold,
    });
    const input: ReleaseInput = {
      bundleId,
      platform: IOS_PLATFORM,
      versionString,
      releaseType,
      ...(earliestReleaseDate ? { earliestReleaseDate } : {}),
      phasedRelease: config.release?.phasedRelease === true,
      usesNonExemptEncryption: config.release?.usesNonExemptEncryption ?? false,
      whatsNew: resolveWhatsNew(config.release, app.dir),
      build,
      dryRun: false,
    };
    await releaseApp(client, input);
    return { buildId: build.id };
  };

  /** Promote the latest stored Android artifact to the Play production track. */
  const submitAndroid = async (): Promise<{ buildId?: string }> => {
    if (!packageName)
      throw new Error(`${app.name} has no Android package (android.package in app.json).`);
    const latest = (await resolveStorageProvider(config).list()).find(
      (artifact) => artifact.appName === app.name && artifact.platform === 'android',
    );
    if (!latest)
      throw new Error(
        `No stored Android build for ${app.name}. Run \`launch build android\` first.`,
      );
    ensureArtifactPresent(latest, app.name, 'android');
    const android: AndroidReleaseOptions = { track: 'production', rollout: profile.rollout ?? 1.0 };
    const ctx: ResolvedBuildContext = {
      platform: 'android',
      app,
      profile,
      env,
      explain: false,
      dryRun: false,
      forceClean: false,
      android,
    };
    const credentials = await getCredentialsProvider(config.credentials).resolve(ctx);
    await submitToStores(config, 'android', latest.path, 'production', credentials, ctx);
    return { buildId: String(latest.buildNumber) };
  };

  /** Export the current JS and publish one OTA follower's manifest (its native platform is live). */
  const publishOta = async (
    car: Extract<Car, { kind: 'ota' }>,
  ): Promise<{ manifestId?: string }> => {
    if (!isCloudStorage(config))
      throw new Error('OTA needs a cloud storage provider (s3 / supabase).');
    const storage = resolveStorageProvider(config);
    const distDir = join(app.dir, 'dist');
    await runWithProgress('npx', ['expo', 'export', '--output-dir', distDir], {
      label: `Exporting JS bundle · ${app.name}`,
      cwd: app.dir,
      env,
    });
    const metadata = readExportMetadata(distDir);
    const result = await publishOtaPlatform(
      {
        storage,
        distDir,
        metadata,
        platform: car.platform,
        channel: car.channel,
        runtimeVersion: car.runtimeVersion,
        signer: await codeSigner(),
      },
      log,
    );
    return result.manifestId !== undefined ? { manifestId: result.manifestId } : {};
  };

  const engine: TrainEngine = {
    submitNative: (car) => (car.kind === 'ios' ? submitIos() : submitAndroid()),
    async readNative(car) {
      if (car.kind === 'ios') {
        if (!bundleId) return car.state;
        const status = await readReleaseStatus(await asc(), bundleId, IOS_PLATFORM);
        return iosCarState(status.verdict) ?? car.state;
      }
      if (!packageName) return car.state;
      const releases = await (await play()).getTrackReleases(packageName, 'production');
      return androidCarState(releases) ?? car.state;
    },
    async releaseNative(car) {
      // Android promotes to production on submit and exposes no developer-release gate — nothing to fire.
      if (car.kind !== 'ios' || !bundleId) return;
      const client = await asc();
      const appId = await client.getAppId(bundleId);
      if (!appId)
        throw new Error(appRecordMissingMessage(bundleId, 'launch release-train release'));
      const version = pickCurrentVersion(await client.listAppStoreVersions(appId, IOS_PLATFORM));
      if (version) await client.createAppStoreVersionReleaseRequest(version.id);
    },
    publishOta,
  };
  return { engine };
}
