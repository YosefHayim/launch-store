import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import type { Logger } from '../services/platform/logger.ts';
import {
  resolveAccountCredentialsDirectory,
  resolveCredentialsDirectory,
  resolveProvisioningProfilesDirectory,
} from '../services/platform/paths.ts';
import { AppleCredentialsClientFactory } from '../services/stores/apple-credentials-client.ts';
import {
  adHocProfileType,
  appStoreProfileType,
  platformLabel,
} from '../services/stores/platform.ts';
import type { Platform } from '../types/app.ts';
import type { ProfileResource } from '../types/apple-catalog.ts';
import type { AscKey, SigningAssets } from '../types/credentials.ts';
import {
  decodeCredentialsIndex,
  makeAppleSigningFailure,
  readIndex,
} from './apple-signing-index.ts';
import {
  DISTRIBUTION_CERT_NAME,
  ensureDistributionCertificate,
  p12PasswordAccount,
} from './apple-signing-certs.ts';
import {
  ensureAppStoreProfileForBundle,
  ensureRegisteredBundleId,
  installProfile,
  profileStaleAgainstCapabilities,
  resolveProfileTeamId,
  staleCachedSigningTargets,
} from './apple-signing-profiles.ts';

export { p12PasswordAccount };
export { profileStaleAgainstCapabilities, staleCachedSigningTargets };

/** Inputs for {@link ensureSigningCredentials}. */
type EnsureSigningOptions = {
  platform: Platform;
  bundleId: string;
  appName: string;
  ascKey: AscKey;
  log: Logger;
  dryRun: boolean;
  confirmCreate: (message: string) => Promise<boolean>;
  extensions?: string[];
};

/** Summarize what signing material is cached locally for one account, for `launch creds status`. */
export async function describeStoredCredentials(keyId: string): Promise<{
  certSerial: string | null;
  bundleIds: string[];
}> {
  const index = await readIndex(keyId);
  let certSerial: string | null = null;

  if (index.certificate != null) {
    certSerial = index.certificate.serial;
  }

  return {
    certSerial,
    bundleIds: Object.keys(index.profiles),
  };
}

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
export async function loadCachedSigningAssets(
  keyId: string,
  bundleId: string,
  extensions: readonly string[] = [],
): Promise<SigningAssets | null> {
  const index = await readIndex(keyId);
  const cert = index.certificate;
  const profile = index.profiles[bundleId];

  if (cert == null) {
    return null;
  }

  if (profile == null) {
    return null;
  }

  const provisioningProfilesDirectory = resolveProvisioningProfilesDirectory();
  const installedProfile = join(provisioningProfilesDirectory, `${profile.uuid}.mobileprovision`);
  const isCertificatePresent = await pathExists(cert.p12Path);

  if (isCertificatePresent == false) {
    return null;
  }

  const isProfilePresent = await pathExists(installedProfile);

  if (isProfilePresent == false) {
    return null;
  }

  const extensionProfiles: Record<string, string> = {};

  for (const extensionId of extensions) {
    const extensionProfile = index.profiles[extensionId];

    if (extensionProfile == null) {
      return null;
    }

    const extensionProfilePath = join(
      provisioningProfilesDirectory,
      `${extensionProfile.uuid}.mobileprovision`,
    );
    const isExtensionProfilePresent = await pathExists(extensionProfilePath);

    if (isExtensionProfilePresent == false) {
      return null;
    }

    extensionProfiles[extensionId] = extensionProfile.name;
  }

  const signingAssets: SigningAssets = {
    bundleId,
    teamId: profile.teamId,
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: cert.serial,
    profileName: profile.name,
    profileUuid: profile.uuid,
    profilePath: installedProfile,
  };
  const hasExtensions = extensions.length > 0;

  if (hasExtensions == false) {
    return signingAssets;
  }

  return { ...signingAssets, extensionProfiles };
}

/** A SigningAssets stand-in for `--dry-run`, so the rest of the pipeline can run unchanged. */
function dryRunAssets(bundleId: string): SigningAssets {
  const provisioningProfilesDirectory = resolveProvisioningProfilesDirectory();

  return {
    bundleId,
    teamId: 'DRYRUNTEAM',
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: 'DRYRUN000000',
    profileName: `Launch_${bundleId}_AppStore`,
    profileUuid: '00000000-0000-0000-0000-000000000000',
    profilePath: join(provisioningProfilesDirectory, 'dry-run.mobileprovision'),
  };
}

function extensionList(signingOptions: EnsureSigningOptions): string[] {
  if (signingOptions.extensions == null) {
    return [];
  }

  return signingOptions.extensions;
}

function dryRunExtensionName(extensionId: string): [string, string] {
  return [extensionId, `Launch_${extensionId}_AppStore`];
}

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
export async function ensureSigningCredentials(
  signingOptions: EnsureSigningOptions,
): Promise<SigningAssets> {
  const extensions = extensionList(signingOptions);

  if (signingOptions.dryRun) {
    signingOptions.log.note(
      `[dry-run] would ensure App ID, distribution certificate, and App Store profile for ${signingOptions.bundleId}`,
    );

    for (const extensionId of extensions) {
      signingOptions.log.note(
        `[dry-run] would ensure App ID + App Store profile for extension ${extensionId} (same cert)`,
      );
    }

    const assets = dryRunAssets(signingOptions.bundleId);

    if (extensions.length == 0) {
      return assets;
    }

    return {
      ...assets,
      extensionProfiles: Object.fromEntries(extensions.map(dryRunExtensionName)),
    };
  }

  const keyId = signingOptions.ascKey.keyId;
  const client = await AppleCredentialsClientFactory.createClient(signingOptions.ascKey);
  const index = await readIndex(keyId);
  // One cert signs every bundle in the team, so it's resolved once and shared.
  const ensuredCertificate = await ensureDistributionCertificate({
    client,
    keyId,
    index,
    confirmCreate: signingOptions.confirmCreate,
    log: signingOptions.log,
    importToKeychain: true,
    warnAtCertCap: true,
    createConfirmMessage:
      'Create a new distribution certificate (generates a private key on this Mac)?',
  });
  const main = await ensureAppStoreProfileForBundle({
    client,
    keyId,
    index,
    platform: signingOptions.platform,
    bundleId: signingOptions.bundleId,
    appName: signingOptions.appName,
    cert: ensuredCertificate.cert,
    freshCert: ensuredCertificate.freshCert,
    confirmCreate: signingOptions.confirmCreate,
    log: signingOptions.log,
  });
  const extensionProfiles: Record<string, string> = {};

  for (const extensionId of extensions) {
    const provisioned = await ensureAppStoreProfileForBundle({
      client,
      keyId,
      index,
      platform: signingOptions.platform,
      bundleId: extensionId,
      appName: `${signingOptions.appName} (extension)`,
      cert: ensuredCertificate.cert,
      freshCert: ensuredCertificate.freshCert,
      confirmCreate: signingOptions.confirmCreate,
      log: signingOptions.log,
    });
    extensionProfiles[extensionId] = provisioned.profileName;
  }

  const hasExtensionProfiles = Object.keys(extensionProfiles).length > 0;

  if (hasExtensionProfiles == false) {
    return main;
  }

  return { ...main, extensionProfiles };
}

const AD_HOC_UNAVAILABLE_MESSAGE =
  'has no ad-hoc provisioning profile. Submit to the store or choose another platform.';

function readAdHocProfileType(platform: Platform): 'IOS_APP_ADHOC' | 'TVOS_APP_ADHOC' {
  let profileType: ReturnType<typeof adHocProfileType>;

  try {
    profileType = adHocProfileType(platform);
  } catch (cause) {
    throw makeAppleSigningFailure({
      message: `${platformLabel(platform)} ${AD_HOC_UNAVAILABLE_MESSAGE}`,
      cause,
    });
  }

  if (profileType == null) {
    throw makeAppleSigningFailure({
      message: `${platformLabel(platform)} ${AD_HOC_UNAVAILABLE_MESSAGE}`,
    });
  }

  return profileType;
}

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
export async function ensureAdHocSigningCredentials(
  signingOptions: EnsureSigningOptions,
): Promise<SigningAssets> {
  const profileType = readAdHocProfileType(signingOptions.platform);

  if (signingOptions.dryRun) {
    signingOptions.log.note(
      `[dry-run] would ensure App ID + distribution cert + an ad-hoc profile over registered devices for ${signingOptions.bundleId}`,
    );
    const assets = dryRunAssets(signingOptions.bundleId);

    return { ...assets, profileName: `Launch_${signingOptions.bundleId}_AdHoc` };
  }

  const keyId = signingOptions.ascKey.keyId;
  const client = await AppleCredentialsClientFactory.createClient(signingOptions.ascKey);
  const index = await readIndex(keyId);
  const bundle = await ensureRegisteredBundleId({
    client,
    platform: signingOptions.platform,
    bundleId: signingOptions.bundleId,
    appName: signingOptions.appName,
    confirmCreate: signingOptions.confirmCreate,
    log: signingOptions.log,
    declineMessage: `App ID ${signingOptions.bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
  });
  const ensuredCertificate = await ensureDistributionCertificate({
    client,
    keyId,
    index,
    confirmCreate: signingOptions.confirmCreate,
    log: signingOptions.log,
    importToKeychain: true,
    warnAtCertCap: false,
    createConfirmMessage:
      'Create a new distribution certificate (generates a private key on this Mac)?',
  });
  const devices = await client.listDevices();

  function isEnabledDevice(device: { status?: string }): boolean {
    return device.status != 'DISABLED';
  }

  const enabledDevices = devices.filter(isEnabledDevice);
  const hasNoDevices = enabledDevices.length == 0;

  if (hasNoDevices) {
    throw makeAppleSigningFailure({
      message:
        'No registered devices for an ad-hoc build. Add one with `launch device add <udid> [name]` and retry.',
    });
  }

  signingOptions.log.step(
    'devices',
    `${enabledDevices.length} registered device(s) on the ad-hoc profile`,
  );

  const profileName = `Launch_${signingOptions.bundleId}_AdHoc`;
  const existing = await client.findProfileByName(profileName);

  if (existing != null) {
    await client.deleteProfile(existing.id);
  }

  function deviceId(device: { id: string }): string {
    return device.id;
  }

  const profile = await client.createAdHocProfile(
    profileName,
    bundle.id,
    ensuredCertificate.cert.id,
    enabledDevices.map(deviceId),
    profileType,
  );
  const installed = await installProfile(
    keyId,
    `${signingOptions.bundleId}.adhoc`,
    profile.profileContent,
  );
  signingOptions.log.step('profile', `created ${profileName} (ad-hoc)`, 'provisioning-profile');
  const teamId = resolveProfileTeamId(installed.teamId, bundle.seedId);

  return {
    bundleId: signingOptions.bundleId,
    teamId,
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: ensuredCertificate.cert.serial,
    profileName: installed.name,
    profileUuid: installed.uuid,
    profilePath: installed.installedPath,
  };
}

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
export async function ensureRemoteSigningAssets(
  signingOptions: EnsureSigningOptions,
): Promise<RemoteSigningBundle> {
  if (signingOptions.dryRun) {
    const credentialsDirectory = resolveAccountCredentialsDirectory(signingOptions.ascKey.keyId);
    signingOptions.log.note(
      `[dry-run] would ensure App ID + distribution .p12 + App Store profile for ${signingOptions.bundleId}, ready to upload`,
    );

    return {
      bundleId: signingOptions.bundleId,
      certName: DISTRIBUTION_CERT_NAME,
      certSerial: 'DRYRUN000000',
      teamId: 'DRYRUNTEAM',
      profileName: `Launch_${signingOptions.bundleId}_AppStore`,
      p12Path: join(credentialsDirectory, 'dry-run.p12'),
      p12Password: 'dry-run',
      profilePath: join(credentialsDirectory, 'dry-run.mobileprovision'),
    };
  }

  const keyId = signingOptions.ascKey.keyId;
  const client = await AppleCredentialsClientFactory.createClient(signingOptions.ascKey);
  const index = await readIndex(keyId);
  const bundle = await ensureRegisteredBundleId({
    client,
    platform: signingOptions.platform,
    bundleId: signingOptions.bundleId,
    appName: signingOptions.appName,
    confirmCreate: signingOptions.confirmCreate,
    log: signingOptions.log,
    declineMessage: `App ID ${signingOptions.bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
  });
  const ensuredCertificate = await ensureDistributionCertificate({
    client,
    keyId,
    index,
    confirmCreate: signingOptions.confirmCreate,
    log: signingOptions.log,
    importToKeychain: false,
    warnAtCertCap: true,
    createConfirmMessage:
      'Create a new distribution certificate (generates a private key on this machine)?',
  });
  const profile = await resolveRemoteProfile({
    client,
    bundleIdResourceId: bundle.id,
    certId: ensuredCertificate.cert.id,
    freshCert: ensuredCertificate.freshCert,
    platform: signingOptions.platform,
    bundleId: signingOptions.bundleId,
    log: signingOptions.log,
  });
  const credentialsDirectory = resolveAccountCredentialsDirectory(keyId);
  await mkdir(credentialsDirectory, { recursive: true });
  const profilePath = join(credentialsDirectory, `${signingOptions.bundleId}.mobileprovision`);
  const bufferBytes = Buffer.from(profile.profileContent, 'base64');
  await writeFile(profilePath, bufferBytes);
  let teamId = '';

  if (bundle.seedId != null) {
    teamId = bundle.seedId;
  }

  return {
    bundleId: signingOptions.bundleId,
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: ensuredCertificate.cert.serial,
    teamId,
    profileName: `Launch_${signingOptions.bundleId}_AppStore`,
    p12Path: ensuredCertificate.cert.p12Path,
    p12Password: ensuredCertificate.password,
    profilePath,
  };
}

async function resolveRemoteProfile(remoteProfile: {
  client: Awaited<ReturnType<typeof AppleCredentialsClientFactory.createClient>>;
  bundleIdResourceId: string;
  certId: string;
  freshCert: boolean;
  platform: Platform;
  bundleId: string;
  log: Logger;
}): Promise<ProfileResource> {
  const profileName = `Launch_${remoteProfile.bundleId}_AppStore`;
  const existingProfile = await remoteProfile.client.findProfileByName(profileName);

  if (existingProfile == null) {
    return createRemoteProfile(remoteProfile, profileName);
  }

  if (remoteProfile.freshCert == false) {
    remoteProfile.log.step('profile', `reusing ${profileName}`, 'provisioning-profile');

    return existingProfile;
  }

  await remoteProfile.client.deleteProfile(existingProfile.id);

  return createRemoteProfile(remoteProfile, profileName);
}

async function createRemoteProfile(
  remoteProfile: {
    client: Awaited<ReturnType<typeof AppleCredentialsClientFactory.createClient>>;
    bundleIdResourceId: string;
    certId: string;
    platform: Platform;
    log: Logger;
  },
  profileName: string,
): Promise<ProfileResource> {
  const profileType = appStoreProfileType(remoteProfile.platform);
  const profile = await remoteProfile.client.createAppStoreProfile(
    profileName,
    remoteProfile.bundleIdResourceId,
    remoteProfile.certId,
    profileType,
  );
  remoteProfile.log.step('profile', `created ${profileName}`, 'provisioning-profile');

  return profile;
}

/**
 * Move a pre-multi-account signing index (the flat `~/.launch/credentials/index.json` plus the `.p12`
 * and `.mobileprovision` files it references) into the per-account folder for `keyId`, rewriting the
 * stored paths so a later reuse still finds the cached `.p12` (and so doesn't burn an Apple cert slot
 * re-creating one). Best-effort and idempotent: a missing legacy index is a no-op, and a failed file
 * move just leaves that account to re-provision on its next build. Called once by the account-registry
 * migration; see `core/accounts.ts`.
 */
export async function migrateLegacySigningIndex(keyId: string): Promise<void> {
  const credentialsDirectory = resolveCredentialsDirectory();
  const legacyIndexPath = join(credentialsDirectory, 'index.json');
  const hasLegacyIndex = await pathExists(legacyIndexPath);

  if (hasLegacyIndex == false) {
    return;
  }

  let indexText: string;

  try {
    indexText = await readFile(legacyIndexPath, 'utf8');
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return;
    }

    return;
  }

  let parsedIndex: unknown;

  try {
    parsedIndex = JSON.parse(indexText);
  } catch (error) {
    const isMalformed = error != null;

    if (isMalformed) {
      return;
    }

    return;
  }

  const index = decodeCredentialsIndex(parsedIndex);

  if (index == null) {
    return;
  }

  const destinationDirectory = resolveAccountCredentialsDirectory(keyId);
  await mkdir(destinationDirectory, { recursive: true });

  async function moveInto(sourcePath: string | undefined): Promise<string | undefined> {
    if (sourcePath == null) {
      return undefined;
    }

    const isPresent = await pathExists(sourcePath);

    if (isPresent == false) {
      return sourcePath;
    }

    const fileName = basename(sourcePath);
    const destinationPath = join(destinationDirectory, fileName);

    try {
      await rename(sourcePath, destinationPath);

      return destinationPath;
    } catch (error) {
      const isRenameFailure = error != null;

      if (isRenameFailure) {
        return sourcePath;
      }

      return sourcePath;
    }
  }

  if (index.certificate != null) {
    const movedCertificatePath = await moveInto(index.certificate.p12Path);

    if (movedCertificatePath != null) {
      index.certificate.p12Path = movedCertificatePath;
    }
  }

  for (const profileRecord of Object.values(index.profiles)) {
    const movedProfilePath = await moveInto(profileRecord.path);

    if (movedProfilePath != null) {
      profileRecord.path = movedProfilePath;
    }
  }

  const indexPath = join(destinationDirectory, 'index.json');
  const serialized = JSON.stringify(index, null, 2);
  await writeFile(indexPath, serialized);

  try {
    await rm(legacyIndexPath, { force: true });
  } catch (error) {
    const isAlreadyGone = error != null;

    if (isAlreadyGone == false) {
      throw error;
    }
  }
}
