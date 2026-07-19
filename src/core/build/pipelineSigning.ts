/**
 * Inline credential / signing resolution for local builds.
 *
 * Reuse-or-provision for Apple certs/profiles and the Android upload keystore, plus the interactive
 * confirm shared with `launch creds setup`.
 */

import { join } from 'node:path';
import { cancel, confirm, isCancel, select } from '@clack/prompts';
import type {
  AccountRecord,
  AndroidCredentials,
  AppDescriptor,
  AppleCredentials,
  Distribution,
  KeystoreAssets,
  Platform,
  SigningAssets,
} from '../types/index.js';
import {
  formatAccountSummary,
  resolveBuildAccount,
  setActiveKeyId,
} from '../credentials/accounts.js';
import type { Logger } from '../services/logger.js';
import { isInteractive } from '../services/progress.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import {
  ensureAdHocSigningCredentials,
  ensureSigningCredentials,
  staleCachedSigningTargets,
} from '../../apple/credentials.js';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  signingPreflightWarnings,
} from '../credentials/signingPreflight.js';
import { ensureUploadKeystore } from '../../google/credentials.js';
import { discoverExtensionBundleIds } from './appleTargets.js';
import { nativeProjectDirName } from '../services/platform.js';
import type { BuildRunOptions } from './pipelineTypes.js';
import process from 'node:process';

/** The interactive build-time account picker: choose among onboarded accounts and make the pick active. */
export async function pickAccount(accounts: AccountRecord[]): Promise<AccountRecord> {
  const choice = await select({
    message: 'Which Apple account?',
    options: accounts.map((account) => ({
      value: account.keyId,
      label: account.label,
      hint: formatAccountSummary(account, { includeLabel: false }),
    })),
  });
  if (isCancel(choice)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  const picked = accounts.find((account) => account.keyId === choice);
  if (!picked) throw new Error('Could not match the selected account.');
  setActiveKeyId(picked.keyId);
  return picked;
}

/**
 * Resolve which Apple account an iOS build uses: `--account`/`ASC_ACCOUNT` → the active account → an
 * interactive picker (TTY only; CI fails fast with the fix). Shared by the local spine and the remote
 * pipeline so both select the account identically. Logs the chosen account as a build step.
 */
export async function resolveIosAccount(
  options: Pick<BuildRunOptions, 'account'>,
  log: Logger,
): Promise<AccountRecord> {
  const account = await resolveBuildAccount({
    selector: options.account ?? process.env['ASC_ACCOUNT'],
    interactive: isInteractive(),
    pick: pickAccount,
  });
  log.step('account', formatAccountSummary(account));
  return account;
}

/**
 * A yes/no prompt that exits cleanly on cancel. Shared with `launch creds setup` so provisioning
 * confirmations look identical whether triggered inline by a build or run explicitly.
 */
export function interactiveConfirm(message: string): Promise<boolean> {
  return confirm({ message }).then((answer) => {
    if (isCancel(answer)) {
      cancel('Cancelled.');
      process.exit(0);
    }
    return answer;
  });
}

/**
 * Resolve the full set of embedded-extension bundle ids to provision: the union of those declared in
 * config (`ios.extensions`) and those discovered in the generated `*.xcodeproj/project.pbxproj` (the
 * authoritative source — `@bacons/apple-targets` derives an extension's bundle id from its folder name,
 * not its target `name`, so only the pbxproj's `PRODUCT_BUNDLE_IDENTIFIER` is reliable). Discovery runs
 * after `ensureNativeProject`, so the project exists; when it finds no extra targets (single-target app)
 * the result is exactly `app.iosExtensions ?? []`, keeping the no-extension path byte-identical. The
 * main bundle id is excluded so it's never mistaken for one of its own extensions.
 */
export function resolveExtensionBundleIds(app: AppDescriptor, platform: Platform): string[] {
  const configured = app.iosExtensions ?? [];
  const nativeDir = join(app.dir, nativeProjectDirName(platform));
  const discovered = discoverExtensionBundleIds(nativeDir, app.bundleId);
  return [...new Set([...configured, ...discovered])].filter((id) => id !== app.bundleId);
}

/**
 * Warn — BEFORE the ~15-minute archive, not at exit 65 — when a build target's App ID isn't registered or
 * is missing a capability its entitlements require (issue #261, the preflight). Reads each bundle id's
 * registration + live capabilities from App Store Connect, computes the gap with the same pure mapping the
 * provisioner uses, and hands {@link multiTargetSigningWarnings} the facts to phrase. Best-effort: any read
 * failure is swallowed (a flaky preflight must never block a build that would otherwise succeed). The main
 * bundle is checked for missing capabilities (we know its entitlements); extensions are checked for
 * registration (App Group coverage is already surfaced by {@link appGroupPortalNotice}).
 */
export async function warnUnreadySigningTargets(
  ascKey: AppleCredentials['ascKey'],
  app: AppDescriptor,
  bundleId: string,
  extensions: string[],
  log: Logger,
): Promise<void> {
  try {
    const client = new AppStoreConnectClient(ascKey);
    const readiness = await gatherTargetSigningReadiness(
      client,
      bundleId,
      extensions,
      app.iosEntitlements,
    );
    for (const warning of signingPreflightWarnings(readiness)) log.warn(warning);
  } catch {
    // A preflight read shouldn't sink the build — provisioning below still surfaces a real failure.
  }
}

/**
 * The cached-reuse arm of {@link resolveSigning}: return the cached assets to reuse, or null to fall
 * through to (re)provisioning. Silent reuse is correct only when no cached profile predates a capability
 * change — `loadCachedSigningAssets` reuses by uuid with no network check, so this grades each target
 * against its App ID's live capabilities via {@link staleCachedSigningTargets} and regenerates a stale set
 * rather than letting the archive die at exit 65 (issue #292). Skipped under `--dry-run` (no network).
 */
export async function reuseCachedSigning(
  signing: SigningAssets,
  ascKey: AppleCredentials['ascKey'],
  log: Logger,
  dryRun: boolean,
): Promise<SigningAssets | null> {
  const stale = dryRun
    ? []
    : await staleCachedSigningTargets(new AppStoreConnectClient(ascKey), signing);
  if (stale.length > 0) {
    log.info(
      `Regenerating signing — cached profile(s) predate a capability change: ${stale
        .map((target) => `${target.bundleId} (missing ${target.missing.join(', ')})`)
        .join('; ')}.`,
    );
    return null;
  }
  log.step(
    'signing',
    `reusing cert ${signing.certSerial} · ${signing.profileName}`,
    'code-signing',
  );
  return signing;
}

/**
 * Resolve signing assets: reuse silently when cached, otherwise (interactively) provision them now.
 * Mirrors the locked decision — the build never hard-blocks; it offers to run setup inline.
 */
export async function resolveSigning(
  credentials: AppleCredentials,
  app: AppDescriptor,
  platform: Platform,
  log: Logger,
  dryRun: boolean,
  distribution: Distribution | undefined,
): Promise<SigningAssets> {
  const bundleId = app.bundleId;
  if (!bundleId)
    throw new Error(
      `No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`,
    );
  // App Group containers are the one signing input the JWT API can't provision (portal-only); warn up
  // front so the user fixes it before xcodebuild fails to export, rather than after.
  const appGroupNotice = appGroupPreflightNotice(app.iosEntitlements);
  if (appGroupNotice) log.warn(appGroupNotice);
  // An ad-hoc (internal) build needs a device-scoped ad-hoc profile, recreated each run, so the cached
  // App Store assets don't apply — go straight to ad-hoc provisioning.
  if (distribution === 'internal') {
    if (!dryRun)
      log.info(`Provisioning an ad-hoc profile for ${bundleId} over your registered devices.`);
    return ensureAdHocSigningCredentials({
      platform,
      bundleId,
      appName: app.name,
      ascKey: credentials.ascKey,
      log,
      dryRun,
      confirmCreate: interactiveConfirm,
    });
  }
  const extensions = resolveExtensionBundleIds(app, platform);
  // Preflight BEFORE the long archive: surface an unregistered App ID or a missing capability on any
  // target now, while the fix is one command, instead of after a ~15-minute compile fails at exit 65.
  if (!dryRun) await warnUnreadySigningTargets(credentials.ascKey, app, bundleId, extensions, log);
  if (credentials.signing) {
    const reused = await reuseCachedSigning(credentials.signing, credentials.ascKey, log, dryRun);
    if (reused) return reused;
  }
  if (!(dryRun || credentials.signing))
    log.info(
      `No cached signing assets for ${bundleId} — provisioning now (you'll confirm each Apple resource).`,
    );
  return ensureSigningCredentials({
    platform,
    bundleId,
    appName: app.name,
    ascKey: credentials.ascKey,
    log,
    dryRun,
    confirmCreate: interactiveConfirm,
    extensions,
  });
}

/**
 * Resolve the upload keystore: reuse silently when cached, otherwise provision (or import) it inline.
 * The Android twin of {@link resolveSigning} — the build never hard-blocks; it offers setup in place.
 */
export async function resolveKeystore(
  credentials: AndroidCredentials,
  app: AppDescriptor,
  log: Logger,
  dryRun: boolean,
): Promise<KeystoreAssets> {
  if (credentials.keystore) {
    log.step(
      'keystore',
      `reusing upload keystore (alias ${credentials.keystore.alias})`,
      'upload-key',
    );
    return credentials.keystore;
  }
  if (!dryRun) log.info(`No cached upload keystore for ${app.name} — provisioning one now.`);
  return ensureUploadKeystore({
    appName: app.name,
    log,
    dryRun,
    confirmCreate: interactiveConfirm,
  });
}
