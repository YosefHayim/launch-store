import { type FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import type { AppDescriptor, Distribution, Platform } from '../types/app.js';
import type {
  AccountRecord,
  AndroidCredentials,
  AppleCredentials,
  SigningAssets,
} from '../types/credentials.js';
import {
  formatAccountSummary,
  resolveBuildAccount,
  setActiveKeyId,
} from '../credentials/accounts.js';
import type { Logger } from '../services/logger.js';
import { checkTerminalIsInteractive } from '../services/progress.js';
import { LaunchEnvironment } from '../services/environment.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { AppleCredentialsClientFactory } from '../services/appleCredentialsClient.js';
import {
  ensureAdHocSigningCredentials,
  ensureSigningCredentials,
  staleCachedSigningTargets,
} from '../credentials/appleSigning.js';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  signingPreflightWarnings,
} from '../credentials/signingPreflight.js';
import { ensureUploadKeystore } from '../credentials/androidKeystore.js';
import { discoverExtensionBundleIds } from './appleTargets.js';
import { nativeProjectDirName } from '../services/platform.js';
import type { BuildRunOptions } from './pipelineTypes.js';
/** The interactive build-time account picker: choose among onboarded accounts and make the pick active. */
export const pickAccount = (launchPrompt: LaunchPromptService, accounts: AccountRecord[]) =>
  Effect.gen(function* () {
    return yield* launchPrompt.select({
      message: 'Which Apple account?',
      choices: accounts.map((account) => ({
        selection: account,
        label: account.label,
        hint: formatAccountSummary(account, { includeLabel: false }),
      })),
    });
  });
/**
 * Resolve which Apple account an iOS build uses: `--account`/`ASC_ACCOUNT` -> the active account -> an
 * interactive picker (TTY only; CI fails fast with the fix). Shared by the local spine and the remote
 * pipeline so both select the account identically. Logs the chosen account as a build step.
 */
export const resolveIosAccount = (options: Pick<BuildRunOptions, 'account'>, log: Logger) =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    const launchPrompt = yield* LaunchPrompt;
    let accountSelector = environment.values.appleAccount;
    if (options.account !== undefined) accountSelector = options.account;
    const interactive = yield* checkTerminalIsInteractive;
    const account = yield* resolveBuildAccount({
      selector: accountSelector,
      interactive,
      pick: (accounts) => pickAccount(launchPrompt, accounts),
    });
    yield* setActiveKeyId(account.keyId);
    yield* log.step('account', formatAccountSummary(account));
    return account;
  });
/**
 * A yes/no prompt that exits cleanly on cancel. Shared with `launch creds setup` so provisioning
 * confirmations look identical whether triggered inline by a build or run explicitly.
 */
export const interactiveConfirm = (launchPrompt: LaunchPromptService, message: string) =>
  launchPrompt.confirm(message);

export type SigningResolutionFailure = Readonly<{
  readonly _tag: 'SigningResolutionFailure';
  readonly message: string;
}>;

export const makeSigningResolutionFailure = Data.tagged<SigningResolutionFailure>(
  'SigningResolutionFailure',
);
/**
 * Resolve the full set of embedded-extension bundle ids to provision: the union of those declared in
 * config (`ios.extensions`) and those discovered in the generated `*.xcodeproj/project.pbxproj` (the
 * authoritative source - `@bacons/apple-targets` derives an extension's bundle id from its folder name,
 * not its target `name`, so only the pbxproj's `PRODUCT_BUNDLE_IDENTIFIER` is reliable). Discovery runs
 * after `ensureNativeProject`, so the project exists; when it finds no extra targets (single-target app)
 * the returned list matches the app's declared extensions, keeping the no-extension path byte-identical. The
 * main bundle id is excluded so it's never mistaken for one of its own extensions.
 */
export const resolveExtensionBundleIds = (
  app: AppDescriptor,
  platform: Platform,
): Effect.Effect<string[], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    let configured: string[] = [];
    if (app.iosExtensions !== undefined) configured = app.iosExtensions;
    const nativeDirectoryName = yield* nativeProjectDirName(platform);
    const nativeDirectory = pathService.join(app.dir, nativeDirectoryName);
    const discovered = yield* discoverExtensionBundleIds(nativeDirectory, app.bundleId);
    return [...new Set([...configured, ...discovered])].filter(
      (extensionId) => extensionId !== app.bundleId,
    );
  });
/**
 * Warn - BEFORE the ~15-minute archive, not at exit 65 - when a build target's App ID isn't registered or
 * is missing a capability its entitlements require (issue #261, the preflight). Reads each bundle id's
 * registration + live capabilities from App Store Connect, computes the gap with the same pure mapping the
 * provisioner uses, and hands {@link multiTargetSigningWarnings} the facts to phrase. Best-effort: any read
 * failure is swallowed (a flaky preflight must never block a build that would otherwise succeed). The main
 * bundle is checked for missing capabilities (we know its entitlements); extensions are checked for
 * registration (App Group coverage is already surfaced by {@link appGroupPortalNotice}).
 */
export const warnUnreadySigningTargets = (
  ascKey: AppleCredentials['ascKey'],
  app: AppDescriptor,
  bundleId: string,
  extensions: string[],
  log: Logger,
) =>
  Effect.gen(function* () {
    const clientFactory = yield* AppleCredentialsClientFactory;
    const credentialsClient = yield* clientFactory.createClient(ascKey);
    const readiness = yield* gatherTargetSigningReadiness(
      credentialsClient,
      bundleId,
      extensions,
      app.iosEntitlements,
    );
    for (const warning of signingPreflightWarnings(readiness)) yield* log.warn(warning);
  }).pipe(Effect.catchAll(() => Effect.void));
/**
 * The cached-reuse arm of {@link resolveSigning}: return the cached assets to reuse, or null to fall
 * through to (re)provisioning. Silent reuse is correct only when no cached profile predates a capability
 * change - `loadCachedSigningAssets` reuses by uuid with no network check, so this grades each target
 * against its App ID's live capabilities via {@link staleCachedSigningTargets} and regenerates a stale set
 * rather than letting the archive die at exit 65 (issue #292). Skipped under `--dry-run` (no network).
 */
export const reuseCachedSigning = (
  signing: SigningAssets,
  ascKey: AppleCredentials['ascKey'],
  log: Logger,
  dryRun: boolean,
) =>
  Effect.gen(function* () {
    let stale: { bundleId: string; missing: string[] }[] = [];
    if (!dryRun) {
      const clientFactory = yield* AppleCredentialsClientFactory;
      const credentialsClient = yield* clientFactory.createClient(ascKey);
      stale = yield* staleCachedSigningTargets(credentialsClient, signing);
    }
    if (stale.length > 0) {
      yield* log.note(
        `Regenerating signing - cached profile(s) predate a capability change: ${stale
          .map((target) => `${target.bundleId} (missing ${target.missing.join(', ')})`)
          .join('; ')}.`,
      );
      return null;
    }
    yield* log.step(
      'signing',
      `reusing cert ${signing.certSerial} - ${signing.profileName}`,
      'code-signing',
    );
    return signing;
  });
/**
 * Resolve signing assets: reuse silently when cached, otherwise (interactively) provision them now.
 * Mirrors the locked decision - the build never hard-blocks; it offers to run setup inline.
 */
export const resolveSigning = (
  credentials: AppleCredentials,
  app: AppDescriptor,
  platform: Platform,
  log: Logger,
  dryRun: boolean,
  distribution: Distribution | undefined,
) =>
  Effect.gen(function* () {
    const launchPrompt = yield* LaunchPrompt;
    const confirmCreate = (message: string) => interactiveConfirm(launchPrompt, message);
    const bundleId = app.bundleId;
    if (!bundleId)
      return yield* Effect.fail(
        makeSigningResolutionFailure({
          message: `No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`,
        }),
      );
    // App Group containers are the one signing input the JWT API can't provision (portal-only); warn up
    // front so the user fixes it before xcodebuild fails to export, rather than after.
    const appGroupNotice = appGroupPreflightNotice(app.iosEntitlements);
    if (appGroupNotice) yield* log.warn(appGroupNotice);
    // An ad-hoc (internal) build needs a device-scoped ad-hoc profile, recreated each run, so the cached
    // App Store assets don't apply - go straight to ad-hoc provisioning.
    if (distribution === 'internal') {
      if (!dryRun)
        yield* log.note(
          `Provisioning an ad-hoc profile for ${bundleId} over your registered devices.`,
        );
      return yield* ensureAdHocSigningCredentials({
        platform,
        bundleId,
        appName: app.name,
        ascKey: credentials.ascKey,
        log,
        dryRun,
        confirmCreate,
      });
    }
    const extensions = yield* resolveExtensionBundleIds(app, platform);
    // Preflight BEFORE the long archive: surface an unregistered App ID or a missing capability on any
    // target now, while the fix is one command, instead of after a ~15-minute compile fails at exit 65.
    if (!dryRun)
      yield* warnUnreadySigningTargets(credentials.ascKey, app, bundleId, extensions, log);
    if (credentials.signing) {
      const reused = yield* reuseCachedSigning(
        credentials.signing,
        credentials.ascKey,
        log,
        dryRun,
      );
      if (reused) return reused;
    }
    if (!dryRun && credentials.signing === undefined)
      yield* log.note(
        `No cached signing assets for ${bundleId} - provisioning now (you'll confirm each Apple resource).`,
      );
    return yield* ensureSigningCredentials({
      platform,
      bundleId,
      appName: app.name,
      ascKey: credentials.ascKey,
      log,
      dryRun,
      confirmCreate,
      extensions,
    });
  });
/**
 * Resolve the upload keystore: reuse silently when cached, otherwise provision (or import) it inline.
 * The Android twin of {@link resolveSigning} - the build never hard-blocks; it offers setup in place.
 */
export const resolveKeystore = (
  credentials: AndroidCredentials,
  app: AppDescriptor,
  log: Logger,
  dryRun: boolean,
) =>
  Effect.gen(function* () {
    const launchPrompt = yield* LaunchPrompt;
    if (credentials.keystore) {
      yield* log.step(
        'keystore',
        `reusing upload keystore (alias ${credentials.keystore.alias})`,
        'upload-key',
      );
      return credentials.keystore;
    }
    if (!dryRun)
      yield* log.note(`No cached upload keystore for ${app.name} - provisioning one now.`);
    return yield* ensureUploadKeystore({
      appName: app.name,
      log,
      dryRun,
      confirmCreate: (message) => interactiveConfirm(launchPrompt, message),
    });
  });
