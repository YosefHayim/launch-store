// Loads the Apple signing identity and Android keystore a build will use.

import { join } from 'node:path';
import type { AppDescriptor, Distribution, Platform } from '../types/app.ts';
import type {
  AccountRecord,
  AndroidCredentials,
  AppleCredentials,
  SigningAssets,
} from '../types/credentials.ts';
import { formatAccountSummary, readBuildAccount, setActiveKeyId } from '../credentials/accounts.ts';
import type { Logger } from '../services/platform/logger.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { LaunchPrompt, type LaunchPromptService } from '../services/platform/prompt.ts';
import { createAppleCredentialsClient } from '../services/stores/apple-credentials-client.ts';
import {
  ensureAdHocSigningCredentials,
  ensureSigningCredentials,
} from '../credentials/apple-signing-assets.ts';
import { staleCachedSigningTargets } from '../credentials/apple-signing-profiles.ts';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  signingPreflightWarnings,
} from '../credentials/signing-preflight.ts';
import { ensureUploadKeystore } from '../credentials/android-keystore-assets.ts';
import { discoverExtensionBundleIds } from './apple-targets.ts';
import { nativeProjectDirName } from '../services/stores/platform.ts';
import type { BuildRunOptions } from '../types/build-run.ts';

async function pickAccount(
  launchPrompt: LaunchPromptService,
  accounts: readonly AccountRecord[],
): Promise<AccountRecord> {
  const picked = await launchPrompt.select({
    message: 'Which Apple account?',
    choices: accounts.map(function accountChoice(account: AccountRecord) {
      return {
        selection: account,
        label: account.label,
        hint: formatAccountSummary(account, { includeLabel: false }),
      };
    }),
  });

  return picked;
}

/** Read which Apple account an iOS build uses. */
export async function readIosAccount(
  buildOptions: Pick<BuildRunOptions, 'account'>,
  log: Logger,
): Promise<AccountRecord> {
  const environment = readLaunchEnvironment();
  const launchPrompt = new LaunchPrompt();
  let accountSelector = environment.values.appleAccount;

  if (buildOptions.account != null) {
    accountSelector = buildOptions.account;
  }

  const interactive = checkTerminalIsInteractive();

  function pickAccounts(accounts: readonly AccountRecord[]): Promise<AccountRecord> {
    return pickAccount(launchPrompt, accounts);
  }

  const account = await readBuildAccount({
    selector: accountSelector,
    interactive,
    pick: pickAccounts,
  });

  await setActiveKeyId(account.keyId);

  const accountSummary = formatAccountSummary(account);

  log.step('account', accountSummary);

  return account;
}

/** A yes/no prompt. Cancelling is the prompt's own exit. */
export function interactiveConfirm(
  launchPrompt: LaunchPromptService,
  message: string,
): Promise<boolean> {
  return launchPrompt.confirm(message);
}

function isNotMainBundle(mainBundleId: string | undefined) {
  return function keepExtension(extensionId: string): boolean {
    return extensionId != mainBundleId;
  };
}

/** Union of configured extension ids and those discovered in the generated Xcode project. */
async function readExtensionBundleIds(app: AppDescriptor, platform: Platform): Promise<string[]> {
  let configured: readonly string[] = [];

  if (app.iosExtensions != null) {
    configured = app.iosExtensions;
  }

  const nativeDirectoryName = nativeProjectDirName(platform);
  const nativeDirectory = join(app.dir, nativeDirectoryName);
  const discovered = await discoverExtensionBundleIds(nativeDirectory, app.bundleId);
  const extensionIds = [...new Set([...configured, ...discovered])];

  return extensionIds.filter(isNotMainBundle(app.bundleId));
}

/** Warn before the archive when an App ID is unregistered or missing a capability. */
async function warnUnreadySigningTargets(
  ascKey: AppleCredentials['ascKey'],
  app: AppDescriptor,
  bundleId: string,
  extensions: readonly string[],
  log: Logger,
): Promise<void> {
  try {
    const credentialsClient = await createAppleCredentialsClient(ascKey);
    const readiness = await gatherTargetSigningReadiness(
      credentialsClient,
      bundleId,
      extensions,
      app.iosEntitlements,
    );

    for (const warning of signingPreflightWarnings(readiness)) {
      log.warn(warning);
    }
  } catch (error) {
    const preflightFailed = error != null;

    if (preflightFailed) {
      return;
    }
  }
}

/** Return cached signing assets when they still match live capabilities */
async function reuseCachedSigning(
  signing: SigningAssets,
  ascKey: AppleCredentials['ascKey'],
  log: Logger,
  isDryRun: boolean,
): Promise<SigningAssets | null> {
  let stale: { bundleId: string; missing: string[] }[] = [];

  if (isDryRun == false) {
    const credentialsClient = await createAppleCredentialsClient(ascKey);

    stale = await staleCachedSigningTargets(credentialsClient, signing);
  }

  const hasStaleProfiles = stale.length > 0;

  if (hasStaleProfiles) {
    const staleSummary = stale
      .map(function describeStaleTarget(target: { bundleId: string; missing: string[] }) {
        return `${target.bundleId} (missing ${target.missing.join(', ')})`;
      })
      .join('; ');

    log.note(
      `Regenerating signing - cached profile(s) predate a capability change: ${staleSummary}.`,
    );

    return null;
  }

  log.step(
    'signing',
    `reusing cert ${signing.certSerial} - ${signing.profileName}`,
    'code-signing',
  );

  return signing;
}

function confirmWith(launchPrompt: LaunchPromptService) {
  return function confirmCreate(message: string): Promise<boolean> {
    return interactiveConfirm(launchPrompt, message);
  };
}

function shouldNoteMissingSigning(isDryRun: boolean, signing: SigningAssets | undefined): boolean {
  if (isDryRun) {
    return false;
  }

  return signing == null;
}

async function provisionInternalSigning(request: {
  isDryRun: boolean;
  bundleId: string;
  platform: Platform;
  app: AppDescriptor;
  credentials: AppleCredentials;
  log: Logger;
  confirmCreate: (message: string) => Promise<boolean>;
}): Promise<SigningAssets> {
  if (request.isDryRun == false) {
    request.log.note(
      `Provisioning an ad-hoc profile for ${request.bundleId} over your registered devices.`,
    );
  }

  const signingAssets = await ensureAdHocSigningCredentials({
    platform: request.platform,
    bundleId: request.bundleId,
    appName: request.app.name,
    ascKey: request.credentials.ascKey,
    log: request.log,
    dryRun: request.isDryRun,
    confirmCreate: request.confirmCreate,
  });

  return signingAssets;
}

/** Reuse cached signing assets, or provision them inline. */
export async function readSigning(
  credentials: AppleCredentials,
  app: AppDescriptor,
  platform: Platform,
  log: Logger,
  isDryRun: boolean,
  distribution: Distribution | undefined,
): Promise<SigningAssets> {
  const launchPrompt = new LaunchPrompt();
  const confirmCreate = confirmWith(launchPrompt);
  const bundleId = presentBundleId(app);

  const appGroupNotice = appGroupPreflightNotice(app.iosEntitlements);

  if (isPresentNotice(appGroupNotice)) {
    log.warn(appGroupNotice);
  }

  const isInternal = distribution == 'internal';

  if (isInternal) {
    const signingAssets = await provisionInternalSigning({
      isDryRun,
      bundleId,
      platform,
      app,
      credentials,
      log,
      confirmCreate,
    });

    return signingAssets;
  }

  const extensions = await readExtensionBundleIds(app, platform);

  if (isDryRun == false) {
    await warnUnreadySigningTargets(credentials.ascKey, app, bundleId, extensions, log);
  }

  const reused = await reuseWhenCached(credentials, log, isDryRun);

  if (reused != null) {
    return reused;
  }

  const shouldNote = shouldNoteMissingSigning(isDryRun, credentials.signing);

  if (shouldNote) {
    log.note(
      `No cached signing assets for ${bundleId} - provisioning now (you'll confirm each Apple resource).`,
    );
  }

  const provisioned = await ensureSigningCredentials({
    platform,
    bundleId,
    appName: app.name,
    ascKey: credentials.ascKey,
    log,
    dryRun: isDryRun,
    confirmCreate,
    extensions,
  });

  return provisioned;
}

function isPresentNotice(notice: string | null | undefined): notice is string {
  if (notice == null) {
    return false;
  }

  return notice != '';
}

function isPresentBundle(bundleId: string | undefined): bundleId is string {
  if (bundleId == null) {
    return false;
  }

  return bundleId != '';
}

function presentBundleId(app: AppDescriptor): string {
  const bundleId = app.bundleId;

  if (isPresentBundle(bundleId)) {
    return bundleId;
  }

  throw new Error(
    `No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`,
  );
}

async function reuseWhenCached(
  credentials: AppleCredentials,
  log: Logger,
  isDryRun: boolean,
): Promise<SigningAssets | null> {
  const cachedSigning = credentials.signing;

  if (cachedSigning != null) {
    const reused = await reuseCachedSigning(cachedSigning, credentials.ascKey, log, isDryRun);

    return reused;
  }

  return null;
}

function isPresentPackage(packageName: string | undefined): packageName is string {
  if (packageName == null) {
    return false;
  }

  return packageName != '';
}

function requireAndroidPackage(app: AppDescriptor): string {
  const packageName = app.packageName;

  if (isPresentPackage(packageName)) {
    return packageName;
  }

  throw new Error('Set android.package before creating an upload keystore.');
}

/** Reuse a cached upload keystore, or provision one inline. */
export async function readKeystore(
  credentials: AndroidCredentials,
  app: AppDescriptor,
  log: Logger,
  isDryRun: boolean,
) {
  const launchPrompt = new LaunchPrompt();
  const cachedKeystore = credentials.keystore;

  const hasKeystore = cachedKeystore != null;

  if (hasKeystore) {
    log.step('keystore', `reusing upload keystore (alias ${cachedKeystore.alias})`, 'upload-key');

    return cachedKeystore;
  }

  if (isDryRun == false) {
    log.note(`No cached upload keystore for ${app.name} - provisioning one now.`);
  }

  const packageName = requireAndroidPackage(app);

  function confirmCreate(message: string): Promise<boolean> {
    return interactiveConfirm(launchPrompt, message);
  }

  const keystore = await ensureUploadKeystore({
    appName: app.name,
    packageName,
    log,
    dryRun: isDryRun,
    confirmCreate,
  });

  return keystore;
}
