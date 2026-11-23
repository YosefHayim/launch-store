import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractProfileEntitlements } from '../adopt/profile-entitlements.ts';
import { captureCommandOutput } from '../services/platform/exec.ts';
import type { Logger } from '../services/platform/logger.ts';
import {
  resolveAccountCredentialsDirectory,
  resolveProvisioningProfilesDirectory,
} from '../services/platform/paths.ts';
import type { AppleCredentialsClient } from '../services/stores/apple-credentials-client.ts';
import { appStoreProfileType, readBundleIdPlatform } from '../services/stores/platform.ts';
import type { Platform } from '../types/app.ts';
import type { BundleIdResource, ProfileResource } from '../types/apple-catalog.ts';
import type { SigningAssets } from '../types/credentials.ts';
import { staleProfileCapabilities } from './capabilities.ts';
import { DISTRIBUTION_CERT_NAME } from './apple-signing-certs.ts';
import {
  makeAppleSigningFailure,
  type AppleSigningFailure,
  type CertRecord,
  type CredentialsIndex,
  writeIndex,
} from './apple-signing-index.ts';

/** Pull a single `<key>...</key><string>...</string>` value out of a provisioning profile's plist XML. */
function plistString(xml: string, key: string): string | null {
  // The string stored immediately under one plist key.
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(xml);

  if (match == null) {
    return null;
  }

  const matchedText = match[1];

  if (matchedText == null) {
    return null;
  }

  return matchedText;
}

/** Pull the first entry of a `<key>...</key><array><string>...</string>` value (e.g. TeamIdentifier). */
function plistFirstArrayString(xml: string, key: string): string | null {
  // The first string inside the array stored under one plist key.
  const match = new RegExp(`<key>${key}</key>\\s*<array>\\s*<string>([^<]+)</string>`).exec(xml);

  if (match == null) {
    return null;
  }

  const matchedText = match[1];

  if (matchedText == null) {
    return null;
  }

  return matchedText;
}

function missingProfileMetadata(profilePath: string): AppleSigningFailure {
  return makeAppleSigningFailure({
    message: `Could not read UUID/Name from provisioning profile at ${profilePath}.`,
  });
}

/** Decode an installed profile to read its UUID, name, and Team ID (Xcode's manual-signing inputs). */
async function readProfileMetadata(profilePath: string): Promise<{
  uuid: string;
  name: string;
  teamId: string | null;
}> {
  const xml = await captureCommandOutput('security', ['cms', '-D', '-i', profilePath]);
  const uuid = plistString(xml, 'UUID');
  const name = plistString(xml, 'Name');

  if (uuid == null) {
    throw missingProfileMetadata(profilePath);
  }

  if (uuid == '') {
    throw missingProfileMetadata(profilePath);
  }

  if (name == null) {
    throw missingProfileMetadata(profilePath);
  }

  if (name == '') {
    throw missingProfileMetadata(profilePath);
  }

  return { uuid, name, teamId: plistFirstArrayString(xml, 'TeamIdentifier') };
}

/**
 * Decode the base64 profile content, install it where Xcode looks, and back it up per-account.
 * `backupName` is the backup filename base (without extension) - the App Store path passes the bundle
 * id; the ad-hoc path passes `<bundleId>.adhoc` so the two profiles for one bundle don't overwrite
 * each other's backup. (The installed copy is keyed by UUID, so it never collides regardless.)
 */
export async function installProfile(
  keyId: string,
  backupName: string,
  profileContent: string,
): Promise<{
  uuid: string;
  name: string;
  teamId: string | null;
  installedPath: string;
}> {
  const credentialsDirectory = resolveAccountCredentialsDirectory(keyId);
  await mkdir(credentialsDirectory, { recursive: true });
  const backupPath = join(credentialsDirectory, `${backupName}.mobileprovision`);
  const bufferBytes = Buffer.from(profileContent, 'base64');
  await writeFile(backupPath, bufferBytes);
  const profileMetadata = await readProfileMetadata(backupPath);
  const provisioningProfilesDirectory = resolveProvisioningProfilesDirectory();
  await mkdir(provisioningProfilesDirectory, { recursive: true });
  const installedPath = join(
    provisioningProfilesDirectory,
    `${profileMetadata.uuid}.mobileprovision`,
  );
  await copyFile(backupPath, installedPath);

  return {
    uuid: profileMetadata.uuid,
    name: profileMetadata.name,
    teamId: profileMetadata.teamId,
    installedPath,
  };
}

/** Prefer the installed profile's team and fall back to the App ID team when absent. */
export function resolveProfileTeamId(
  installedTeamId: string | null,
  bundleTeamId: string | undefined,
): string {
  if (installedTeamId != null) {
    return installedTeamId;
  }

  if (bundleTeamId != null) {
    return bundleTeamId;
  }

  return '';
}

/** Inputs for {@link ensureRegisteredBundleId} - one App ID ensure step. */
type EnsureRegisteredBundleIdOptions = {
  client: AppleCredentialsClient;
  platform: Platform;
  bundleId: string;
  appName: string;
  confirmCreate: (message: string) => Promise<boolean>;
  log: Logger;
  /** Portal vs Developer portal wording when the user declines registration. */
  declineMessage: string;
};

/**
 * Ensure the App ID exists in App Store Connect before a profile can reference it. Shared by
 * App Store, ad-hoc, and remote signing paths.
 */
export async function ensureRegisteredBundleId(
  bundleOptions: EnsureRegisteredBundleIdOptions,
): Promise<BundleIdResource> {
  const existingBundle = await bundleOptions.client.findBundleId(bundleOptions.bundleId);

  if (existingBundle != null) {
    bundleOptions.log.step('app id', `${bundleOptions.bundleId} already registered`, 'bundle-id');

    return existingBundle;
  }

  const isRegistrationConfirmed = await bundleOptions.confirmCreate(
    `Register App ID "${bundleOptions.bundleId}" in your Apple account?`,
  );

  if (isRegistrationConfirmed == false) {
    throw makeAppleSigningFailure({ message: bundleOptions.declineMessage });
  }

  const bundleIdPlatform = readBundleIdPlatform(bundleOptions.platform);
  const createdBundle = await bundleOptions.client.createBundleId(
    bundleOptions.bundleId,
    bundleOptions.appName,
    bundleIdPlatform,
  );
  bundleOptions.log.step('app id', `registered ${bundleOptions.bundleId}`, 'bundle-id');

  return createdBundle;
}

export async function profileStaleAgainstCapabilities(
  client: Pick<AppleCredentialsClient, 'listBundleIdCapabilities'>,
  bundleIdResourceId: string,
  profile: ProfileResource,
): Promise<string[]> {
  const enabledCapabilities = await client.listBundleIdCapabilities(bundleIdResourceId);

  function capabilityTypeOf(capability: { capabilityType: string }): string {
    return capability.capabilityType;
  }

  const enabled = enabledCapabilities.map(capabilityTypeOf);
  const profileEntitlements = await extractProfileEntitlements(profile.profileContent);

  return staleProfileCapabilities(enabled, profileEntitlements);
}

type StaleSigningTarget = {
  bundleId: string;
  missing: string[];
};

export async function staleCachedSigningTargets(
  client: Pick<
    AppleCredentialsClient,
    'findBundleId' | 'findProfileByName' | 'listBundleIdCapabilities'
  >,
  signing: SigningAssets,
): Promise<StaleSigningTarget[]> {
  let extensionProfiles: Record<string, string> = {};

  if (signing.extensionProfiles != null) {
    extensionProfiles = signing.extensionProfiles;
  }

  const targets = [
    { bundleId: signing.bundleId, profileName: signing.profileName },
    ...Object.entries(extensionProfiles).map(function extensionTarget([bundleId, profileName]: [
      string,
      string,
    ]) {
      return { bundleId, profileName };
    }),
  ];

  async function gradeTarget(target: {
    bundleId: string;
    profileName: string;
  }): Promise<StaleSigningTarget | null> {
    try {
      const bundle = await client.findBundleId(target.bundleId);

      if (bundle == null) {
        return null;
      }

      const profile = await client.findProfileByName(target.profileName);

      if (profile == null) {
        return null;
      }

      const missing = await profileStaleAgainstCapabilities(client, bundle.id, profile);
      const isCurrent = missing.length == 0;

      if (isCurrent) {
        return null;
      }

      return { bundleId: target.bundleId, missing };
    } catch (error) {
      const isUnavailable = error != null;

      if (isUnavailable) {
        return null;
      }

      return null;
    }
  }

  const graded = await Promise.all(targets.map(gradeTarget));

  function isStaleTarget(target: StaleSigningTarget | null): target is StaleSigningTarget {
    return target != null;
  }

  return graded.filter(isStaleTarget);
}

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
  confirmCreate: (message: string) => Promise<boolean>;
  log: Logger;
};

function shouldInspectStaleCapabilities(
  existingProfile: ProfileResource | null,
  freshCert: boolean,
): existingProfile is ProfileResource {
  if (existingProfile == null) {
    return false;
  }

  return freshCert == false;
}

function canReuseProfile(
  existingProfile: ProfileResource | null,
  freshCert: boolean,
  staleCapabilityCount: number,
): existingProfile is ProfileResource {
  if (shouldInspectStaleCapabilities(existingProfile, freshCert) == false) {
    return false;
  }

  return staleCapabilityCount == 0;
}

/**
 * Ensure one bundle id's App ID + App Store provisioning profile against a shared distribution cert,
 * install the profile where Xcode looks, and record it in the account index. The per-bundle unit reused
 * by the main app and each embedded extension - both follow the identical App ID -> App Store profile
 * path; only the certificate (one per team) is shared between them. Returns the local
 * {@link SigningAssets} for the bundle.
 */
export async function ensureAppStoreProfileForBundle(
  profileOptions: EnsureProfileForBundleOptions,
): Promise<SigningAssets> {
  const bundle = await ensureRegisteredBundleId({
    client: profileOptions.client,
    platform: profileOptions.platform,
    bundleId: profileOptions.bundleId,
    appName: profileOptions.appName,
    confirmCreate: profileOptions.confirmCreate,
    log: profileOptions.log,
    declineMessage: `App ID ${profileOptions.bundleId} is not registered. Re-run and confirm, or register it in the Developer portal.`,
  });
  // App Store profile: reuse by name unless we just minted a new cert (then recreate to match it) OR the
  // cached profile predates a capability now enabled on the App ID (issue #261 - App Groups was turned on
  // after the profile was minted, so the reused profile omits the entitlement and xcodebuild exits 65).
  // Space-free name so it passes safely through xcodebuild's PROVISIONING_PROFILE_SPECIFIER setting.
  const profileName = `Launch_${profileOptions.bundleId}_AppStore`;
  const existingProfile = await profileOptions.client.findProfileByName(profileName);
  let staleCapabilities: string[] = [];

  if (shouldInspectStaleCapabilities(existingProfile, profileOptions.freshCert)) {
    staleCapabilities = await profileStaleAgainstCapabilities(
      profileOptions.client,
      bundle.id,
      existingProfile,
    );
  }

  const profile = await resolveAppStoreProfile({
    profileOptions,
    bundleIdResourceId: bundle.id,
    profileName,
    existingProfile,
    staleCapabilities,
  });
  const installed = await installProfile(
    profileOptions.keyId,
    profileOptions.bundleId,
    profile.profileContent,
  );
  const teamId = resolveProfileTeamId(installed.teamId, bundle.seedId);

  profileOptions.index.profiles[profileOptions.bundleId] = {
    id: profile.id,
    uuid: installed.uuid,
    name: installed.name,
    path: installed.installedPath,
    teamId,
  };
  await writeIndex(profileOptions.keyId, profileOptions.index);

  return {
    bundleId: profileOptions.bundleId,
    teamId,
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: profileOptions.cert.serial,
    profileName: installed.name,
    profileUuid: installed.uuid,
    profilePath: installed.installedPath,
  };
}

async function resolveAppStoreProfile(profileRequest: {
  profileOptions: EnsureProfileForBundleOptions;
  bundleIdResourceId: string;
  profileName: string;
  existingProfile: ProfileResource | null;
  staleCapabilities: string[];
}): Promise<ProfileResource> {
  const existingProfile = profileRequest.existingProfile;

  if (
    canReuseProfile(
      existingProfile,
      profileRequest.profileOptions.freshCert,
      profileRequest.staleCapabilities.length,
    )
  ) {
    profileRequest.profileOptions.log.step(
      'profile',
      `reusing ${profileRequest.profileName}`,
      'provisioning-profile',
    );

    return existingProfile;
  }

  if (profileRequest.existingProfile != null) {
    await profileRequest.profileOptions.client.deleteProfile(profileRequest.existingProfile.id);
  }

  const profileType = appStoreProfileType(profileRequest.profileOptions.platform);
  const profile = await profileRequest.profileOptions.client.createAppStoreProfile(
    profileRequest.profileName,
    profileRequest.bundleIdResourceId,
    profileRequest.profileOptions.cert.id,
    profileType,
  );
  let reason = `created ${profileRequest.profileName}`;
  const hasStaleCapabilities = profileRequest.staleCapabilities.length > 0;

  if (hasStaleCapabilities) {
    reason = `regenerated ${profileRequest.profileName} (was missing ${profileRequest.staleCapabilities.join(', ')})`;
  }

  profileRequest.profileOptions.log.step('profile', reason, 'provisioning-profile');

  return profile;
}
