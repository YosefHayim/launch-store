import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Effect } from 'effect';
import type { Platform } from '../types/app.js';
import type { SigningAssets } from '../types/credentials.js';
import type { Logger } from '../services/logger.js';
import { captureCommandOutput } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { appStoreProfileType, toBundleIdPlatform } from '../services/platform.js';
import {
  resolveAccountCredentialsDirectory,
  resolveProvisioningProfilesDirectory,
} from '../services/paths.js';
import type { AppleCredentialsClient } from '../services/appleCredentialsClient.js';
import type { BundleIdResource, ProfileResource } from '../types/appleCatalog.js';
import { staleProfileCapabilities } from './capabilities.js';
import {
  extractProfileEntitlements,
  type ProfileEntitlementRequirements,
} from '../adopt/profileEntitlements.js';
import {
  makeAppleSigningFailure,
  type AppleSigningFailure,
  type AppleSigningPlatform,
  type CertRecord,
  type CredentialsIndex,
  writeIndex,
} from './appleSigningIndex.js';
import { DISTRIBUTION_CERT_NAME } from './appleSigningCerts.js';

/** Pull a single `<key>...</key><string>...</string>` value out of a provisioning profile's plist XML. */
const plistString = (xml: string, key: string): string | null => {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(xml);
  if (match === null) return null;
  const matchedText = match[1];
  if (matchedText === undefined) return null;
  return matchedText;
};

/** Pull the first entry of a `<key>...</key><array><string>...</string>` value (e.g. TeamIdentifier). */
const plistFirstArrayString = (xml: string, key: string): string | null => {
  const match = new RegExp(`<key>${key}</key>\\s*<array>\\s*<string>([^<]+)</string>`).exec(xml);
  if (match === null) return null;
  const matchedText = match[1];
  if (matchedText === undefined) return null;
  return matchedText;
};

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
export const installProfile = (
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
export const resolveProfileTeamId = (
  installedTeamId: string | null,
  bundleTeamId: string | undefined,
): string => {
  if (installedTeamId !== null) return installedTeamId;
  if (bundleTeamId !== undefined) return bundleTeamId;
  return '';
};

/** Inputs for {@link ensureRegisteredBundleId} - one App ID ensure step. */
export type EnsureRegisteredBundleIdOptions = {
  client: AppleCredentialsClient;
  platform: Platform;
  bundleId: string;
  appName: string;
  confirmCreate: (message: string) => Effect.Effect<boolean, unknown>;
  log: Logger;
  /** Portal vs Developer portal wording when the user declines registration. */
  declineMessage: string;
};

/**
 * Ensure the App ID exists in App Store Connect before a profile can reference it. Shared by
 * App Store, ad-hoc, and remote signing paths.
 */
export const ensureRegisteredBundleId = (
  options: EnsureRegisteredBundleIdOptions,
): Effect.Effect<BundleIdResource, AppleSigningFailure | unknown, AppleSigningPlatform> =>
  Effect.gen(function* () {
    const { client, platform, bundleId, appName, confirmCreate, log, declineMessage } = options;
    const existingBundle = yield* client.findBundleId(bundleId);
    if (existingBundle) {
      yield* log.step('app id', `${bundleId} already registered`, 'bundle-id');
      return existingBundle;
    }
    if (!(yield* confirmCreate(`Register App ID "${bundleId}" in your Apple account?`))) {
      return yield* Effect.fail(
        makeAppleSigningFailure({
          message: declineMessage,
        }),
      );
    }
    const bundleIdPlatform = yield* toBundleIdPlatform(platform);
    const createdBundle = yield* client.createBundleId(bundleId, appName, bundleIdPlatform);
    yield* log.step('app id', `registered ${bundleId}`, 'bundle-id');
    return createdBundle;
  });

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

/** Inputs for {@link ensureAppStoreProfileForBundle} - one bundle's App ID + App Store profile step. */
export type EnsureProfileForBundleOptions = {
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

/**
 * Ensure one bundle id's App ID + App Store provisioning profile against a shared distribution cert,
 * install the profile where Xcode looks, and record it in the account index. The per-bundle unit reused
 * by the main app and each embedded extension - both follow the identical App ID -> App Store profile
 * path; only the certificate (one per team) is shared between them. Returns the local
 * {@link SigningAssets} for the bundle.
 */
export const ensureAppStoreProfileForBundle = (
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
    const bundle = yield* ensureRegisteredBundleId({
      client,
      platform,
      bundleId,
      appName,
      confirmCreate,
      log,
      declineMessage: `App ID ${bundleId} is not registered. Re-run and confirm, or register it in the Developer portal.`,
    });
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
