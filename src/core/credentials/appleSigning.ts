import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import type { Platform } from '../types/app.js';
import type { AscKey, SigningAssets } from '../types/credentials.js';
import type { Logger } from '../services/logger.js';
import { captureCommandOutput } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import {
  adHocProfileType,
  appStoreProfileType,
  platformLabel,
  toBundleIdPlatform,
} from '../services/platform.js';
import { getSecret, setSecret } from './keychain.js';
import { staleProfileCapabilities } from './capabilities.js';
import {
  extractProfileEntitlements,
  type ProfileEntitlementRequirements,
} from '../adopt/profileEntitlements.js';
import {
  resolveAccountCredentialsDirectory,
  resolveCredentialsDirectory,
  resolveProvisioningProfilesDirectory,
  type LaunchPathsService,
} from '../services/paths.js';
import {
  AppleCredentialsClientFactory,
  type AppleCredentialsClient,
} from '../services/appleCredentialsClient.js';
import type { CertificateResource, ProfileResource } from '../types/appleCatalog.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { randomHexSecret } from './randomSecret.js';
import type { MutableDeep } from '../types/mutable.js';
/**
 * Keychain account holding the random password that protects an account's `.p12` backup, namespaced
 * by Key ID so each Apple account's `.p12` has its own password. Exported so first-run migration can
 * rename the legacy single-account entry (`dist-cert-p12-password`) onto this scheme.
 */
export const p12PasswordAccount = (keyId: string): string => {
  return `dist-cert-p12-password:${keyId}`;
};
/** Apple's distribution-certificate cap; creating past it fails, so warn first. */
const DISTRIBUTION_CERT_CAP = 2;
/** Xcode identity name used for App Store and ad-hoc distribution certificates. */
export const DISTRIBUTION_CERT_NAME = 'Apple Distribution';
/** Persisted record of the distribution certificate Launch created and backed up. */
type CertRecord = {
  id: string;
  serial: string;
  p12Path: string;
};
/** Persisted record of one bundle's App Store provisioning profile. */
type ProfileRecord = {
  id: string;
  uuid: string;
  name: string;
  path: string;
  teamId: string;
};
/** On-disk credential metadata (`~/.launch/credentials/index.json`). No secrets - paths + ids only. */
type CredentialsIndex = {
  certificate?: CertRecord;
  profiles: Record<string, ProfileRecord>;
};
type AppleSigningPlatform =
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | Path.Path;
const CertRecordSchema: Schema.Schema<CertRecord> = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    serial: Schema.String,
    p12Path: Schema.String,
  }),
);
const ProfileRecordSchema: Schema.Schema<ProfileRecord> = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    uuid: Schema.String,
    name: Schema.String,
    path: Schema.String,
    teamId: Schema.String,
  }),
);
const CredentialsIndexSchema: Schema.Schema<CredentialsIndex> = Schema.mutable(
  Schema.Struct({
    certificate: Schema.optionalWith(CertRecordSchema, { exact: true }),
    profiles: Schema.mutable(Schema.Record({ key: Schema.String, value: ProfileRecordSchema })),
  }),
);
const emptyCredentialsIndex = (): CredentialsIndex => ({ profiles: {} });
export type AppleSigningFailure = Readonly<{
  readonly _tag: 'AppleSigningFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeAppleSigningFailure = Data.tagged<AppleSigningFailure>('AppleSigningFailure');
/** Inputs for {@link ensureSigningCredentials}. */
export type EnsureSigningOptions = {
  platform: Platform;
  bundleId: string;
  appName: string;
  ascKey: AscKey;
  log: Logger;
  dryRun: boolean;
  confirmCreate: (message: string) => Effect.Effect<boolean, unknown>;
  extensions?: readonly string[];
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
/** Absolute path to one account's signing index. */
const indexPath = (keyId: string): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    return pathService.join(credentialsDirectory, 'index.json');
  });
/** Read an account's credentials index, tolerating a missing or malformed file. */
const readIndex = (
  keyId: string,
): Effect.Effect<CredentialsIndex, never, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsIndexPath = yield* indexPath(keyId);
    const indexExists = yield* fileSystem
      .exists(credentialsIndexPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!indexExists) return emptyCredentialsIndex();
    return yield* fileSystem.readFileString(credentialsIndexPath).pipe(
      Effect.flatMap((indexText) => Effect.try(() => JSON.parse(indexText))),
      Effect.flatMap(Schema.decodeUnknown(CredentialsIndexSchema)),
      Effect.orElseSucceed(emptyCredentialsIndex),
    );
  });
/** Write an account's credentials index back to disk. */
const writeIndex = (
  keyId: string,
  credentialsIndex: CredentialsIndex,
): Effect.Effect<void, unknown, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    const credentialsIndexPath = yield* indexPath(keyId);
    yield* fileSystem.writeFileString(
      credentialsIndexPath,
      JSON.stringify(credentialsIndex, null, 2),
    );
  });
/** Pull a single `<key>...</key><string>...</string>` value out of a provisioning profile's plist XML. */
const plistString = (xml: string, key: string): string | null => {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(xml);
  const matchedText = match?.[1];
  if (matchedText === undefined) return null;
  return matchedText;
};
/** Pull the first entry of a `<key>...</key><array><string>...</string>` value (e.g. TeamIdentifier). */
const plistFirstArrayString = (xml: string, key: string): string | null => {
  const match = new RegExp(`<key>${key}</key>\\s*<array>\\s*<string>([^<]+)</string>`).exec(xml);
  const matchedText = match?.[1];
  if (matchedText === undefined) return null;
  return matchedText;
};
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
/** Generate an RSA private key + certificate-signing request locally; returns the key path and CSR PEM. */
const generateKeypairAndCsr = (
  workDirectory: string,
): Effect.Effect<
  {
    keyPath: string;
    csrPem: string;
  },
  unknown,
  AppleSigningPlatform
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const keyPath = pathService.join(workDirectory, 'dist.key');
    const csrPath = pathService.join(workDirectory, 'dist.csr');
    yield* captureCommandOutput('openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      csrPath,
      '-subj',
      '/CN=Launch Distribution/O=Launch/C=US',
    ]);
    const csrPem = yield* fileSystem.readFileString(csrPath);
    return { keyPath, csrPem };
  });
/** Package the signed certificate + private key into a password-protected `.p12` backup. */
const packageP12 = (
  workDirectory: string,
  keyPath: string,
  certBase64: string,
  p12Path: string,
  password: string,
): Effect.Effect<void, unknown, AppleSigningPlatform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const cerPath = pathService.join(workDirectory, 'dist.cer');
    const certPemPath = pathService.join(workDirectory, 'dist.crt.pem');
    yield* fileSystem.writeFile(cerPath, Buffer.from(certBase64, 'base64'));
    yield* captureCommandOutput('openssl', [
      'x509',
      '-inform',
      'DER',
      '-in',
      cerPath,
      '-out',
      certPemPath,
    ]);
    yield* captureCommandOutput('openssl', [
      'pkcs12',
      '-export',
      '-inkey',
      keyPath,
      '-in',
      certPemPath,
      '-out',
      p12Path,
      '-passout',
      `pass:${password}`,
      '-name',
      DISTRIBUTION_CERT_NAME,
    ]);
    yield* fileSystem.chmod(p12Path, 0o600);
  });
/** Import a `.p12` into the login Keychain, pre-authorizing codesign. Ignores an already-present item. */
const importP12 = (
  p12Path: string,
  password: string,
): Effect.Effect<void, unknown, CommandExecutor | LaunchEnvironmentService> =>
  Effect.gen(function* () {
    const importAttempt = yield* captureCommandOutput('security', [
      'import',
      p12Path,
      '-P',
      password,
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/security',
      '-f',
      'pkcs12',
    ]).pipe(Effect.either);
    if (importAttempt._tag === 'Left' && !/already exists/i.test(String(importAttempt.left))) {
      return yield* Effect.fail(importAttempt.left);
    }
  });
/** Decode an installed profile to read its UUID, name, and Team ID (Xcode's manual-signing inputs). */
const readProfileMetadata = (
  profilePath: string,
): Effect.Effect<
  {
    uuid: string;
    name: string;
    teamId: string | null;
  },
  AppleSigningFailure | unknown,
  CommandExecutor | LaunchEnvironmentService
> =>
  Effect.gen(function* () {
    const xml = yield* captureCommandOutput('security', ['cms', '-D', '-i', profilePath]);
    const uuid = plistString(xml, 'UUID');
    const name = plistString(xml, 'Name');
    if (!uuid)
      return yield* Effect.fail(
        makeAppleSigningFailure({
          message: `Could not read UUID/Name from provisioning profile at ${profilePath}.`,
        }),
      );
    if (!name)
      return yield* Effect.fail(
        makeAppleSigningFailure({
          message: `Could not read UUID/Name from provisioning profile at ${profilePath}.`,
        }),
      );
    return { uuid, name, teamId: plistFirstArrayString(xml, 'TeamIdentifier') };
  });
/**
 * Decode the base64 profile content, install it where Xcode looks, and back it up per-account.
 * `backupName` is the backup filename base (without extension) - the App Store path passes the bundle
 * id; the ad-hoc path passes `<bundleId>.adhoc` so the two profiles for one bundle don't overwrite
 * each other's backup. (The installed copy is keyed by UUID, so it never collides regardless.)
 */
const installProfile = (
  keyId: string,
  backupName: string,
  profileContent: string,
): Effect.Effect<
  {
    uuid: string;
    name: string;
    teamId: string | null;
    installedPath: string;
  },
  AppleSigningFailure | unknown,
  AppleSigningPlatform
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    const backupPath = pathService.join(credentialsDirectory, `${backupName}.mobileprovision`);
    yield* fileSystem.writeFile(backupPath, Buffer.from(profileContent, 'base64'));
    const { uuid, name, teamId } = yield* readProfileMetadata(backupPath);
    const provisioningProfilesDirectory = yield* resolveProvisioningProfilesDirectory();
    yield* fileSystem.makeDirectory(provisioningProfilesDirectory, { recursive: true });
    const installedPath = pathService.join(
      provisioningProfilesDirectory,
      `${uuid}.mobileprovision`,
    );
    yield* fileSystem.copyFile(backupPath, installedPath);
    return { uuid, name, teamId, installedPath };
  });

/** Prefer the installed profile's team and fall back to the App ID team when absent. */
const resolveProfileTeamId = (
  installedTeamId: string | null,
  bundleTeamId: string | undefined,
): string => {
  if (installedTeamId !== null) return installedTeamId;
  if (bundleTeamId !== undefined) return bundleTeamId;
  return '';
};
/** Get (or create + persist) the random password that protects one account's `.p12` backup. */
const p12Password = (keyId: string): Effect.Effect<string, unknown, LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const account = p12PasswordAccount(keyId);
    const existing = yield* getSecret(account);
    if (existing) return existing;
    const password = yield* randomHexSecret(24);
    yield* setSecret(account, password);
    return password;
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
    const liveCerts = yield* client.listDistributionCertificates();
    const password = yield* p12Password(keyId);
    const reusable = yield* reusableCertificate(index, liveCerts);
    let cert: CertRecord;
    let freshCert = false;
    if (reusable) {
      cert = reusable;
      yield* importP12(cert.p12Path, password);
      yield* log.step(
        'certificate',
        `reusing distribution cert ${cert.serial}`,
        'distribution-certificate',
      );
    } else {
      if (liveCerts.length >= DISTRIBUTION_CERT_CAP) {
        yield* log.warn(
          `Apple already has ${liveCerts.length} distribution certificate(s) and none are Launch's. ` +
            `If creation fails, revoke an unused one in the Developer portal (Apple caps these).`,
        );
      }
      if (
        !(yield* confirmCreate(
          'Create a new distribution certificate (generates a private key on this Mac)?',
        ))
      ) {
        return yield* Effect.fail(
          makeAppleSigningFailure({
            message: 'No usable distribution certificate. Re-run and confirm to create one.',
          }),
        );
      }
      cert = yield* createAndStoreCertificate(client, password, keyId);
      freshCert = true;
      index.certificate = cert;
      yield* writeIndex(keyId, index);
      yield* log.step(
        'certificate',
        `created distribution cert ${cert.serial}`,
        'distribution-certificate',
      );
    }
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
/** Inputs for {@link ensureAppStoreProfileForBundle} - one bundle's App ID + App Store profile step. */
type EnsureProfileForBundleOptions = {
  client: AppleCredentialsClient;
  keyId: string;
  index: CredentialsIndex;
  platform: Platform;
  bundleId: string;
  appName: string;
  cert: CertRecord;
  freshCert: boolean;
  confirmCreate: (message: string) => Effect.Effect<boolean, unknown>;
  log: Logger;
};
export const profileStaleAgainstCapabilities = (
  client: Pick<AppleCredentialsClient, 'listBundleIdCapabilities'>,
  bundleIdResourceId: string,
  profile: ProfileResource,
): Effect.Effect<string[], unknown, ProfileEntitlementRequirements> =>
  Effect.gen(function* () {
    const enabledCapabilities = yield* client.listBundleIdCapabilities(bundleIdResourceId);
    const enabled = enabledCapabilities.map((capability) => capability.capabilityType);
    const profileEntitlements = yield* extractProfileEntitlements(profile.profileContent);
    return staleProfileCapabilities(enabled, profileEntitlements);
  });
export const staleCachedSigningTargets = (
  client: Pick<
    AppleCredentialsClient,
    'findBundleId' | 'findProfileByName' | 'listBundleIdCapabilities'
  >,
  signing: SigningAssets,
): Effect.Effect<
  {
    bundleId: string;
    missing: string[];
  }[],
  never,
  ProfileEntitlementRequirements
> =>
  Effect.gen(function* () {
    let extensionProfiles = signing.extensionProfiles;
    if (extensionProfiles === undefined) extensionProfiles = {};
    const targets = [
      { bundleId: signing.bundleId, profileName: signing.profileName },
      ...Object.entries(extensionProfiles).map(([bundleId, profileName]) => ({
        bundleId,
        profileName,
      })),
    ];
    const graded = yield* Effect.forEach(
      targets,
      ({ bundleId, profileName }) =>
        Effect.gen(function* () {
          const bundle = yield* client.findBundleId(bundleId);
          if (!bundle) return null;
          const profile = yield* client.findProfileByName(profileName);
          if (!profile) return null;
          const missing = yield* profileStaleAgainstCapabilities(client, bundle.id, profile);
          if (missing.length > 0) return { bundleId, missing };
          return null;
        }).pipe(Effect.catchAll(() => Effect.succeed(null))),
      { concurrency: 'unbounded' },
    );
    return graded.filter(
      (
        target,
      ): target is {
        bundleId: string;
        missing: string[];
      } => target !== null,
    );
  });
/**
 * Ensure one bundle id's App ID + App Store provisioning profile against a shared distribution cert,
 * install the profile where Xcode looks, and record it in the account index. The per-bundle unit reused
 * by {@link ensureSigningCredentials} for the main app and each embedded extension - both follow the
 * identical App ID -> App Store profile path; only the certificate (one per team) is shared between them.
 * Returns the local {@link SigningAssets} for the bundle.
 */
const ensureAppStoreProfileForBundle = (
  options: EnsureProfileForBundleOptions,
): Effect.Effect<SigningAssets, AppleSigningFailure | unknown, AppleSigningPlatform> =>
  Effect.gen(function* () {
    const {
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
    } = options;
    // App ID must be registered before a profile can reference it.
    let bundle = yield* client.findBundleId(bundleId);
    if (!bundle) {
      if (!(yield* confirmCreate(`Register App ID "${bundleId}" in your Apple account?`))) {
        return yield* Effect.fail(
          makeAppleSigningFailure({
            message: `App ID ${bundleId} is not registered. Re-run and confirm, or register it in the Developer portal.`,
          }),
        );
      }
      const bundleIdPlatform = yield* toBundleIdPlatform(platform);
      bundle = yield* client.createBundleId(bundleId, appName, bundleIdPlatform);
      yield* log.step('app id', `registered ${bundleId}`, 'bundle-id');
    } else {
      yield* log.step('app id', `${bundleId} already registered`, 'bundle-id');
    }
    // App Store profile: reuse by name unless we just minted a new cert (then recreate to match it) OR the
    // cached profile predates a capability now enabled on the App ID (issue #261 - App Groups was turned on
    // after the profile was minted, so the reused profile omits the entitlement and xcodebuild exits 65).
    // Space-free name so it passes safely through xcodebuild's PROVISIONING_PROFILE_SPECIFIER setting.
    const profileName = `Launch_${bundleId}_AppStore`;
    const existingProfile = yield* client.findProfileByName(profileName);
    let staleCapabilities: string[] = [];
    if (existingProfile && !freshCert) {
      staleCapabilities = yield* profileStaleAgainstCapabilities(
        client,
        bundle.id,
        existingProfile,
      );
    }
    let profile: ProfileResource;
    if (existingProfile && !freshCert && staleCapabilities.length === 0) {
      profile = existingProfile;
      yield* log.step('profile', `reusing ${profileName}`, 'provisioning-profile');
    } else {
      if (existingProfile) yield* client.deleteProfile(existingProfile.id);
      const profileType = yield* appStoreProfileType(platform);
      profile = yield* client.createAppStoreProfile(profileName, bundle.id, cert.id, profileType);
      let reason = `created ${profileName}`;
      if (staleCapabilities.length)
        reason = `regenerated ${profileName} (was missing ${staleCapabilities.join(', ')})`;
      yield* log.step('profile', reason, 'provisioning-profile');
    }
    const installed = yield* installProfile(keyId, bundleId, profile.profileContent);
    const teamId = resolveProfileTeamId(installed.teamId, bundle.seedId);
    index.profiles[bundleId] = {
      id: profile.id,
      uuid: installed.uuid,
      name: installed.name,
      path: installed.installedPath,
      teamId,
    };
    yield* writeIndex(keyId, index);
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
    let bundle = yield* client.findBundleId(bundleId);
    if (!bundle) {
      if (!(yield* confirmCreate(`Register App ID "${bundleId}" in your Apple account?`))) {
        return yield* Effect.fail(
          makeAppleSigningFailure({
            message: `App ID ${bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
          }),
        );
      }
      const bundleIdPlatform = yield* toBundleIdPlatform(platform);
      bundle = yield* client.createBundleId(bundleId, appName, bundleIdPlatform);
      yield* log.step('app id', `registered ${bundleId}`, 'bundle-id');
    } else {
      yield* log.step('app id', `${bundleId} already registered`, 'bundle-id');
    }
    // 2. Distribution certificate - reuse the cached one (importing the .p12) or create one.
    const liveCerts = yield* client.listDistributionCertificates();
    const password = yield* p12Password(keyId);
    const reusable = yield* reusableCertificate(index, liveCerts);
    let cert: CertRecord;
    if (reusable) {
      cert = reusable;
      yield* importP12(cert.p12Path, password);
      yield* log.step(
        'certificate',
        `reusing distribution cert ${cert.serial}`,
        'distribution-certificate',
      );
    } else {
      if (
        !(yield* confirmCreate(
          'Create a new distribution certificate (generates a private key on this Mac)?',
        ))
      ) {
        return yield* Effect.fail(
          makeAppleSigningFailure({
            message: 'No usable distribution certificate. Re-run and confirm to create one.',
          }),
        );
      }
      cert = yield* createAndStoreCertificate(client, password, keyId);
      index.certificate = cert;
      yield* writeIndex(keyId, index);
      yield* log.step(
        'certificate',
        `created distribution cert ${cert.serial}`,
        'distribution-certificate',
      );
    }
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
    let bundle = yield* client.findBundleId(bundleId);
    if (!bundle) {
      if (!(yield* confirmCreate(`Register App ID "${bundleId}" in your Apple account?`))) {
        return yield* Effect.fail(
          makeAppleSigningFailure({
            message: `App ID ${bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
          }),
        );
      }
      const bundleIdPlatform = yield* toBundleIdPlatform(platform);
      bundle = yield* client.createBundleId(bundleId, appName, bundleIdPlatform);
      yield* log.step('app id', `registered ${bundleId}`, 'bundle-id');
    } else {
      yield* log.step('app id', `${bundleId} already registered`, 'bundle-id');
    }
    // 2. Distribution cert as a local .p12 - reuse the cached one, else mint with openssl (no keychain import).
    const liveCerts = yield* client.listDistributionCertificates();
    const password = yield* p12Password(keyId);
    const reusable = yield* reusableCertificate(index, liveCerts);
    let cert: CertRecord;
    let freshCert = false;
    if (reusable) {
      cert = reusable;
      yield* log.step(
        'certificate',
        `reusing distribution cert ${cert.serial}`,
        'distribution-certificate',
      );
    } else {
      if (liveCerts.length >= DISTRIBUTION_CERT_CAP) {
        yield* log.warn(
          `Apple already has ${liveCerts.length} distribution certificate(s) and none are Launch's. ` +
            `If creation fails, revoke an unused one in the Developer portal (Apple caps these).`,
        );
      }
      if (
        !(yield* confirmCreate(
          'Create a new distribution certificate (generates a private key on this machine)?',
        ))
      ) {
        return yield* Effect.fail(
          makeAppleSigningFailure({
            message: 'No usable distribution certificate. Re-run and confirm to create one.',
          }),
        );
      }
      cert = yield* createCertificateForUpload(client, password, keyId);
      freshCert = true;
      index.certificate = cert;
      yield* writeIndex(keyId, index);
      yield* log.step(
        'certificate',
        `created distribution cert ${cert.serial}`,
        'distribution-certificate',
      );
    }
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
/** Mint a distribution cert + local `.p12` for upload, WITHOUT importing it into a local keychain. */
const createCertificateForUpload = (
  client: AppleCredentialsClient,
  password: string,
  keyId: string,
): Effect.Effect<CertRecord, unknown, AppleSigningPlatform> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const workDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-cert-' });
      const { keyPath, csrPem } = yield* generateKeypairAndCsr(workDirectory);
      const created = yield* client.createCertificate(csrPem);
      const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
      yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
      const p12Path = pathService.join(credentialsDirectory, `dist-${created.serialNumber}.p12`);
      yield* packageP12(workDirectory, keyPath, created.certificateContent, p12Path, password);
      return { id: created.id, serial: created.serialNumber, p12Path };
    }),
  );
/** A cached cert is reusable only if Apple still lists its serial and the local `.p12` backup exists. */
const reusableCertificate = (
  index: CredentialsIndex,
  liveCerts: readonly CertificateResource[],
): Effect.Effect<CertRecord | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cached = index.certificate;
    if (!cached) return null;
    if (!(yield* fileSystem.exists(cached.p12Path).pipe(Effect.orElseSucceed(() => false))))
      return null;
    if (liveCerts.some((certificate) => certificate.serialNumber === cached.serial)) return cached;
    return null;
  });
/** Generate a key/CSR, ask Apple to sign it, and package + back up the `.p12`. Returns the record. */
const createAndStoreCertificate = (
  client: AppleCredentialsClient,
  password: string,
  keyId: string,
): Effect.Effect<CertRecord, unknown, AppleSigningPlatform> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const workDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-cert-' });
      const { keyPath, csrPem } = yield* generateKeypairAndCsr(workDirectory);
      const created = yield* client.createCertificate(csrPem);
      const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
      yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
      const p12Path = pathService.join(credentialsDirectory, `dist-${created.serialNumber}.p12`);
      yield* packageP12(workDirectory, keyPath, created.certificateContent, p12Path, password);
      yield* importP12(p12Path, password);
      return { id: created.id, serial: created.serialNumber, p12Path };
    }),
  );
/**
 * Move a pre-multi-account signing index (the flat `~/.launch/credentials/index.json` plus the `.p12`
 * and `.mobileprovision` files it references) into the per-account folder for `keyId`, rewriting the
 * stored paths so {@link reusableCertificate} still finds the cached `.p12` (and so doesn't burn an
 * Apple cert slot re-creating one). Best-effort and idempotent: a missing legacy index is a no-op, and
 * a failed file move just leaves that account to re-provision on its next build. Called once by the
 * account-registry migration; see `core/accounts.ts`.
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
