import { FileSystem, Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import type { Platform } from '../types/app.js';
import type { AscKey, SigningAssets } from '../types/credentials.js';
import type { MutableDeep } from '../types/mutable.js';
import type { Logger } from '../services/logger.js';
import { adHocProfileType, appStoreProfileType, platformLabel } from '../services/platform.js';
import {
  resolveAccountCredentialsDirectory,
  resolveCredentialsDirectory,
  resolveProvisioningProfilesDirectory,
  type LaunchPathsService,
} from '../services/paths.js';
import { AppleCredentialsClientFactory } from '../services/appleCredentialsClient.js';
import type { ProfileResource } from '../types/appleCatalog.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import {
  CredentialsIndexSchema,
  makeAppleSigningFailure,
  readIndex,
  type AppleSigningFailure,
  type AppleSigningPlatform,
} from './appleSigningIndex.js';
import {
  DISTRIBUTION_CERT_NAME,
  ensureDistributionCertificate,
  p12PasswordAccount,
} from './appleSigningCerts.js';
import {
  ensureAppStoreProfileForBundle,
  ensureRegisteredBundleId,
  installProfile,
  profileStaleAgainstCapabilities,
  resolveProfileTeamId,
  staleCachedSigningTargets,
} from './appleSigningProfiles.js';

export type { AppleSigningFailure };
export { makeAppleSigningFailure, DISTRIBUTION_CERT_NAME, p12PasswordAccount };
export { profileStaleAgainstCapabilities, staleCachedSigningTargets };

/** Inputs for {@link ensureSigningCredentials}. */
export type EnsureSigningOptions = {
  platform: Platform;
  bundleId: string;
  appName: string;
  ascKey: AscKey;
  log: Logger;
  dryRun: boolean;
  confirmCreate: (message: string) => Effect.Effect<boolean, unknown>;
  extensions?: string[];
};

/** Summarize what signing material is cached locally for one account, for `launch creds status`. */
export const describeStoredCredentials = (
  keyId: string,
): Effect.Effect<
  {
    certSerial: string | null;
    bundleIds: string[];
  },
  never,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const index = yield* readIndex(keyId);
    let certSerial: string | null = null;
    if (index.certificate !== undefined) certSerial = index.certificate.serial;
    return {
      certSerial,
      bundleIds: Object.keys(index.profiles),
    };
  });

/**
 * Return cached signing assets for a bundle id without any network call - the build's silent-reuse
 * path. Null if anything is missing (no cert backup, no installed profile), which tells the caller
 * to run setup. Verifies the files actually exist, not just that metadata mentions them.
 *
 * `extensions` are the app's embedded extension bundle ids: every one must already have its own cached,
 * installed profile for the fast path to apply - if any is missing, this returns null so the build
 * re-provisions the whole set rather than exporting an `.ipa` that can't sign its widget/share target.
 * Each present extension's `bundleId -> profileName` is folded into {@link SigningAssets.extensionProfiles}.
 */
export const loadCachedSigningAssets = (
  keyId: string,
  bundleId: string,
  extensions: readonly string[] = [],
): Effect.Effect<
  SigningAssets | null,
  never,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const index = yield* readIndex(keyId);
    const cert = index.certificate;
    const profile = index.profiles[bundleId];
    if (!cert) return null;
    if (!profile) return null;
    const provisioningProfilesDirectory = yield* resolveProvisioningProfilesDirectory();
    const installedProfile = pathService.join(
      provisioningProfilesDirectory,
      `${profile.uuid}.mobileprovision`,
    );
    if (!(yield* fileSystem.exists(cert.p12Path).pipe(Effect.orElseSucceed(() => false))))
      return null;
    if (!(yield* fileSystem.exists(installedProfile).pipe(Effect.orElseSucceed(() => false))))
      return null;
    const extensionProfiles: Record<string, string> = {};
    for (const ext of extensions) {
      const extProfile = index.profiles[ext];
      if (!extProfile) return null;
      if (
        !(yield* fileSystem
          .exists(
            pathService.join(provisioningProfilesDirectory, `${extProfile.uuid}.mobileprovision`),
          )
          .pipe(Effect.orElseSucceed(() => false)))
      )
        return null;
      extensionProfiles[ext] = extProfile.name;
    }
    const signingAssets: MutableDeep<SigningAssets> = {
      bundleId,
      teamId: profile.teamId,
      certName: DISTRIBUTION_CERT_NAME,
      certSerial: cert.serial,
      profileName: profile.name,
      profileUuid: profile.uuid,
      profilePath: installedProfile,
    };
    if (extensions.length > 0) signingAssets.extensionProfiles = extensionProfiles;
    return signingAssets;
  });

/** A SigningAssets stand-in for `--dry-run`, so the rest of the pipeline can run unchanged. */
const dryRunAssets = (
  bundleId: string,
): Effect.Effect<SigningAssets, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const provisioningProfilesDirectory = yield* resolveProvisioningProfilesDirectory();
    return {
      bundleId,
      teamId: 'DRYRUNTEAM',
      certName: DISTRIBUTION_CERT_NAME,
      certSerial: 'DRYRUN000000',
      profileName: `Launch_${bundleId}_AppStore`,
      profileUuid: '00000000-0000-0000-0000-000000000000',
      profilePath: pathService.join(provisioningProfilesDirectory, 'dry-run.mobileprovision'),
    };
  });

/**
 * Resolve a bundle's signing assets, reusing what already exists and creating only what's missing.
 *
 * Order: ensure a usable distribution certificate (reuse the cached one if it still exists on Apple, else
 * create a fresh key/CSR/cert) -> for the main bundle and each {@link EnsureSigningOptions.extensions}
 * target, ensure its App ID and App Store profile (reuse by name, or recreate when a new cert was issued),
 * all signed by that one shared certificate. The cert is resolved first since every bundle shares it. Each
 * extension's `bundleId -> profileName` lands in {@link SigningAssets.extensionProfiles}. Every creation is
 * gated by {@link EnsureSigningOptions.confirmCreate}. Idempotent: a second run with everything in place
 * performs no writes and no creations.
 */
export const ensureSigningCredentials = (
  options: EnsureSigningOptions,
): Effect.Effect<
  SigningAssets,
  AppleSigningFailure | unknown,
  AppleCredentialsClientFactory | AppleSigningPlatform | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const { platform, bundleId, appName, ascKey, log, dryRun, confirmCreate } = options;
    let extensions = options.extensions;
    if (extensions === undefined) extensions = [];
    if (dryRun) {
      yield* log.note(
        `[dry-run] would ensure App ID, distribution certificate, and App Store profile for ${bundleId}`,
      );
      for (const ext of extensions) {
        yield* log.note(
          `[dry-run] would ensure App ID + App Store profile for extension ${ext} (same cert)`,
        );
      }
      const assets = yield* dryRunAssets(bundleId);
      if (extensions.length === 0) return assets;
      return {
        ...assets,
        extensionProfiles: Object.fromEntries(
          extensions.map((ext) => [ext, `Launch_${ext}_AppStore`]),
        ),
      };
    }
    const keyId = ascKey.keyId;
    const appleCredentialsClientFactory = yield* AppleCredentialsClientFactory;
    const client = yield* appleCredentialsClientFactory.createClient(ascKey);
    const index = yield* readIndex(keyId);
    // 1. Distribution certificate: reuse the cached one if Apple still lists it, else create one. One cert
    // signs every bundle in the team, so it's resolved once and shared by the main app and each extension.
    const { cert, freshCert } = yield* ensureDistributionCertificate({
      client,
      keyId,
      index,
      confirmCreate,
      log,
      importToKeychain: true,
      warnAtCertCap: true,
      createConfirmMessage:
        'Create a new distribution certificate (generates a private key on this Mac)?',
    });
    // 2. App ID + App Store profile for the main bundle (reuse by name unless a fresh cert was minted).
    const main = yield* ensureAppStoreProfileForBundle({
      client,
      keyId,
      index,
      platform,
      bundleId,
      appName,
      cert,
      freshCert,
      confirmCreate,
      log,
    });
    // 3. Each embedded extension: its own App ID + App Store profile, signed by the SAME cert. Collected
    // into the export-options map so xcodebuild signs every bundle in the .ipa, not just the main app.
    const extensionProfiles: Record<string, string> = {};
    for (const ext of extensions) {
      const provisioned = yield* ensureAppStoreProfileForBundle({
        client,
        keyId,
        index,
        platform,
        bundleId: ext,
        appName: `${appName} (extension)`,
        cert,
        freshCert,
        confirmCreate,
        log,
      });
      extensionProfiles[ext] = provisioned.profileName;
    }
    if (Object.keys(extensionProfiles).length === 0) return main;
    return { ...main, extensionProfiles };
  });

/**
 * Resolve signing assets for an ad-hoc (internal-distribution) build - the install-link twin of
 * {@link ensureSigningCredentials}.
 *
 * Same App ID + distribution certificate as the App Store path, but the profile is an `IOS_APP_ADHOC`
 * profile scoped to every registered, enabled device (so the resulting `.ipa` installs over the air on
 * those devices). Because an ad-hoc profile is only valid for the exact device set it was minted with,
 * this recreates the profile on every run rather than reusing a stale one - the cheap, always-correct
 * choice. Throws with an actionable message when no devices are registered (`launch device add`).
 */
export const ensureAdHocSigningCredentials = (
  options: EnsureSigningOptions,
): Effect.Effect<
  SigningAssets,
  AppleSigningFailure | unknown,
  AppleCredentialsClientFactory | AppleSigningPlatform | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const { platform, bundleId, appName, ascKey, log, dryRun, confirmCreate } = options;
    // macOS has no ad-hoc provisioning profile type in App Store Connect, so internal (install-link)
    // distribution doesn't apply to it. Fail loud and early - even in dry-run - rather than minting an
    // App Store profile that can't sign an ad-hoc build.
    const profileType = yield* adHocProfileType(platform).pipe(
      Effect.mapError((cause) =>
        makeAppleSigningFailure({
          message: `${platformLabel(platform)} has no ad-hoc provisioning profile. Submit to the store or choose another platform.`,
          cause,
        }),
      ),
    );
    if (profileType === undefined) {
      return yield* Effect.fail(
        makeAppleSigningFailure({
          message: `${platformLabel(platform)} has no ad-hoc provisioning profile. Submit to the store or choose another platform.`,
        }),
      );
    }
    if (dryRun) {
      yield* log.note(
        `[dry-run] would ensure App ID + distribution cert + an ad-hoc profile over registered devices for ${bundleId}`,
      );
      return { ...(yield* dryRunAssets(bundleId)), profileName: `Launch_${bundleId}_AdHoc` };
    }
    const keyId = ascKey.keyId;
    const appleCredentialsClientFactory = yield* AppleCredentialsClientFactory;
    const client = yield* appleCredentialsClientFactory.createClient(ascKey);
    const index = yield* readIndex(keyId);
    // 1. App ID - same prerequisite as the App Store path.
    const bundle = yield* ensureRegisteredBundleId({
      client,
      platform,
      bundleId,
      appName,
      confirmCreate,
      log,
      declineMessage: `App ID ${bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
    });
    // 2. Distribution certificate - reuse the cached one (importing the .p12) or create one.
    // Ad-hoc historically skips the cert-cap warning (devices fail first when the team is empty).
    const { cert } = yield* ensureDistributionCertificate({
      client,
      keyId,
      index,
      confirmCreate,
      log,
      importToKeychain: true,
      warnAtCertCap: false,
      createConfirmMessage:
        'Create a new distribution certificate (generates a private key on this Mac)?',
    });
    // 3. Every registered, enabled device goes on the profile (disabled devices don't count to Apple).
    const devices = (yield* client.listDevices()).filter((device) => device.status !== 'DISABLED');
    if (devices.length === 0) {
      return yield* Effect.fail(
        makeAppleSigningFailure({
          message:
            'No registered devices for an ad-hoc build. Add one with `launch device add <udid> [name]` and retry.',
        }),
      );
    }
    yield* log.step('devices', `${devices.length} registered device(s) on the ad-hoc profile`);
    // 4. Ad-hoc profile - recreate each run so it tracks the current device set exactly.
    const profileName = `Launch_${bundleId}_AdHoc`;
    const existing = yield* client.findProfileByName(profileName);
    if (existing) yield* client.deleteProfile(existing.id);
    const profile = yield* client.createAdHocProfile(
      profileName,
      bundle.id,
      cert.id,
      devices.map((device) => device.id),
      profileType,
    );
    const installed = yield* installProfile(keyId, `${bundleId}.adhoc`, profile.profileContent);
    yield* log.step('profile', `created ${profileName} (ad-hoc)`, 'provisioning-profile');
    const teamId = resolveProfileTeamId(installed.teamId, bundle.seedId);
    return {
      bundleId,
      teamId,
      certName: DISTRIBUTION_CERT_NAME,
      certSerial: cert.serial,
      profileName: installed.name,
      profileUuid: installed.uuid,
      profilePath: installed.installedPath,
    };
  });

/**
 * Local files + identifiers needed to sign on a REMOTE Mac, produced by {@link ensureRemoteSigningAssets}.
 *
 * The remote pipeline uploads `p12Path` and `profilePath` (plus the API `.p8`) into a throwaway
 * keychain on the host; `p12Password` unlocks the `.p12` there. `teamId`/`profileName`/`certName` feed
 * the host's manual-signing export options. The remote Mac re-reads the profile's UUID itself, so it
 * isn't carried here. Distinct from {@link SigningAssets} (which assumes a locally-installed profile).
 */
export type RemoteSigningBundle = {
  bundleId: string;
  certName: string;
  certSerial: string;
  teamId: string;
  profileName: string;
  p12Path: string;
  p12Password: string;
  profilePath: string;
};

/**
 * Resolve a bundle's signing assets for a REMOTE (off-Mac) build, leaving local files to upload.
 *
 * The cross-platform twin of {@link ensureSigningCredentials}: it ensures the same Apple resources
 * over the API and packages the distribution `.p12` locally with openssl (decision 7 - the private
 * key is born on your machine, never on rented infra), but it does NOT import anything into a local
 * codesign keychain or install the profile where a local Xcode looks - there is none. The remote Mac
 * imports the `.p12` into a throwaway keychain and reads the profile itself. Touches only the ASC API
 * and openssl, so it runs on Windows/Linux.
 */
export const ensureRemoteSigningAssets = (
  options: EnsureSigningOptions,
): Effect.Effect<
  RemoteSigningBundle,
  AppleSigningFailure | unknown,
  AppleCredentialsClientFactory | AppleSigningPlatform | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const { platform, bundleId, appName, ascKey, log, dryRun, confirmCreate } = options;
    if (dryRun) {
      const pathService = yield* Path.Path;
      const credentialsDirectory = yield* resolveAccountCredentialsDirectory(ascKey.keyId);
      yield* log.note(
        `[dry-run] would ensure App ID + distribution .p12 + App Store profile for ${bundleId}, ready to upload`,
      );
      return {
        bundleId,
        certName: DISTRIBUTION_CERT_NAME,
        certSerial: 'DRYRUN000000',
        teamId: 'DRYRUNTEAM',
        profileName: `Launch_${bundleId}_AppStore`,
        p12Path: pathService.join(credentialsDirectory, 'dry-run.p12'),
        p12Password: 'dry-run',
        profilePath: pathService.join(credentialsDirectory, 'dry-run.mobileprovision'),
      };
    }
    const keyId = ascKey.keyId;
    const appleCredentialsClientFactory = yield* AppleCredentialsClientFactory;
    const client = yield* appleCredentialsClientFactory.createClient(ascKey);
    const index = yield* readIndex(keyId);
    // 1. App ID must exist before a profile can reference it.
    const bundle = yield* ensureRegisteredBundleId({
      client,
      platform,
      bundleId,
      appName,
      confirmCreate,
      log,
      declineMessage: `App ID ${bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
    });
    // 2. Distribution cert as a local .p12 - reuse the cached one, else mint with openssl (no keychain import).
    const { cert, freshCert, password } = yield* ensureDistributionCertificate({
      client,
      keyId,
      index,
      confirmCreate,
      log,
      importToKeychain: false,
      warnAtCertCap: true,
      createConfirmMessage:
        'Create a new distribution certificate (generates a private key on this machine)?',
    });
    // 3. App Store profile - reuse by name unless a fresh cert was minted; save the bytes to upload.
    const profileName = `Launch_${bundleId}_AppStore`;
    const existingProfile = yield* client.findProfileByName(profileName);
    let profile: ProfileResource;
    if (existingProfile && !freshCert) {
      profile = existingProfile;
      yield* log.step('profile', `reusing ${profileName}`, 'provisioning-profile');
    } else {
      if (existingProfile) yield* client.deleteProfile(existingProfile.id);
      const profileType = yield* appStoreProfileType(platform);
      profile = yield* client.createAppStoreProfile(profileName, bundle.id, cert.id, profileType);
      yield* log.step('profile', `created ${profileName}`, 'provisioning-profile');
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    const profilePath = pathService.join(credentialsDirectory, `${bundleId}.mobileprovision`);
    yield* fileSystem.writeFile(profilePath, Buffer.from(profile.profileContent, 'base64'));
    let teamId = bundle.seedId;
    if (teamId === undefined) teamId = '';
    return {
      bundleId,
      certName: DISTRIBUTION_CERT_NAME,
      certSerial: cert.serial,
      teamId,
      profileName,
      p12Path: cert.p12Path,
      p12Password: password,
      profilePath,
    };
  });

/**
 * Move a pre-multi-account signing index (the flat `~/.launch/credentials/index.json` plus the `.p12`
 * and `.mobileprovision` files it references) into the per-account folder for `keyId`, rewriting the
 * stored paths so a later reuse still finds the cached `.p12` (and so doesn't burn an Apple cert slot
 * re-creating one). Best-effort and idempotent: a missing legacy index is a no-op, and a failed file
 * move just leaves that account to re-provision on its next build. Called once by the account-registry
 * migration; see `core/accounts.ts`.
 */
export const migrateLegacySigningIndex = (
  keyId: string,
): Effect.Effect<void, unknown, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const credentialsDirectory = yield* resolveCredentialsDirectory();
    const legacyIndexPath = pathService.join(credentialsDirectory, 'index.json');
    if (!(yield* fileSystem.exists(legacyIndexPath))) return;
    const index = yield* fileSystem.readFileString(legacyIndexPath).pipe(
      Effect.flatMap((indexText) => Effect.try(() => JSON.parse(indexText))),
      Effect.flatMap(Schema.decodeUnknown(CredentialsIndexSchema)),
      Effect.catchAll(() => Effect.succeed(null)),
    );
    if (index === null) return;
    const destinationDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    yield* fileSystem.makeDirectory(destinationDirectory, { recursive: true });
    const moveInto = (sourcePath: string | undefined): Effect.Effect<string | undefined, never> =>
      Effect.gen(function* () {
        if (sourcePath === undefined) return undefined;
        if (!(yield* fileSystem.exists(sourcePath).pipe(Effect.orElseSucceed(() => false))))
          return sourcePath;
        const destinationPath = pathService.join(
          destinationDirectory,
          pathService.basename(sourcePath),
        );
        return yield* fileSystem.rename(sourcePath, destinationPath).pipe(
          Effect.as(destinationPath),
          Effect.orElseSucceed(() => sourcePath),
        );
      });
    if (index.certificate) {
      const movedCertificatePath = yield* moveInto(index.certificate.p12Path);
      if (movedCertificatePath !== undefined) index.certificate.p12Path = movedCertificatePath;
    }
    yield* Effect.forEach(
      Object.values(index.profiles),
      (profileRecord) =>
        Effect.gen(function* () {
          const movedProfilePath = yield* moveInto(profileRecord.path);
          if (movedProfilePath !== undefined) profileRecord.path = movedProfilePath;
        }),
      { concurrency: 1, discard: true },
    );
    yield* fileSystem.writeFileString(
      pathService.join(destinationDirectory, 'index.json'),
      JSON.stringify(index, null, 2),
    );
    yield* fileSystem
      .remove(legacyIndexPath, { force: true })
      .pipe(Effect.catchAll(() => Effect.void));
  });
