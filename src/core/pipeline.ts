/**
 * The build → submit pipeline: the linear spine that runs every step in order and is the only
 * place that knows the whole flow. Each step is a clean labelled line (expanded by `--explain`),
 * and the providers it calls are selected by name from config, so swapping infrastructure never
 * touches this file.
 *
 * `--dry-run` rehearses the entire flow — printing each step and the work it WOULD do — without a
 * network call, a build, or any change to your account, so it runs on a machine with no API key.
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cancel, confirm, isCancel, select, text } from '@clack/prompts';
import type {
  AccountRecord,
  AndroidCredentials,
  AndroidReleaseOptions,
  AppDescriptor,
  AppleCredentials,
  BuildArtifact,
  BuildCredentials,
  BuildProfile,
  Distribution,
  KeystoreAssets,
  LaunchConfig,
  Platform,
  PlayTrack,
  RemoteTarget,
  ResolvedBuildContext,
  SigningAssets,
  SizeReport,
  SubmitTarget,
} from './types.js';
import {
  formatAccountSummary,
  refreshIdentityIfStale,
  resolveBuildAccount,
  setActiveKeyId,
} from './accounts.js';
import { loadConfig, writeAppVersion } from './config.js';
import { checkApp, formatFinding } from './configCheck.js';
import { resolveBuildSecrets } from './buildSecrets.js';
import { notify, type NotifyEvent } from './notify.js';
import { pickOne } from './prompt.js';
import {
  compareVersions,
  formatVersion,
  highestVersion,
  nextVersion,
  parseVersion,
  type BumpKind,
} from './version.js';
import { readLastApp, readLastBump, rememberLastRun } from './lastRun.js';
import { ccacheOfferDeclined, markCcacheOfferDeclined } from './firstRun.js';
import { ensureCcacheInstalled } from './toolchain.js';
import {
  ENV_SOURCE,
  envInjectionRows,
  formatEnvTable,
  missingKeys,
  resolveEnv,
  secretLookingKeys,
  type ResolvedEnv,
} from './env.js';
import { beginBuildLog, buildLogId, endBuildLog } from './buildLog.js';
import { getBuildEngine, getCredentialsProvider, getSubmitter } from './registry.js';
import { resolveArtifactDir, resolveStorageProvider } from './storage.js';
import { ensureArtifactDirIgnored } from './gitignore.js';
import { resolveRetentionDays } from './artifactRetention.js';
import { createLogger, type Logger } from './logger.js';
import type { GlossaryTopic } from './glossary.js';
import { capture, exists, run } from './exec.js';
import { buildConsoleUrl } from './consoleLinks.js';
import { nativeProjectDirName, nativeTargetHint, platformLabel } from './platform.js';
import { discoverExtensionBundleIds, multiTargetSigningWarnings } from './appleTargets.js';
import { isInteractive, runWithProgress, withSpinner } from './progress.js';
import { AppStoreConnectClient } from '../apple/ascClient.js';
import { ensureAdHocSigningCredentials, ensureSigningCredentials } from '../apple/credentials.js';
import {
  appGroupContainers,
  appGroupPortalNotice,
  mapEntitlementsToCapabilities,
} from './capabilities.js';
import { distributeArtifact } from './distribute.js';
import { ensureUploadKeystore } from '../google/credentials.js';
import { GooglePlayClient, parseServiceAccount } from '../google/playClient.js';

/** Options for one `launch build` invocation. */
export interface BuildRunOptions {
  platform: Platform;
  /** App handle (`--app`); when omitted the pipeline picks the only app or prompts. */
  appName?: string | undefined;
  /** Profile name (`--profile`); defaults to `production`. */
  profileName: string;
  /** Expand each step into a teaching block (`--explain`). */
  explain: boolean;
  /** Upload after building (`--no-submit` disables). */
  submit: boolean;
  /** Where a submission lands (testing track vs production). */
  target: SubmitTarget;
  /** Android-only: Play track override (`--track`). Falls back to the profile, then `internal`. */
  track?: PlayTrack;
  /** Android-only: staged-rollout fraction override (`--rollout`), 0–1. Falls back to the profile, then 1. */
  rollout?: number;
  /** Rehearse the flow with no real changes (`--dry-run`). */
  dryRun: boolean;
  /**
   * Per-run soft size-budget override in MB (`--size-budget`, or the wizard's custom-budget prompt). When
   * set it wins over the profile's `sizeBudgetMB` for this build only — `launch.config.ts` is untouched.
   * See {@link resolveSizeBudgetMB}.
   */
  sizeBudgetMB?: number;
  /** Skip the interactive pre-upload confirmation (`--yes`); always implied in CI / non-TTY. */
  yes?: boolean;
  /** Force a from-scratch build (`--clean`); omitted/false lets the fingerprint decide. iOS-gated; Android cleans too. */
  forceClean?: boolean;
  /** Build on a remote Mac (AWS EC2 Mac / a Mac over SSH) instead of locally. iOS-only. */
  remote?: RemoteTarget;
  /** Apple account to build with (`--account`): a label or Key ID. Defaults to the active account. iOS-only. */
  account?: string;
  /** How to distribute (`--distribution`): `store` (default, TestFlight/Play) or `internal` (ad-hoc install link). */
  distribution?: Distribution;
  /** Inline env overrides from repeated `--env KEY=VAL`; the highest-precedence layer. */
  envOverrides?: Record<string, string>;
  /** Opt into `.env.local` (`--include-local`); off by default to avoid surprise local env. */
  includeLocal?: boolean;
  /** Print the resolved env provenance table (`--print-env`) and exit without building. */
  printEnv?: boolean;
  /**
   * iOS version-bump selector (`--bump`). A {@link BumpKind} applies that bump non-interactively (and wins
   * over a remembered pick); `"ask"` forces the prompt; omitted falls back to the remembered pick, then the
   * prompt. See {@link resolveBumpKind}.
   */
  bump?: BumpKind | 'ask';
}

/**
 * The shared front half of every build path: config + app + profile + validated env + a logger.
 *
 * Produced by {@link prepareBuild} and consumed by the local spine ({@link runLocalBuild}), the remote
 * pipeline (`core/remotePipeline.ts`), and the EAS handoff (`core/easPipeline.ts`) so all three select
 * the app, validate `.env`, and log the header identically — the divergence is only in HOW they build.
 */
export interface PreparedBuild {
  config: LaunchConfig;
  app: AppDescriptor;
  profile: ResolvedBuildContext['profile'];
  env: Record<string, string>;
  ctx: ResolvedBuildContext;
  log: Logger;
}

/** Placeholder API key used in `--dry-run`, so the flow runs without an imported credential. */
export const DRY_RUN_KEY = { keyId: 'DRYRUN', issuerId: 'DRYRUN', p8: '' };

/**
 * The built-in iOS provider defaults that `config` carries by default, and their Android twins.
 *
 * `buildEngine`/`submit` are single, platform-defaulted config fields: an iOS-only config needs
 * nothing, and an Android build swaps the *iOS baseline default* for its Android twin. Any non-default
 * override (e.g. `eas`) is honored as-is on both platforms — see {@link resolveBuildEngineName}.
 */
const IOS_BUILD_ENGINE = 'fastlane';
const IOS_SUBMITTER = 'app-store-connect';
const ANDROID_BUILD_ENGINE = 'gradle';
const ANDROID_SUBMITTER = 'google-play';

/** The build engine name for a platform, swapping the iOS baseline default (`fastlane`) for `gradle` on Android. */
export function resolveBuildEngineName(config: LaunchConfig, platform: Platform): string {
  if (platform === 'android' && config.buildEngine === IOS_BUILD_ENGINE)
    return ANDROID_BUILD_ENGINE;
  return config.buildEngine;
}

/** The standard store for a platform: Play for Android, App Store Connect for every Apple platform. */
function defaultSubmitter(platform: Platform): string {
  return platform === 'android' ? ANDROID_SUBMITTER : IOS_SUBMITTER;
}

/**
 * The store(s) a build for `platform` is submitted to — the seam that decouples the build target from the
 * store, so one build can reach several. Two `config.submit` shapes resolve here:
 *
 * - a **string** (the original shape) yields exactly one store: the configured submitter, mapped to
 *   `google-play` for an Android build under the iOS default — so every existing config is unchanged; or
 * - a **per-platform map** (`SubmitByPlatform`) yields its configured list for the platform, defaulting to
 *   the platform's standard store when that platform is omitted.
 *
 * See `docs/adr/0006-platform-store-split.md`.
 */
export function resolveSubmitters(config: LaunchConfig, platform: Platform): string[] {
  if (typeof config.submit === 'string') {
    if (platform === 'android' && config.submit === IOS_SUBMITTER) return [ANDROID_SUBMITTER];
    return [config.submit];
  }
  const configured = config.submit[platform];
  return configured && configured.length > 0 ? configured : [defaultSubmitter(platform)];
}

/** The primary store for a platform — the first of {@link resolveSubmitters}; used where one name is wanted (e.g. the build preview). */
export function resolveSubmitterName(config: LaunchConfig, platform: Platform): string {
  return resolveSubmitters(config, platform)[0] ?? defaultSubmitter(platform);
}

/**
 * Upload `artifactPath` to every store {@link resolveSubmitters configured} for `platform`, in order, and
 * return the store names. A single-store config submits to exactly one (so an iOS / Play-only setup
 * behaves as before); a per-platform `submit` map fans an Android build out to Play plus alternative
 * stores. Each store is a registered `Submitter` resolved by name, so adding a store never changes this loop.
 */
export async function submitToStores(
  config: LaunchConfig,
  platform: Platform,
  artifactPath: string,
  target: SubmitTarget,
  credentials: BuildCredentials,
  ctx: ResolvedBuildContext,
): Promise<string[]> {
  const stores = resolveSubmitters(config, platform);
  for (const store of stores) {
    await getSubmitter(store).submit(artifactPath, target, credentials, ctx);
  }
  return stores;
}

/**
 * Resolve the Android track + rollout for one invocation: an explicit `--track`/`--rollout` wins,
 * then the profile default, then the safe fallback (`internal` for a testing target, `production`
 * only when the target itself is production). The result rides on {@link ResolvedBuildContext.android}
 * so the Google Play submitter reads one source of truth.
 */
export function resolveAndroidRelease(
  options: Pick<BuildRunOptions, 'target' | 'track' | 'rollout'>,
  profile: BuildProfile,
): AndroidReleaseOptions {
  const fallback: PlayTrack = options.target === 'production' ? 'production' : 'internal';
  return {
    track: options.track ?? profile.track ?? fallback,
    rollout: options.rollout ?? profile.rollout ?? 1.0,
  };
}

/** The soft size budget (MB) applied when neither the run nor the profile sets one. */
export const DEFAULT_SIZE_BUDGET_MB = 200;

/**
 * The soft size budget (MB) the pre-upload gate enforces for one run: a per-run override
 * (`--size-budget` / the wizard's custom-budget prompt) wins, then the profile's `sizeBudgetMB`, then
 * {@link DEFAULT_SIZE_BUDGET_MB}. One source of truth for the three `confirmUpload` call sites (local
 * iOS, local Android, and the EAS handoff) so the precedence can't drift between them.
 */
export function resolveSizeBudgetMB(
  options: Pick<BuildRunOptions, 'sizeBudgetMB'>,
  profile: Pick<BuildProfile, 'sizeBudgetMB'>,
): number {
  return options.sizeBudgetMB ?? profile.sizeBudgetMB ?? DEFAULT_SIZE_BUDGET_MB;
}

export const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Pick the app to build: an explicit `--app`, the sole discovered app, or an interactive prompt. The
 * prompt is the shared {@link pickOne}, which past a threshold (large monorepos) switches the flat list
 * to a fuzzy type-to-search over the name and bundle/package id. With no TTY and more than one app it
 * refuses to guess and tells the user to pass `--app`, rather than silently building the wrong one.
 */
export async function selectApp(
  apps: AppDescriptor[],
  appName: string | undefined,
): Promise<AppDescriptor> {
  if (apps.length === 0)
    throw new Error('No apps found. Run Launch from a repo containing at least one app.json.');
  if (appName) {
    const match = apps.find((app) => app.name === appName);
    if (!match)
      throw new Error(
        `App "${appName}" not found. Available: ${apps.map((a) => a.name).join(', ')}.`,
      );
    return match;
  }
  const sole = apps[0];
  if (apps.length === 1 && sole) return sole;

  // Pre-select the app built last time (when it's still discovered) so a re-run is one keystroke; the
  // pick still shows, so a monorepo never silently builds the wrong app.
  const lastApp = apps.find((app) => app.name === readLastApp());
  return pickOne<AppDescriptor>({
    message: `Which app? (${apps.length} found)`,
    options: apps.map((app) => {
      const hint = app.bundleId ?? app.packageName;
      return hint ? { value: app, label: app.name, hint } : { value: app, label: app.name };
    }),
    canPrompt: process.stdin.isTTY,
    nonInteractive: {
      kind: 'require',
      flagHint: '— pass --app <name> to choose one non-interactively.',
    },
    ...(lastApp ? { initialValue: lastApp } : {}),
  });
}

/** The interactive build-time account picker: choose among onboarded accounts and make the pick active. */
async function pickAccount(accounts: AccountRecord[]): Promise<AccountRecord> {
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
 * Stamp a single key into the build platform's generated `Info.plist`. Stamping the plist directly —
 * rather than only writing `app.json` — is what makes a version/build choice take effect even when the
 * native project is committed (so prebuild, which would otherwise read `app.json`, never runs). The
 * native directory is the platform's ({@link nativeProjectDirName}: `ios/` for iOS & tvOS, `macos/`,
 * `visionos/`). Returns whether a target Info.plist was found.
 */
async function setNativePlistValue(
  appDir: string,
  platform: Platform,
  key: string,
  value: string | number,
): Promise<boolean> {
  const nativeDir = join(appDir, nativeProjectDirName(platform));
  if (!existsSync(nativeDir)) return false;
  const targetDir = readdirSync(nativeDir).find((entry) =>
    existsSync(join(nativeDir, entry, 'Info.plist')),
  );
  if (!targetDir) return false;
  await run('/usr/libexec/PlistBuddy', [
    '-c',
    `Set :${key} ${value}`,
    join(nativeDir, targetDir, 'Info.plist'),
  ]);
  return true;
}

/** Set the build number (`CFBundleVersion`) into the platform's generated Info.plist. */
function setIosBuildNumber(
  appDir: string,
  platform: Platform,
  buildNumber: number,
): Promise<boolean> {
  return setNativePlistValue(appDir, platform, 'CFBundleVersion', buildNumber);
}

/** Set the marketing version (`CFBundleShortVersionString`) into the platform's generated Info.plist. */
function setIosMarketingVersion(
  appDir: string,
  platform: Platform,
  version: string,
): Promise<boolean> {
  return setNativePlistValue(appDir, platform, 'CFBundleShortVersionString', version);
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
function resolveExtensionBundleIds(app: AppDescriptor, platform: Platform): string[] {
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
async function warnUnreadySigningTargets(
  ascKey: AppleCredentials['ascKey'],
  app: AppDescriptor,
  bundleId: string,
  extensions: string[],
  log: Logger,
): Promise<void> {
  try {
    const client = new AppStoreConnectClient(ascKey);
    const required = mapEntitlementsToCapabilities(app.iosEntitlements).enable;
    const readiness = await Promise.all(
      [
        { id: bundleId, required },
        ...extensions.map((id) => ({ id, required: [] as string[] })),
      ].map(async ({ id, required: needed }) => {
        const bundle = await client.findBundleId(id);
        if (!bundle) return { bundleId: id, registered: false, missingCapabilities: [] };
        const enabled = new Set(
          (await client.listBundleIdCapabilities(bundle.id)).map((cap) => cap.capabilityType),
        );
        return {
          bundleId: id,
          registered: true,
          missingCapabilities: needed.filter((cap) => !enabled.has(cap)),
        };
      }),
    );
    for (const warning of multiTargetSigningWarnings(readiness)) log.warn(warning);
  } catch {
    // A preflight read shouldn't sink the build — provisioning below still surfaces a real failure.
  }
}

/**
 * Resolve signing assets: reuse silently when cached, otherwise (interactively) provision them now.
 * Mirrors the locked decision — the build never hard-blocks; it offers to run setup inline.
 */
async function resolveSigning(
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
  const appGroupNotice = appGroupPortalNotice(appGroupContainers(app.iosEntitlements));
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
    log.step(
      'signing',
      `reusing cert ${credentials.signing.certSerial} · ${credentials.signing.profileName}`,
      'code-signing',
    );
    return credentials.signing;
  }
  if (!dryRun)
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
async function resolveKeystore(
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

/**
 * Resolve the layered env for any command (build / release / update) from an app + profile: keychain
 * secrets resolved here, then handed with the dotenv files, inline `profile.env`, and `--env` flags to
 * the one precedence ladder in {@link resolveEnv}. The single place keychain meets the resolver, so
 * every command injects identical env (issue #25). Pure resolver stays keychain-free for testability.
 */
export async function resolveCommandEnv(input: {
  app: AppDescriptor;
  profile: BuildProfile;
  cliEnv?: Record<string, string> | undefined;
  includeLocal?: boolean | undefined;
  envExclude?: string[] | undefined;
}): Promise<ResolvedEnv> {
  const secrets = await resolveBuildSecrets(input.app.name, input.profile.name);
  return resolveEnv({
    appDir: input.app.dir,
    profileName: input.profile.name,
    profileEnv: input.profile.env,
    envFile: input.profile.envFile,
    secrets,
    cliEnv: input.cliEnv,
    includeLocal: input.includeLocal,
    envExclude: input.envExclude,
  });
}

/**
 * Gate + warn on a resolved env before an artifact-baking command (build, update): hard-fail on any
 * `.env.example` key that's missing (names matched by `exclude` — the config's `envExclude` — are exempt,
 * since they're intentionally backend-only), then warn about secret-looking names coming from a plaintext
 * source (dotenv files / inline `env:`) since they'd be bundled into the app. Keychain secrets and `--env`
 * flags are exempt — the former are meant to be secret, the latter an explicit override; anything in
 * `envExclude` is already gone from `resolved.values`, so it never reaches this warning. Release does NOT
 * call this: it promotes a prebuilt artifact, so its env never bakes into the app.
 */
export function validateResolvedEnv(
  appDir: string,
  resolved: ResolvedEnv,
  log: Logger,
  exclude: string[] = [],
): void {
  const missing = missingKeys(appDir, resolved.values, exclude);
  if (missing.length > 0) {
    throw new Error(
      `Missing env keys (in .env.example, absent from your env): ${missing.join(', ')}`,
    );
  }
  for (const name of secretLookingKeys(resolved.values)) {
    const source = resolved.sources[name];
    if (source === ENV_SOURCE.secret || source === ENV_SOURCE.flag) continue;
    log.warn(
      `"${name}" looks like a backend secret (from ${source}) — it would be bundled into the app. If the app needs it at build time, store it with \`launch secret set ${name}\`; if it's backend-only, add it to \`envExclude\` in launch.config.ts.`,
    );
  }
}

/**
 * Resolve env exactly as a build would and print the masked provenance table (`--print-env`), with no
 * config preflight or build work — a clean "what env will be injected, and from where" preview.
 */
async function previewEnv(options: BuildRunOptions): Promise<void> {
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.appName);
  const profile = config.profiles[options.profileName] ?? {
    name: options.profileName,
    sizeBudgetMB: 200,
  };
  const resolved = await resolveCommandEnv({
    app,
    profile,
    cliEnv: options.envOverrides,
    includeLocal: options.includeLocal,
    envExclude: config.envExclude,
  });
  console.log(formatEnvTable(resolved));
}

/**
 * Resolve the shared front half of a build: config, the chosen app, the profile, a validated env, a
 * logger, and the {@link ResolvedBuildContext}. Identical for iOS and Android — every build path
 * (local, remote, EAS) starts here so app selection and env validation never drift; the platforms
 * diverge only in HOW they build (see {@link runIosBuild} / {@link runAndroidBuild}).
 */
export async function prepareBuild(options: BuildRunOptions): Promise<PreparedBuild> {
  const { dryRun, platform } = options;
  const log = createLogger(options.explain);

  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.appName);
  const profile = config.profiles[options.profileName] ?? {
    name: options.profileName,
    sizeBudgetMB: 200,
  };
  const remoteSuffix = options.remote
    ? options.remote.kind === 'aws'
      ? ' · remote(aws)'
      : ' · remote(ssh)'
    : '';
  log.step(
    'config',
    `${log.chip(app.name)} · ${profile.name} · ${platform}${dryRun ? ' · dry-run' : ''}${remoteSuffix}`,
  );

  // Resolve + validate env before any expensive work, so a missing/secret-looking key fails fast.
  const resolved = await resolveCommandEnv({
    app,
    profile,
    cliEnv: options.envOverrides,
    includeLocal: options.includeLocal,
    envExclude: config.envExclude,
  });
  const env = resolved.values;
  validateResolvedEnv(app.dir, resolved, log, config.envExclude);
  const secretCount = Object.values(resolved.sources).filter(
    (source) => source === ENV_SOURCE.secret,
  ).length;
  const varCount = Object.keys(env).length;
  const keychainNote = secretCount > 0 ? ` (${secretCount} from keychain)` : '';
  // The count summary, then one provenance row per var (KEY → source, no values) so a run visibly
  // confirms every layer reaches the bundle step — local iOS used to drop everything above `.env`.
  log.step(
    'env',
    `${varCount} vars validated${keychainNote}${varCount > 0 ? ' → injecting into bundle:' : ''}`,
    'env-vars',
  );
  for (const row of envInjectionRows(resolved)) log.info(row);
  if (resolved.excluded.length > 0) {
    log.tip(`excluded (envExclude, not injected): ${resolved.excluded.join(', ')}`);
  }

  // Preflight the app config against known native-config footguns, before any expensive native work.
  // Warnings are surfaced; a build-breaking error (an invalid bundle id / package, a splash with no
  // backgroundColor) hard-stops here rather than failing deep inside xcodebuild/gradle minutes later.
  const findings = await checkApp(app, platform);
  for (const finding of findings) {
    if (finding.severity === 'warn') log.warn(formatFinding(finding));
  }
  const configErrors = findings.filter((finding) => finding.severity === 'error');
  if (configErrors.length > 0) {
    throw new Error(
      `App config preflight failed for ${app.name}:\n` +
        configErrors.map((finding) => `  ✗ ${formatFinding(finding)}`).join('\n'),
    );
  }
  log.step('config check', findings.length > 0 ? `${findings.length} warning(s)` : 'no footguns');

  const android = platform === 'android' ? resolveAndroidRelease(options, profile) : undefined;
  const ctx: ResolvedBuildContext = {
    platform,
    app,
    profile,
    env,
    explain: options.explain,
    dryRun,
    forceClean: options.forceClean ?? false,
    ...(android ? { android } : {}),
    ...(options.distribution ? { distribution: options.distribution } : {}),
  };
  return { config, app, profile, env, ctx, log };
}

/**
 * Run a build, then fire any configured completion notification. Throws with a clear message on any
 * failed step — but first notifies the failure, so an unattended/CI build pings on both outcomes.
 * Dry-runs never notify (they change nothing). See {@link dispatchBuild} for the path selection.
 */
export async function runBuild(options: BuildRunOptions): Promise<void> {
  if (options.printEnv) {
    await previewEnv(options);
    return;
  }
  const prepared = await prepareBuild(options);
  try {
    await dispatchBuild(prepared, options);
    if (!options.dryRun) await notify(prepared.config, await buildSuccessEvent(prepared, options));
  } catch (error) {
    if (!options.dryRun) await notify(prepared.config, buildFailureEvent(prepared, options, error));
    throw error;
  }
}

/**
 * The contract every build fork satisfies: take the shared {@link PreparedBuild} front half plus the run
 * options and drive the build (and optional submit) to completion. The three adapters — the local Mac
 * spine ({@link runLocalBuild}), the remote-Mac pipeline (`core/remotePipeline.ts`), and the EAS handoff
 * (`core/easPipeline.ts`) — are interchangeable behind this type; {@link resolveBuildTransport} picks
 * which one a run uses and {@link dispatchBuild} invokes it. Naming the contract is what turns fork
 * selection into a testable seam rather than an inline branch.
 */
export type BuildTransport = (prepared: PreparedBuild, options: BuildRunOptions) => Promise<void>;

/**
 * Which build fork a run resolves to, plus the data that fork needs. A discriminated union so the remote
 * {@link RemoteTarget} rides only on the `remote` variant (no optional-but-always-set field): `local`
 * builds on this machine, `remote` on a Mac elsewhere, `eas` in Expo's cloud.
 */
export type BuildTransportChoice =
  | { kind: 'local' }
  | { kind: 'remote'; remote: RemoteTarget }
  | { kind: 'eas' };

/**
 * Pick the build fork for one run, by the same precedence the dispatch has always used — extracted as a
 * pure function so the decision is unit-testable without driving a real (or even dry) build:
 * - Android always builds locally; it has no off-Mac problem, so `--remote` / `eas` never apply.
 * - For iOS, `--remote` wins (a config `buildEngine: "remote-mac"` defaults the target to AWS),
 * - then `buildEngine: "eas"` hands off to Expo,
 * - otherwise the local Mac spine.
 * - tvOS / macOS / visionOS build locally only: the off-Mac forks are iOS-only in v1 (the remote host
 *   bootstrap is iOS-shaped and EAS has no profile for them), so an explicit off-Mac request fails fast.
 */
export function resolveBuildTransport(
  platform: Platform,
  buildEngine: string,
  remoteFlag: RemoteTarget | undefined,
): BuildTransportChoice {
  if (platform === 'android') return { kind: 'local' };
  const remote: RemoteTarget | undefined =
    remoteFlag ?? (buildEngine === 'remote-mac' ? { kind: 'aws' } : undefined);
  if (platform !== 'ios') {
    if (remote) {
      throw new Error(
        `Remote builds are iOS-only — build ${platformLabel(platform)} on a local Mac (drop \`--remote\` / \`buildEngine: "remote-mac"\`).`,
      );
    }
    if (buildEngine === 'eas') {
      throw new Error(
        `EAS does not build ${platformLabel(platform)} — build it on a local Mac (drop \`buildEngine: "eas"\`).`,
      );
    }
    return { kind: 'local' };
  }
  if (remote) return { kind: 'remote', remote };
  if (buildEngine === 'eas') return { kind: 'eas' };
  return { kind: 'local' };
}

/**
 * Select the build fork via {@link resolveBuildTransport}, then invoke that {@link BuildTransport}
 * adapter. The remote / EAS modules are imported lazily so a local-only build never loads the host or
 * Expo code paths.
 */
async function dispatchBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const choice = resolveBuildTransport(
    options.platform,
    prepared.config.buildEngine,
    options.remote,
  );
  switch (choice.kind) {
    case 'local':
      return runLocalBuild(prepared, options);
    case 'remote': {
      const { runRemoteBuild } = await import('./remotePipeline.js');
      return runRemoteBuild(prepared, { ...options, remote: choice.remote });
    }
    case 'eas': {
      const { runEasBuild } = await import('./easPipeline.js');
      return runEasBuild(prepared, options);
    }
  }
}

/**
 * The success {@link NotifyEvent} for a finished run, read back from the artifact just stored (the
 * source of truth for the build number + size). `event` is `submit` once a store upload happened, else
 * `build` (a `--no-submit` or internal install-link run). Falls back to the app's config version when
 * no stored artifact is found (e.g. a remote/EAS path that stores elsewhere).
 */
async function buildSuccessEvent(
  prepared: PreparedBuild,
  options: BuildRunOptions,
): Promise<NotifyEvent> {
  const { config, app, ctx } = prepared;
  const internal = ctx.distribution === 'internal';
  const latest = (await resolveStorageProvider(config).list()).find(
    (artifact) => artifact.appName === app.name && artifact.platform === options.platform,
  );
  const event: NotifyEvent = {
    event: options.submit && !internal ? 'submit' : 'build',
    status: 'success',
    app: app.name,
    platform: options.platform,
    version: latest?.version ?? app.version ?? '0.0.0',
    destination: internal
      ? 'internal install link'
      : receiptDestination(options.platform, options, ctx.android?.track),
  };
  if (latest) {
    event.buildNumber = latest.buildNumber;
    const size = worstDownloadBytes(latest.sizeReport);
    if (size > 0) event.sizeBytes = size;
  }
  return event;
}

/** The failure {@link NotifyEvent} for a run that threw, carrying the error message and what's known. */
function buildFailureEvent(
  prepared: PreparedBuild,
  options: BuildRunOptions,
  error: unknown,
): NotifyEvent {
  const internal = prepared.ctx.distribution === 'internal';
  return {
    event: options.submit && !internal ? 'submit' : 'build',
    status: 'failure',
    app: prepared.app.name,
    platform: options.platform,
    version: prepared.app.version ?? '0.0.0',
    error: error instanceof Error ? error.message : String(error),
  };
}

/** The local spine: fork by platform after the shared front (prepareBuild) and before the shared tail. */
async function runLocalBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  return prepared.ctx.platform === 'android'
    ? runAndroidBuild(prepared, options)
    : runIosBuild(prepared, options);
}

/** The iOS spine: prebuild → resolve creds/signing → build number → gym → size → store → submit. */
async function runIosBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const { config, app, ctx, log } = prepared;
  const { dryRun } = options;

  // 2. Generate the native project only when it's missing (bare/committed ios/ is used as-is).
  await ensureNativeProject(ctx, log);

  // 2.5. Resolve which Apple account to build with (skipped in dry-run, which uses the placeholder key).
  let account: AccountRecord | undefined;
  if (!dryRun) {
    account = await resolveIosAccount(options, log);
    ctx.account = account.keyId;
  }

  // 3. Resolve the API key, then reuse-or-provision the distribution cert + profile.
  const resolved: BuildCredentials = dryRun
    ? { platform: 'ios', ascKey: DRY_RUN_KEY }
    : await getCredentialsProvider(config.credentials).resolve(ctx);
  if (resolved.platform !== 'ios')
    throw new Error('Expected Apple (App Store Connect) credentials for an Apple build.');
  log.step(
    'credentials',
    dryRun ? 'dry-run (no key needed)' : `key ${resolved.ascKey.keyId}`,
    'asc-api-key',
  );
  const signing = await resolveSigning(resolved, app, ctx.platform, log, dryRun, ctx.distribution);
  const credentials: BuildCredentials = { platform: 'ios', ascKey: resolved.ascKey, signing };
  const bundleId = app.bundleId ?? '';
  const internal = ctx.distribution === 'internal';

  // 3b. Suggest the next marketing version from what's already on the store (interactive store uploads only —
  // an internal install-link build doesn't touch the store, so the store-version prompt is skipped). The
  // applied bump kind is remembered after a successful build (see the rememberLastRun calls below).
  let resolvedBump: BumpKind | undefined;
  if (options.submit && !internal) {
    resolvedBump = await resolveMarketingVersion(
      resolved.ascKey,
      bundleId,
      app,
      ctx.platform,
      options,
      log,
    );
  }

  // 4. Auto-bump the build number from the last one Apple has on record.
  const buildNumber = dryRun
    ? await nextBuildNumber(resolved.ascKey, bundleId, dryRun)
    : await withSpinner('Checking last build number on App Store Connect', () =>
        nextBuildNumber(resolved.ascKey, bundleId, dryRun),
      );
  const stamped = dryRun ? false : await setIosBuildNumber(app.dir, ctx.platform, buildNumber);
  log.step(
    'build number',
    dryRun
      ? `would set next build number (≈${buildNumber})`
      : stamped
        ? `set to ${buildNumber}`
        : `${buildNumber} (could not stamp Info.plist)`,
    'build-number',
  );

  // 5. Compile, sign, export, and analyze size — clean or incremental per the build fingerprint.
  if (!dryRun) await nudgeIfNoCcache(log);
  const { artifactPath, sizeReport, cleanBuilt } = await runBuildStep(prepared, buildNumber, () =>
    getBuildEngine(resolveBuildEngineName(config, 'ios')).build(ctx, credentials),
  );
  log.step(
    'build',
    dryRun
      ? 'skipped (dry-run)'
      : `${cleanBuilt ? 'clean (from scratch)' : 'incremental (cache warm)'} · ${artifactPath}`,
    'incremental-build',
  );
  if (!dryRun) await reportCcacheStats(log);

  // 6. Show the per-device size readout (the budget decision happens at the upload boundary).
  reportSize(sizeReport, log);

  // 7. Store the artifact (shared with Android).
  await storeArtifact(prepared, artifactPath, buildNumber, sizeReport, cleanBuilt);

  // 8a. Internal distribution: skip the store entirely — upload an ad-hoc install link instead.
  if (internal) {
    await distributeArtifact({
      config,
      app,
      platform: 'ios',
      artifactPath,
      version: app.version ?? '0.0.0',
      buildNumber,
      bundleId,
      dryRun,
      log,
    });
    if (dryRun) {
      log.gap();
      log.info(
        `Done. ${app.name} ${app.version ?? '0.0.0'} (${buildNumber}) · dry-run, nothing changed`,
      );
    } else {
      rememberLastRun(app.name, resolvedBump);
    }
    return;
  }

  // 8. Confirm the upload (size shown; budget enforced here), submit, then report processing status.
  const destination = options.target === 'testing' ? 'TestFlight' : 'App Store review';
  if (options.submit) {
    if (dryRun) {
      log.step('submit', `would upload to ${destination}`, 'testflight');
    } else {
      await confirmUpload({
        report: sizeReport,
        budgetMB: resolveSizeBudgetMB(options, prepared.profile),
        destination,
        app,
        version: app.version ?? '0.0.0',
        buildNumber,
        previous: await previousBuild(config, app, 'ios', buildNumber),
        yes: options.yes ?? false,
        log,
      });
      await submitToStores(config, 'ios', artifactPath, options.target, credentials, ctx);
      log.step(
        'submit',
        options.target === 'testing' ? 'uploaded to TestFlight' : 'submitted for App Store review',
        'testflight',
      );
      if (options.target === 'testing' && bundleId) {
        await reportProcessing(resolved.ascKey, bundleId, buildNumber, log);
      }
    }
  }

  if (dryRun) {
    log.gap();
    log.info(
      `Done. ${app.name} ${app.version ?? '0.0.0'} (${buildNumber}) · dry-run, nothing changed`,
    );
    return;
  }
  // Backfill this account's Team ID + app names from Apple the first time we have a live key in hand.
  if (account) await refreshIdentityIfStale(account, resolved.ascKey);
  const link =
    options.submit && bundleId
      ? await resolveAscBuildLink(resolved.ascKey, bundleId, options.target)
      : undefined;
  await renderReceipt({
    app,
    version: app.version ?? '0.0.0',
    buildNumber,
    report: sizeReport,
    destination: receiptDestination('ios', options),
    link,
    log,
  });
  // Remember this run's picks so the next build defaults to them (app pre-selected, bump auto-applied).
  rememberLastRun(app.name, resolvedBump);
}

/** The Android spine: prebuild → resolve service account + keystore → versionCode → gradle .aab → size → store → supply. */
async function runAndroidBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const { config, app, ctx, log } = prepared;
  const { dryRun } = options;
  const packageName = app.packageName;
  if (!packageName)
    throw new Error(`No Android application id for ${app.name}. Set android.package in app.json.`);

  // 2. Generate the native project only when it's missing (committed android/ is used as-is).
  await ensureAndroidProject(ctx, log);

  // 3. Resolve the Play service account, then reuse-or-provision the upload keystore.
  const resolved: BuildCredentials = dryRun
    ? { platform: 'android', serviceAccountJson: '' }
    : await getCredentialsProvider(config.credentials).resolve(ctx);
  if (resolved.platform !== 'android')
    throw new Error('Expected Android credentials for an Android build.');
  log.step(
    'credentials',
    dryRun ? 'dry-run (no service account needed)' : 'service account loaded',
    'service-account',
  );
  const keystore = await resolveKeystore(resolved, app, log, dryRun);
  const credentials: BuildCredentials = {
    platform: 'android',
    serviceAccountJson: resolved.serviceAccountJson,
    keystore,
  };

  // 4. Auto-bump the versionCode from the latest Google Play has on record (app.json as a floor).
  const versionCode = dryRun
    ? await nextVersionCode(
        resolved.serviceAccountJson,
        packageName,
        app.androidVersionCode ?? 0,
        dryRun,
      )
    : await withSpinner('Checking latest versionCode on Google Play', () =>
        nextVersionCode(
          resolved.serviceAccountJson,
          packageName,
          app.androidVersionCode ?? 0,
          dryRun,
        ),
      );
  const stamped = dryRun ? false : setAndroidVersionCode(app.dir, versionCode);
  log.step(
    'version code',
    dryRun
      ? `would set next versionCode (≈${versionCode})`
      : stamped
        ? `set to ${versionCode}`
        : `${versionCode} (could not stamp build.gradle)`,
    'version-code',
  );

  // 5. Compile, sign (upload key), export the .aab, and estimate the download with bundletool.
  const { artifactPath, sizeReport, cleanBuilt } = await runBuildStep(prepared, versionCode, () =>
    getBuildEngine(resolveBuildEngineName(config, 'android')).build(ctx, credentials),
  );
  log.step(
    'build',
    dryRun
      ? 'skipped (dry-run)'
      : `${cleanBuilt ? 'clean (from scratch)' : 'incremental (Gradle)'} · ${artifactPath}`,
    'incremental-build',
  );

  // 6. Show the size readout (bundletool estimate; the budget decision happens at the upload boundary).
  reportSize(sizeReport, log, 'bundletool');

  // 7. Store the artifact (shared with iOS).
  await storeArtifact(prepared, artifactPath, versionCode, sizeReport, cleanBuilt);

  // 8a. Internal distribution: skip the Play track — upload the .apk as a direct install link.
  if (ctx.distribution === 'internal') {
    await distributeArtifact({
      config,
      app,
      platform: 'android',
      artifactPath,
      version: app.version ?? '0.0.0',
      buildNumber: versionCode,
      dryRun,
      log,
    });
    if (dryRun) {
      log.gap();
      log.info(
        `Done. ${app.name} ${app.version ?? '0.0.0'} (${versionCode}) · dry-run, nothing changed`,
      );
    } else {
      rememberLastRun(app.name);
    }
    return;
  }

  // 8. Confirm the upload (size shown; budget enforced here), then submit via fastlane supply.
  const track = ctx.android?.track ?? 'internal';
  if (options.submit) {
    if (dryRun) {
      log.step('submit', `would upload to the ${track} track via fastlane supply`, 'play-track');
    } else {
      await confirmUpload({
        report: sizeReport,
        budgetMB: resolveSizeBudgetMB(options, prepared.profile),
        destination: `Google Play (${track} track)`,
        app,
        version: app.version ?? '0.0.0',
        buildNumber: versionCode,
        previous: await previousBuild(config, app, 'android', versionCode),
        yes: options.yes ?? false,
        log,
      });
      const stores = await submitToStores(
        config,
        'android',
        artifactPath,
        options.target,
        credentials,
        ctx,
      );
      log.step(
        'submit',
        stores.length > 1
          ? `uploaded to the ${track} track and ${stores.length - 1} more store(s)`
          : `uploaded to the ${track} track`,
        'play-track',
      );
    }
  }

  if (dryRun) {
    log.gap();
    log.info(
      `Done. ${app.name} ${app.version ?? '0.0.0'} (${versionCode}) · dry-run, nothing changed`,
    );
    return;
  }
  await renderReceipt({
    app,
    version: app.version ?? '0.0.0',
    buildNumber: versionCode,
    report: sizeReport,
    destination: receiptDestination('android', options, track),
    link: options.submit ? 'https://play.google.com/console' : undefined,
    log,
  });
  // Remember the app built so the next run's picker pre-selects it (Android has no marketing-bump prompt).
  rememberLastRun(app.name);
}

/** What {@link BuildEngine.build} resolves to — named so the build-log wrapper can pass it through. */
interface BuildOutput {
  artifactPath: string;
  sizeReport: SizeReport;
  cleanBuilt: boolean;
}

/**
 * Wrap the build-engine call so its native output is captured to a per-build log keyed by build id
 * (read back by `launch builds log` and the failure diagnostics). Skipped in dry-run — no real build
 * runs. Completion notifications fire separately at the dispatch boundary (see {@link runBuild}), so
 * this stays a single concern: own the log's lifecycle around the compile, nothing more.
 */
async function runBuildStep(
  prepared: PreparedBuild,
  buildNumber: number,
  build: () => Promise<BuildOutput>,
): Promise<BuildOutput> {
  const { ctx, app } = prepared;
  if (ctx.dryRun) return build();
  beginBuildLog(
    buildLogId({
      appName: app.name,
      version: app.version ?? '0.0.0',
      buildNumber,
      platform: ctx.platform,
    }),
  );
  try {
    return await build();
  } finally {
    endBuildLog();
  }
}

/** Store the built artifact (skipped in dry-run) and log its location. Shared by both platform spines. */
async function storeArtifact(
  prepared: PreparedBuild,
  artifactPath: string,
  buildNumber: number,
  sizeReport: SizeReport,
  cleanBuilt: boolean,
): Promise<void> {
  const { config, app, profile, ctx, log } = prepared;
  if (ctx.dryRun) {
    log.step('store', 'skipped (dry-run)');
    return;
  }
  const artifact: BuildArtifact = {
    path: artifactPath,
    platform: ctx.platform,
    appName: app.name,
    profile: profile.name,
    version: app.version ?? '0.0.0',
    buildNumber,
    sizeReport,
    clean: cleanBuilt,
    createdAt: new Date().toISOString(),
  };
  const provider = resolveStorageProvider(config);
  // Keep an in-repo `artifactDir` out of version control before the first binary lands — idempotent, and
  // a no-op for the global default or a cloud store. Guarantees "won't get committed" even if init was skipped.
  if (config.storage === 'local') {
    const ignored = await ensureArtifactDirIgnored(resolveArtifactDir(config.artifactDir));
    if (ignored.added)
      log.step('gitignore', `added ${ignored.entry ?? ''} (build artifacts stay out of git)`);
  }
  const stored = await provider.put(artifact);
  log.step('store', stored.location);

  // Retention: announce the policy under the store line, then sweep. `0` disables the auto-sweep; the
  // newest build per app+platform is always kept, so a promotable artifact never gets swept out from
  // under `launch release`. Only the local provider implements `prune` — cloud stores no-op here.
  const retentionDays = resolveRetentionDays(config);
  if (retentionDays > 0) {
    log.tip(`kept ~${retentionDays} days, then auto-pruned to save space (launch builds prune)`);
    if (provider.prune) {
      const swept = await provider.prune({ now: Date.now(), retentionDays });
      if (swept.pruned.length > 0) {
        const noun = swept.pruned.length === 1 ? 'build' : 'builds';
        log.step(
          'prune',
          `removed ${swept.pruned.length} old ${noun} >${retentionDays}d · freed ${mb(swept.freedBytes)}`,
        );
      }
    }
  }
}

/** The one-line notice when a build runs uncached. No fabricated multiplier — we have no measured baseline. */
const CCACHE_NOTICE =
  "ccache isn't installed — this build runs uncached. `launch doctor --fix` (or brew install ccache) speeds up repeat builds.";

/**
 * Before building, when ccache is missing, offer to install it inline (interactive only) so this build —
 * and every later one — is cached. Degrades to a one-line notice in CI / without Homebrew; once the offer
 * is declined it's remembered, so later builds show the notice but never re-prompt. Reuses doctor's
 * install+configure path via {@link ensureCcacheInstalled}, and never blocks or fails the build.
 */
async function nudgeIfNoCcache(log: Logger): Promise<void> {
  if (await exists('ccache')) return;
  if (ccacheOfferDeclined()) {
    log.warn(CCACHE_NOTICE);
    return;
  }
  switch (await ensureCcacheInstalled({ interactive: isInteractive() })) {
    case 'installed':
      log.step('ccache', 'installed + configured — this build is now cached', 'ccache');
      return;
    case 'declined':
      markCcacheOfferDeclined();
      log.warn(CCACHE_NOTICE);
      return;
    case 'skipped-no-brew':
    case 'skipped-noninteractive':
      log.warn(CCACHE_NOTICE);
      return;
  }
}

/** After an iOS build, surface a one-line ccache hit summary when ccache is present. Best-effort. */
async function reportCcacheStats(log: Logger): Promise<void> {
  if (!(await exists('ccache'))) return;
  try {
    const stats = await capture('ccache', ['-s']);
    const hitLine = stats.split('\n').find((line) => /hit/i.test(line));
    if (hitLine) log.step('cache', hitLine.trim(), 'ccache');
  } catch {
    /* ccache -s unavailable — skip the summary */
  }
}

/**
 * Ensure the Apple native Xcode project exists for `ctx.platform` before the build. iOS is generated by
 * Expo prebuild when absent (tvOS reuses the same `ios/` project — react-native-tvos targets it via the
 * build destination). macOS and visionOS have **no** prebuild generator, so a missing native project is a
 * hard, actionable gate: the user must commit one (react-native-macos / react-native-visionos) and re-run,
 * rather than have Launch silently prebuild an iOS-only project that can't archive their platform.
 */
async function ensureNativeProject(ctx: ResolvedBuildContext, log: Logger): Promise<void> {
  const platform = ctx.platform;
  const dirName = nativeProjectDirName(platform);
  const nativeDir = join(ctx.app.dir, dirName);
  if (existsSync(nativeDir)) {
    log.step('native project', `using existing ${dirName}/ (no prebuild needed)`, 'prebuild');
    return;
  }
  // Only iOS (and tvOS, which shares ios/) is generated by Expo prebuild. macOS/visionOS need a committed
  // native project — prebuild does not emit their target, so fail loud with the fix instead of mis-building.
  if (platform !== 'ios' && platform !== 'tvos') {
    throw new Error(
      `${platformLabel(platform)} native target not configured — Expo prebuild does not emit a ${platformLabel(platform)} ` +
        `target. Commit a native project (${nativeTargetHint(platform)}) at ${dirName}/, then re-run.`,
    );
  }
  // tvOS reuses ios/; if even that is missing, prebuild generates an iOS project but no tvOS target, so the
  // archive will fail later. Gate it here with the same actionable message rather than mis-building.
  if (platform === 'tvos') {
    throw new Error(
      `tvOS native target not configured — no ios/ project found. Commit a react-native-tvos project (its ` +
        `tvOS target lives in ios/), then re-run \`launch build tvos\`.`,
    );
  }
  if (ctx.dryRun) {
    log.step('prebuild', 'would run `expo prebuild --platform ios` (no ios/ found)', 'prebuild');
    return;
  }
  await runWithProgress('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], {
    label: 'Generating ios/ (expo prebuild)',
    cwd: ctx.app.dir,
    env: ctx.env,
  });
  log.step('prebuild', 'ios/ generated from app.json', 'prebuild');
}

/** Run `expo prebuild` only when there's no native `android/` yet; otherwise use what's committed. */
async function ensureAndroidProject(ctx: ResolvedBuildContext, log: Logger): Promise<void> {
  const androidDir = join(ctx.app.dir, 'android');
  if (existsSync(androidDir)) {
    log.step('native project', 'using existing android/ (no prebuild needed)', 'prebuild');
    return;
  }
  if (ctx.dryRun) {
    log.step(
      'prebuild',
      'would run `expo prebuild --platform android` (no android/ found)',
      'prebuild',
    );
    return;
  }
  await runWithProgress('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], {
    label: 'Generating android/ (expo prebuild)',
    cwd: ctx.app.dir,
    env: ctx.env,
  });
  log.step('prebuild', 'android/ generated from app.json', 'prebuild');
}

/** Resolve the next build number from App Store Connect, or a placeholder in dry-run. */
export async function nextBuildNumber(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  dryRun: boolean,
): Promise<number> {
  if (dryRun || !bundleId) return 1;
  const asc = new AppStoreConnectClient(ascKey);
  return (await asc.getLatestBuildNumber(bundleId)) + 1;
}

/**
 * How the marketing-version bump gets chosen for one run. `apply` carries the resolved {@link BumpKind}
 * and where it came from; `prompt` runs the interactive picker; `leave` keeps the app-config version as-is.
 */
export type BumpResolution =
  | { mode: 'apply'; kind: BumpKind; source: 'flag' | 'remembered' }
  | { mode: 'prompt' }
  | { mode: 'leave' };

/**
 * Decide how to pick the version bump, by precedence: an explicit `--bump` kind wins and applies even
 * non-interactively (so the version is scriptable in CI); otherwise, when we can prompt, `--bump ask`
 * forces the picker, a remembered pick auto-applies, and a first run prompts; when we can't prompt and
 * no flag was given, the app-config version is left untouched. Pure → testable with no store round-trip.
 */
export function resolveBumpKind(args: {
  flag: BumpKind | 'ask' | undefined;
  remembered: BumpKind | undefined;
  canPrompt: boolean;
}): BumpResolution {
  if (args.flag && args.flag !== 'ask') return { mode: 'apply', kind: args.flag, source: 'flag' };
  if (!args.canPrompt) return { mode: 'leave' };
  if (args.flag === 'ask') return { mode: 'prompt' };
  if (args.remembered) return { mode: 'apply', kind: args.remembered, source: 'remembered' };
  return { mode: 'prompt' };
}

/**
 * The interactive version picker: patch/minor/major above the baseline, keep the current, or type a
 * custom one. Returns the resolved version and its {@link BumpKind} — `undefined` for a typed "Custom…"
 * version, which has no kind and so is never remembered. Cancelling (Ctrl-C) exits cleanly.
 */
async function promptVersion(
  baseline: string,
  current: string,
  latest: string | null,
): Promise<{ chosen: string; kind: BumpKind | undefined }> {
  const patch = nextVersion(baseline, 'patch');
  const minor = nextVersion(baseline, 'minor');
  const major = nextVersion(baseline, 'major');
  const choice = await select<BumpKind | 'custom'>({
    message: latest
      ? `App Store Connect's latest is ${latest}. Which version ships next?`
      : 'No versions on App Store Connect yet. Which version ships?',
    initialValue: latest ? 'patch' : 'keep',
    options: [
      { value: 'patch', label: `Patch  → ${patch}`, hint: 'bug fixes' },
      { value: 'minor', label: `Minor  → ${minor}`, hint: 'new features' },
      { value: 'major', label: `Major  → ${major}`, hint: 'breaking changes' },
      { value: 'keep', label: `Keep   → ${current}`, hint: 'reuse the app config version' },
      { value: 'custom', label: 'Custom…', hint: 'type a version' },
    ],
  });
  if (isCancel(choice)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  if (choice === 'custom') {
    const typed = await text({
      message: 'Version (MAJOR.MINOR.PATCH):',
      initialValue: patch,
      validate: (value) => (value && parseVersion(value) ? undefined : 'Use a version like 1.2.3.'),
    });
    if (isCancel(typed)) {
      cancel('Cancelled.');
      process.exit(0);
    }
    const parsed = parseVersion(typed);
    return { chosen: parsed ? formatVersion(parsed) : typed.trim(), kind: undefined };
  }
  if (choice === 'keep') return { chosen: current, kind: 'keep' };
  return { chosen: nextVersion(baseline, choice), kind: choice };
}

/**
 * Stamp the resolved version into Info.plist + a static app.json, mirror it onto `app.version` so every
 * later step reports it, warn when it doesn't increment the store's latest, and log the step. `note`
 * explains the source (e.g. `patch, remembered`) so the line is self-documenting.
 */
async function applyChosenVersion(
  app: AppDescriptor,
  platform: Platform,
  chosen: string,
  latest: string | null,
  note: string,
  log: Logger,
): Promise<void> {
  if (latest && compareVersions(chosen, latest) <= 0) {
    log.warn(
      `${chosen} doesn't increment the store's ${latest} — fine for another TestFlight build, but the App Store rejects a release that reuses a version.`,
    );
  }
  const stamped = await setIosMarketingVersion(app.dir, platform, chosen);
  const persisted = writeAppVersion(app, chosen);
  app.version = chosen;
  const notes = [persisted ? 'app config updated' : 'app config not written (dynamic config)'];
  if (!stamped) notes.push('Info.plist not stamped');
  log.step('version', `${log.chip(chosen)} (${note}; ${notes.join('; ')})`, 'marketing-version');
}

/**
 * Resolve — and apply — the app's marketing version before the build. By precedence (see
 * {@link resolveBumpKind}): an explicit `--bump`, a remembered pick (auto-applied, no prompt), the
 * interactive picker, or — under `--yes`/CI with no flag — the app-config version untouched. The chosen
 * version is computed above the store's latest (App Store + TestFlight) and the app's own version, then
 * stamped into Info.plist + app config and mirrored onto `app.version` so every later step reports it.
 * Returns the {@link BumpKind} applied (for remembering on success), or `undefined` when nothing was
 * applied or a one-off Custom version was typed.
 */
async function resolveMarketingVersion(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  app: AppDescriptor,
  platform: Platform,
  options: BuildRunOptions,
  log: Logger,
): Promise<BumpKind | undefined> {
  const current = app.version ?? '0.0.0';

  if (options.dryRun) {
    log.step(
      'version',
      `would suggest the next version above the store's latest (config has ${current})`,
      'marketing-version',
    );
    return undefined;
  }

  const decision = resolveBumpKind({
    flag: options.bump,
    remembered: readLastBump(app.name),
    canPrompt: isInteractive() && options.yes !== true,
  });
  if (decision.mode === 'leave') {
    log.step(
      'version',
      `${current} (from app config; not prompting under --yes / non-interactive)`,
      'marketing-version',
    );
    return undefined;
  }

  const latest = bundleId
    ? await withSpinner('Checking versions already on App Store Connect', () =>
        new AppStoreConnectClient(ascKey).getLatestMarketingVersion(bundleId),
      )
    : null;
  // Never propose at or below what's already on the store or what the app config already declares.
  const baseline =
    highestVersion([latest, current].filter((v): v is string => v !== null)) ?? current;

  if (decision.mode === 'prompt') {
    const { chosen, kind } = await promptVersion(baseline, current, latest);
    await applyChosenVersion(app, platform, chosen, latest, kind ?? 'custom', log);
    return kind;
  }

  // apply (flag or remembered): compute the version from the kind.
  const chosen = decision.kind === 'keep' ? current : nextVersion(baseline, decision.kind);
  const source = decision.source === 'flag' ? '--bump' : 'remembered';
  await applyChosenVersion(app, platform, chosen, latest, `${decision.kind}, ${source}`, log);
  return decision.kind;
}

/**
 * Resolve the next Android `versionCode`: one above the highest of Google Play's latest and the
 * `app.json` floor, or a placeholder in dry-run. The Android twin of {@link nextBuildNumber} — the
 * store stays the source of truth, but an intentional local bump (the floor) is never clobbered.
 */
export async function nextVersionCode(
  serviceAccountJson: string,
  packageName: string,
  floor: number,
  dryRun: boolean,
): Promise<number> {
  if (dryRun || !packageName || !serviceAccountJson) return Math.max(floor, 0) + 1;
  const play = new GooglePlayClient(parseServiceAccount(serviceAccountJson));
  const latest = await play.getLatestVersionCode(packageName);
  return Math.max(latest, floor) + 1;
}

/**
 * Stamp the bumped `versionCode` into the generated `android/app/build.gradle`. A line-edit (no
 * PlistBuddy analog on Android); returns whether a `versionCode <n>` line was found and updated.
 */
function setAndroidVersionCode(appDir: string, versionCode: number): boolean {
  const gradlePath = join(appDir, 'android', 'app', 'build.gradle');
  if (!existsSync(gradlePath)) return false;
  const original = readFileSync(gradlePath, 'utf8');
  const updated = original.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  if (updated === original) return false;
  writeFileSync(gradlePath, updated);
  return true;
}

/**
 * Poll the uploaded build's processing state briefly under a spinner, so the run ends with a clear
 * status instead of dead air between polls. Safe to Ctrl-C — Apple keeps processing regardless.
 */
export async function reportProcessing(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  buildNumber: number,
  log: Logger,
): Promise<void> {
  const asc = new AppStoreConnectClient(ascKey);
  const state = await withSpinner(
    "Processing on Apple's side (safe to Ctrl-C; it keeps processing)",
    async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        await delay(10_000);
        try {
          const current = await asc.getBuildProcessingState(bundleId, buildNumber);
          if (current && current !== 'PROCESSING') return current;
        } catch {
          /* transient; keep polling */
        }
      }
      return null;
    },
  );
  if (state) {
    log.step('processing', state === 'VALID' ? 'ready to test on TestFlight' : `state: ${state}`);
  } else {
    log.info("Still processing — it'll appear in TestFlight shortly.");
  }
}

/** Worst-case store download across device variants, or the on-disk size when no per-device report exists. */
export function worstDownloadBytes(report: SizeReport): number {
  if (report.entries.length === 0) return report.artifactBytes;
  return report.entries.reduce((max, entry) => Math.max(max, entry.downloadBytes), 0);
}

/**
 * The canonical size string wherever a size headline appears (the upload confirm and the receipt):
 * both numbers, no hierarchy. Falls back to on-disk alone when the build produced no per-device
 * estimate, so the line never claims a download figure it doesn't have. `wrap` decorates each size
 * value — the receipt passes {@link Logger.chip} to pill the numbers — and defaults to identity so
 * existing plain callers are unchanged.
 */
export function sizeSummary(
  report: SizeReport,
  wrap: (size: string) => string = (size) => size,
): string {
  if (report.entries.length === 0)
    return `on disk ${wrap(mb(report.artifactBytes))} (no per-device estimate)`;
  return `download ${wrap(mb(worstDownloadBytes(report)))} · on disk ${wrap(mb(report.artifactBytes))}`;
}

/** A build whose worst-case download grows beyond this fraction over the previous one earns a warning. */
const GROWTH_WARN_RATIO = 0.1;

/**
 * The size lines for the pre-upload checkpoint, with an optional delta against the previous build.
 * Returns the display lines (download + on-disk, or on-disk alone when there's no per-device estimate)
 * plus, when the worst-case download grew past {@link GROWTH_WARN_RATIO}, the growth to warn about — so
 * the caller renders the line and the warning consistently. Pure (no I/O) for direct unit testing.
 */
export function uploadSizeReadout(
  report: SizeReport,
  previous?: { downloadBytes: number; buildNumber: number },
): { lines: string[]; grew: { pct: number; buildNumber: number } | null } {
  if (report.entries.length === 0) {
    return { lines: [`on disk ${mb(report.artifactBytes)} (no per-device estimate)`], grew: null };
  }
  const worst = worstDownloadBytes(report);
  let downloadLine = `download ${mb(worst)}`;
  let grew: { pct: number; buildNumber: number } | null = null;
  if (previous && previous.downloadBytes > 0) {
    const delta = worst - previous.downloadBytes;
    const ratio = delta / previous.downloadBytes;
    downloadLine += ` (${delta >= 0 ? '+' : '-'}${mb(Math.abs(delta))} since build ${previous.buildNumber})`;
    if (ratio > GROWTH_WARN_RATIO)
      grew = { pct: Math.round(ratio * 100), buildNumber: previous.buildNumber };
  }
  return { lines: [downloadLine, `on disk ${mb(report.artifactBytes)}`], grew };
}

/**
 * The most recent prior stored build for this app+platform — the baseline for the upload-time size
 * delta. Reads the newest-first artifact index and skips the build we just stored (matched by build
 * number) so the delta compares against the previous upload, not itself. Undefined on the first build.
 */
export async function previousBuild(
  config: LaunchConfig,
  app: AppDescriptor,
  platform: Platform,
  currentBuildNumber: number,
): Promise<{ downloadBytes: number; buildNumber: number } | undefined> {
  const history = await resolveStorageProvider(config).list();
  const prior = history.find(
    (artifact) =>
      artifact.appName === app.name &&
      artifact.platform === platform &&
      artifact.buildNumber !== currentBuildNumber,
  );
  return prior
    ? { downloadBytes: worstDownloadBytes(prior.sizeReport), buildNumber: prior.buildNumber }
    : undefined;
}

/**
 * Print the per-device size readout for a freshly built artifact (iOS thinning / Android bundletool),
 * or a single on-disk line when there's no per-device report. Display only — the budget decision lives
 * in {@link confirmUpload}, so this runs on every build, including `--no-submit`. `sizeTopic` selects
 * the matching `--explain` block.
 */
export function reportSize(
  report: SizeReport,
  log: Logger,
  sizeTopic: GlossaryTopic = 'app-thinning',
): void {
  if (report.entries.length === 0) {
    log.step(
      'size',
      `${log.chip(mb(report.artifactBytes))} on disk (no per-device report)`,
      sizeTopic,
    );
    return;
  }
  for (const entry of report.entries) {
    const installSuffix = entry.installBytes > 0 ? ` · install ${mb(entry.installBytes)}` : '';
    log.step(
      'size',
      `${entry.device}: download ${log.chip(mb(entry.downloadBytes))}${installSuffix}`,
      sizeTopic,
    );
  }
}

/** Inputs for the pre-upload checkpoint {@link confirmUpload}. */
export interface ConfirmUploadOptions {
  report: SizeReport;
  /** Soft size budget in MB; an over-budget worst-case download leads the prompt with a warning. */
  budgetMB: number;
  /** Human destination, e.g. `"TestFlight"`, `"App Store review"`, or `"Google Play (internal track)"`. */
  destination: string;
  app: AppDescriptor;
  /** App version string, e.g. `1.0.0`. */
  version: string;
  /** Build number (iOS) or versionCode (Android) about to be uploaded. */
  buildNumber: number;
  /**
   * The previous stored build for this app+platform, for the upload-time size delta. Omitted on the
   * first build (nothing to compare against), in which case no delta line or growth warning is shown.
   */
  previous?: { downloadBytes: number; buildNumber: number } | undefined;
  /** `--yes`: skip the prompt and proceed (also implied in CI / non-TTY). */
  yes: boolean;
  log: Logger;
}

/**
 * The single pre-upload checkpoint, at the real upload boundary. It always surfaces what's about to
 * ship — app, build number, and the both-numbers size — and, when the worst-case download exceeds the
 * budget, leads with a warning (this is where the old size gate now lives). In an interactive terminal
 * it asks to continue; in CI / a pipe / under `--yes` it never blocks on stdin — it proceeds, but
 * still logs the over-budget warning so the record shows it.
 */
export async function confirmUpload(options: ConfirmUploadOptions): Promise<void> {
  const { report, budgetMB, destination, app, version, buildNumber, previous, yes, log } = options;
  const overBudget = worstDownloadBytes(report) > budgetMB * 1024 * 1024;
  const { lines, grew } = uploadSizeReadout(report, previous);

  log.notice(
    `⬆ Upload to ${destination}`,
    `${app.name} ${version} (build ${buildNumber})`,
    ...lines,
  );
  if (grew) {
    log.warn(`Grew ${grew.pct}% since build ${grew.buildNumber}.`);
  }
  if (overBudget) {
    log.warn(
      `Worst-case download ${mb(worstDownloadBytes(report))} is over the ${budgetMB} MB budget.`,
    );
  }

  if (yes || !isInteractive()) {
    if (overBudget) log.info('Proceeding anyway (non-interactive or --yes).');
    return;
  }
  const proceed = await confirm({ message: 'Continue?' });
  if (isCancel(proceed) || !proceed) {
    cancel(overBudget ? 'Stopped before upload (over size budget).' : 'Stopped before upload.');
    process.exit(0);
  }
}

/** The receipt's destination line: where the build actually went (or that it wasn't uploaded). */
export function receiptDestination(
  platform: Platform,
  options: BuildRunOptions,
  track?: PlayTrack,
): string {
  if (!options.submit) return 'built · not uploaded';
  if (platform === 'android') return `Play · ${track ?? 'internal'} track`;
  return options.target === 'testing' ? 'TestFlight' : 'App Store · in review';
}

/**
 * Best-effort deep link to the uploaded build in App Store Connect: a real per-app TestFlight/overview
 * URL when the app id resolves, else the console home. Never throws — a link is a nicety, not a gate.
 */
export async function resolveAscBuildLink(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  target: SubmitTarget,
): Promise<string> {
  const appId =
    (await new AppStoreConnectClient(ascKey).getAppId(bundleId).catch(() => null)) ?? undefined;
  return buildConsoleUrl(target === 'testing' ? 'testflight' : 'asc', 'ios', appId);
}

/** Inputs for the end-of-run {@link renderReceipt} summary. */
interface ReceiptOptions {
  app: AppDescriptor;
  version: string;
  buildNumber: number;
  report: SizeReport;
  /** Where it landed, from {@link receiptDestination}. */
  destination: string;
  /** Best-effort console deep link; omitted in dry-run / `--no-submit` / when unresolved. */
  link?: string | undefined;
  log: Logger;
}

/**
 * The end-of-run "Shipped" receipt: one scannable summary of what landed where — app/version/build,
 * the both-numbers size, the destination, and a console link, with the headline values (app, version,
 * size) pilled via {@link Logger.chip}. A sailing pixel boat crowns the box on a TTY; plain lines in CI
 * (see {@link Logger.shipped}). Async because the boat animates.
 */
export async function renderReceipt(options: ReceiptOptions): Promise<void> {
  const { app, version, buildNumber, report, destination, link, log } = options;
  const rows = [
    `${log.chip(app.name)} ${log.chip(version)} (${buildNumber})`,
    sizeSummary(report, (size) => log.chip(size)),
    destination,
  ];
  if (link) rows.push(link);
  await log.shipped(rows);
}
