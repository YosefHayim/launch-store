// Finds or creates the certificate and profile an App Store or internal build needs.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import {
  readAccountCredentialsDirectory,
  readCredentialsDirectory,
  readProvisioningProfilesDirectory,
} from '../services/platform/paths.ts';
import {
  createAppleCredentialsClient,
  type AppleCredentialsClient,
} from '../services/stores/apple-credentials-client.ts';
import {
  adHocProfileType,
  appStoreProfileType,
  platformLabel,
} from '../services/stores/platform.ts';
import type { Platform } from '../types/app.ts';
import type { ProfileResource } from '../types/apple/provisioning.ts';
import type { AscKey, SigningAssets } from '../types/credentials.ts';
import { decodeCredentialsIndex, readIndex } from './apple-signing-index.ts';
import { DISTRIBUTION_CERT_NAME, ensureDistributionCertificate } from './apple-signing-certs.ts';
import {
  ensureAppStoreProfileForBundle,
  ensureRegisteredBundleId,
  installProfile,
  readProfileTeamId,
} from './apple-signing-profiles.ts';
import { redactText } from '../services/platform/redact.ts';

/** Inputs for {@link ensureSigningCredentials}. */
type EnsureSigningOptions = {
  platform: Platform;
  bundleId: string;
  appName: string;
  ascKey: AscKey;
  dryRun: boolean;
  confirmCreate: (message: string) => Promise<boolean>;
  extensions?: string[];
};

/** Summarize what signing material is cached locally for one account, for `launch-store creds status`. */
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

/** Return cached signing assets for a bundle id without any network call */
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

  const provisioningProfilesDirectory = readProvisioningProfilesDirectory();
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
  const provisioningProfilesDirectory = readProvisioningProfilesDirectory();

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

/** Read a bundle's signing assets */
export async function ensureSigningCredentials(
  signingOptions: EnsureSigningOptions,
): Promise<SigningAssets> {
  const extensions = extensionList(signingOptions);

  if (signingOptions.dryRun) {
    console.log(
      redactText(
        `[dry-run] would ensure App ID, distribution certificate, and App Store profile for ${signingOptions.bundleId}`,
      ),
    );

    for (const extensionId of extensions) {
      console.log(
        redactText(
          `[dry-run] would ensure App ID + App Store profile for extension ${extensionId} (same cert)`,
        ),
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
  const client = await createAppleCredentialsClient(signingOptions.ascKey);
  const index = await readIndex(keyId);
  // One cert signs every bundle in the team, so it's resolved once and shared.
  const ensuredCertificate = await ensureDistributionCertificate({
    client,
    keyId,
    index,
    confirmCreate: signingOptions.confirmCreate,
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
  try {
    var profileType: ReturnType<typeof adHocProfileType> = adHocProfileType(platform);
  } catch (cause) {
    throw new Error(`${platformLabel(platform)} ${AD_HOC_UNAVAILABLE_MESSAGE}`, { cause });
  }

  if (profileType == null) {
    throw new Error(`${platformLabel(platform)} ${AD_HOC_UNAVAILABLE_MESSAGE}`);
  }

  return profileType;
}

/** Read signing assets for an ad-hoc (internal-distribution) build */
export async function ensureAdHocSigningCredentials(
  signingOptions: EnsureSigningOptions,
): Promise<SigningAssets> {
  const profileType = readAdHocProfileType(signingOptions.platform);

  if (signingOptions.dryRun) {
    console.log(
      redactText(
        `[dry-run] would ensure App ID + distribution cert + an ad-hoc profile over registered devices for ${signingOptions.bundleId}`,
      ),
    );

    const assets = dryRunAssets(signingOptions.bundleId);

    return { ...assets, profileName: `Launch_${signingOptions.bundleId}_AdHoc` };
  }

  const keyId = signingOptions.ascKey.keyId;
  const client = await createAppleCredentialsClient(signingOptions.ascKey);
  const index = await readIndex(keyId);
  const bundle = await ensureRegisteredBundleId({
    client,
    platform: signingOptions.platform,
    bundleId: signingOptions.bundleId,
    appName: signingOptions.appName,
    confirmCreate: signingOptions.confirmCreate,
    declineMessage: `App ID ${signingOptions.bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
  });
  const ensuredCertificate = await ensureDistributionCertificate({
    client,
    keyId,
    index,
    confirmCreate: signingOptions.confirmCreate,
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
    throw new Error(
      'No registered devices for an ad-hoc build. Add one with `launch-store device add <udid> [name]` and retry.',
    );
  }

  console.log(
    redactText(`devices - ${enabledDevices.length} registered device(s) on the ad-hoc profile`),
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

  console.log(redactText(`profile - created ${profileName} (ad-hoc)`));

  const teamId = readProfileTeamId(installed.teamId, bundle.seedId);

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

/** Local files + identifiers needed to sign on a REMOTE Mac */
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

/** Read a bundle's signing assets for a REMOTE (off-Mac) build */
export async function ensureRemoteSigningAssets(
  signingOptions: EnsureSigningOptions,
): Promise<RemoteSigningBundle> {
  if (signingOptions.dryRun) {
    const credentialsDirectory = readAccountCredentialsDirectory(signingOptions.ascKey.keyId);

    console.log(
      redactText(
        `[dry-run] would ensure App ID + distribution .p12 + App Store profile for ${signingOptions.bundleId}, ready to upload`,
      ),
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
  const client = await createAppleCredentialsClient(signingOptions.ascKey);
  const index = await readIndex(keyId);
  const bundle = await ensureRegisteredBundleId({
    client,
    platform: signingOptions.platform,
    bundleId: signingOptions.bundleId,
    appName: signingOptions.appName,
    confirmCreate: signingOptions.confirmCreate,
    declineMessage: `App ID ${signingOptions.bundleId} is not registered. Re-run and confirm, or register it in the portal.`,
  });
  const ensuredCertificate = await ensureDistributionCertificate({
    client,
    keyId,
    index,
    confirmCreate: signingOptions.confirmCreate,
    importToKeychain: false,
    warnAtCertCap: true,
    createConfirmMessage:
      'Create a new distribution certificate (generates a private key on this machine)?',
  });
  const profile = await readRemoteProfile({
    client,
    bundleIdResourceId: bundle.id,
    certId: ensuredCertificate.cert.id,
    freshCert: ensuredCertificate.freshCert,
    platform: signingOptions.platform,
    bundleId: signingOptions.bundleId,
  });
  const credentialsDirectory = readAccountCredentialsDirectory(keyId);

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

async function readRemoteProfile(remoteProfile: {
  client: AppleCredentialsClient;
  bundleIdResourceId: string;
  certId: string;
  freshCert: boolean;
  platform: Platform;
  bundleId: string;
}): Promise<ProfileResource> {
  const profileName = `Launch_${remoteProfile.bundleId}_AppStore`;
  const existingProfile = await remoteProfile.client.findProfileByName(profileName);

  if (existingProfile == null) {
    return createRemoteProfile(remoteProfile, profileName);
  }

  if (remoteProfile.freshCert == false) {
    console.log(redactText(`profile - reusing ${profileName}`));

    return existingProfile;
  }

  await remoteProfile.client.deleteProfile(existingProfile.id);

  return createRemoteProfile(remoteProfile, profileName);
}

async function createRemoteProfile(
  remoteProfile: {
    client: AppleCredentialsClient;
    bundleIdResourceId: string;
    certId: string;
    platform: Platform;
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

  console.log(redactText(`profile - created ${profileName}`));

  return profile;
}

/** Move an old flat signing index into the per-account layout. */
export async function migrateLegacySigningIndex(keyId: string): Promise<void> {
  const credentialsDirectory = readCredentialsDirectory();
  const legacyIndexPath = join(credentialsDirectory, 'index.json');
  const hasLegacyIndex = await pathExists(legacyIndexPath);

  if (hasLegacyIndex == false) {
    return;
  }

  try {
    var indexText = await readFile(legacyIndexPath, 'utf8');
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return;
    }

    return;
  }

  try {
    var parsedIndex = JSON.parse(indexText);
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

  const destinationDirectory = readAccountCredentialsDirectory(keyId);

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
