/**
 * {@link inspectDoctor} — the pure, read-only heart of `launch doctor`.
 *
 * Every check that used to `console.log` inside `cli/commands/doctor.ts` lives here as a function that
 * returns {@link DoctorCheck}s instead of printing. The CLI renders the resulting {@link DoctorReport}
 * with ✓/✗/• glyphs, `--json` serializes it, and `launch mcp` hands the same object to an agent — one
 * inspection, three consumers. All impure inputs (PATH probes, store clients, the keychain query, the
 * credentials store) arrive through {@link DoctorContext}, so this module performs no network or keychain
 * I/O of its own and a test drives it with fakes. The only direct reads are project-directory files
 * (`package.json`, `android/gradlew`) derived from `cwd`/`app.dir`, which the repo already tests against
 * fixture dirs.
 *
 * The `--fix` side of the old command (interactive toolchain install + the export-compliance network
 * reconcile) is deliberately NOT here — it mutates state, so it stays in the CLI layered around this
 * read. A section that throws is caught by the caller and surfaced as a single `fail` check, so one
 * broken probe never sinks the whole report.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkApp, formatFinding } from '../configCheck.js';
import { errorMessage } from '../errorMessage.js';
import { describeExportComplianceConfig } from '../exportCompliance.js';
import { formatPermissionLine, probeKeyPermissions } from '../ascPermissions.js';
import { inspectPackageSetup, packageManagerWarnings } from '../packageManager.js';
import { appPrivacyChecklist } from '../privacyNutritionLabel.js';
import { ANDROID_TOOLS, REQUIRED_TOOLS, fixHint } from '../toolchain.js';
import { buildConsoleUrl } from '../consoleLinks.js';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  resolveExtensionBundleIdsForApp,
  signingPreflightDoctorChecks,
} from '../signingPreflight.js';
import type { DoctorCheck, DoctorContext, DoctorPlatform, DoctorReport } from './types.js';

/** Where to create a missing App Store Connect app record — the one step the API can't do. */
const APP_STORE_CONNECT_APPS_URL = buildConsoleUrl('app-record', 'ios', undefined);
/** Where to create a Play app and enroll in Play App Signing on first release. */
const PLAY_CONSOLE_URL = buildConsoleUrl('play', 'android', undefined);

/**
 * Report the detected package manager + monorepo root and the known Corepack/lockfile footguns. The
 * manager/workspace lines are `ok`; the warnings are advisory `info` (the build still runs) — surfacing
 * them up front avoids the EAS-class wrong-PM wasted build.
 */
async function packageManagerChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const setup = inspectPackageSetup(ctx.cwd);
  const version = setup.pm.version ? `@${setup.pm.version}` : '';
  const checks: DoctorCheck[] = [
    { status: 'ok', title: `Package manager: ${setup.pm.name}${version} (via ${setup.pm.source})` },
  ];
  if (setup.workspace) {
    checks.push({
      status: 'ok',
      title: `Monorepo workspace root: ${setup.workspace.root} (${setup.workspace.kind})`,
    });
  }
  const corepackAvailable = await ctx.corepackAvailable();
  for (const warning of packageManagerWarnings({
    info: setup.pm,
    lockfile: setup.lockfile,
    corepackAvailable,
  })) {
    checks.push({ status: 'info', title: warning });
  }
  return checks;
}

/**
 * The iOS toolchain, one check per tool. A missing *required* tool is a `fail`; a *recommended* one
 * (ccache) is `info` — the build still runs, just uncached.
 */
async function iosToolchainChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const tool of REQUIRED_TOOLS) {
    const present = await ctx.exists(tool.command);
    if (tool.tier === 'recommended') {
      checks.push(
        present
          ? { status: 'ok', title: tool.label }
          : { status: 'info', title: `${tool.label} (recommended)`, hint: fixHint(tool) },
      );
      continue;
    }
    checks.push(
      present
        ? { status: 'ok', title: tool.label }
        : { status: 'fail', title: tool.label, hint: fixHint(tool) },
    );
  }
  return checks;
}

/**
 * The Android toolchain (all required) plus the two non-PATH prerequisites: the SDK (`ANDROID_HOME`)
 * and a per-app gradle wrapper. A missing tool or SDK is a `fail`; a missing wrapper is `info`
 * (`launch build android` generates it via `expo prebuild`).
 */
async function androidToolchainChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const tool of ANDROID_TOOLS) {
    const present = await ctx.exists(tool.command);
    checks.push(
      present
        ? { status: 'ok', title: tool.label }
        : { status: 'fail', title: tool.label, hint: fixHint(tool) },
    );
  }

  checks.push(
    ctx.androidSdk
      ? { status: 'ok', title: `Android SDK (${ctx.androidSdk})` }
      : {
          status: 'fail',
          title: 'Android SDK',
          hint: 'set ANDROID_HOME (install via Android Studio or the command-line tools)',
        },
  );

  for (const app of ctx.apps) {
    if (!app.packageName) continue;
    const hasWrapper = existsSync(join(app.dir, 'android', 'gradlew'));
    checks.push(
      hasWrapper
        ? { status: 'ok', title: `Gradle wrapper for ${app.name}` }
        : {
            status: 'info',
            title: `No android/gradlew for ${app.name} yet`,
            detail: '`launch build android` will run `expo prebuild` to generate it',
          },
    );
  }
  return checks;
}

/** The `launch creds status` readout as one advisory check (its body can span both platforms). */
async function credentialsCheck(ctx: DoctorContext): Promise<DoctorCheck[]> {
  return [{ status: 'info', title: 'Credentials', detail: await ctx.credentialsStatus() }];
}

/**
 * Confirm the distribution identity is visible to `codesign` the way a build looks it up (the guard
 * against the Tahoe temporary-keychain "0 valid identities" failure). Informational when no cert is set
 * up yet — that's not-provisioned, not a fault. macOS only.
 */
async function codesignCheck(ctx: DoctorContext): Promise<DoctorCheck[]> {
  if (ctx.os !== 'macos') return [];
  const output = await ctx.codesignIdentities();
  if (output === null) {
    return [
      { status: 'info', title: 'Could not query codesign identities (security CLI unavailable)' },
    ];
  }
  if (/Apple Distribution|iPhone Distribution/.test(output)) {
    return [
      {
        status: 'ok',
        title: 'Distribution identity visible to codesign (login keychain — Tahoe-safe)',
      },
    ];
  }
  return [
    {
      status: 'info',
      title: 'No distribution identity in the login keychain yet',
      hint: '`launch creds setup` imports one',
    },
  ];
}

/**
 * Probe Apple for an unsigned/expired agreement and for missing app records (the one step the API can't
 * create). A failed agreement check or a missing record is a `fail`; no account configured is an
 * advisory skip.
 */
async function appleAccountChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const asc = await ctx.resolveAsc();
  if (!asc) {
    return [
      {
        status: 'info',
        title: 'No active Apple account — skipping Apple checks',
        hint: '`launch creds set-key`',
      },
    ];
  }

  const checks: DoctorCheck[] = [];
  try {
    await asc.assertReady();
    checks.push({
      status: 'ok',
      title: 'Apple agreements accepted',
      detail:
        'via App Store Connect API key — no password, no 2FA (immune to the Apple-ID 2FA failures EAS hits)',
    });
  } catch (error) {
    checks.push({
      status: 'fail',
      title: 'Apple account check failed',
      detail: errorMessage(error),
    });
    return checks;
  }

  for (const app of ctx.apps) {
    if (!app.bundleId) continue;
    const appId = await asc.getAppId(app.bundleId);
    checks.push(
      appId
        ? { status: 'ok', title: `App record for ${app.bundleId}` }
        : {
            status: 'fail',
            title: `No App Store Connect record for ${app.bundleId}`,
            hint: `create it (one-time) at ${APP_STORE_CONNECT_APPS_URL}`,
          },
    );
  }
  return checks;
}

/**
 * Confirm the service account can reach each app (a `fail` when it can't, deep-linking the irreducible
 * Play Console step), then surface the two Play gates Launch can't automate as advisory notes.
 */
async function playAccountChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const play = await ctx.resolvePlay();
  if (!play) {
    return [
      {
        status: 'info',
        title: 'No service account imported — skipping Play checks',
        hint: '`launch creds set-key --platform android`',
      },
    ];
  }

  const checks: DoctorCheck[] = [];
  for (const app of ctx.apps) {
    if (!app.packageName) continue;
    try {
      await play.assertAppExists(app.packageName);
      checks.push({ status: 'ok', title: `Play app reachable for ${app.packageName}` });
    } catch (error) {
      checks.push({
        status: 'fail',
        title: errorMessage(error),
        hint: `Create the app + enroll in Play App Signing on first release at ${PLAY_CONSOLE_URL}`,
      });
    }
  }

  checks.push({
    status: 'info',
    title:
      'A new personal Play account needs ~20 testers for 14 days on a testing track before production unlocks.',
  });
  checks.push({
    status: 'info',
    title:
      'Sensitive/high-risk permissions can make the Publishing API reject a release until declared in Play Console.',
  });
  return checks;
}

/**
 * Validate each app's Expo config against the known native-config footguns (the same "fail before a
 * wasted build" check `launch build` runs). An `error` finding is a `fail`; a `warn` is `info`.
 */
async function configChecks(ctx: DoctorContext, platform: DoctorPlatform): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const app of ctx.apps) {
    const findings = await checkApp(app, platform);
    if (findings.length === 0) {
      checks.push({ status: 'ok', title: `${app.name}: app config clean` });
      continue;
    }
    for (const finding of findings) {
      checks.push({
        status: finding.severity === 'error' ? 'fail' : 'info',
        title: `${app.name}: ${formatFinding(finding)}`,
      });
    }
  }
  return checks;
}

/**
 * Report each iOS app's export-compliance posture from its Expo config alone (network-free, read-only).
 * Always advisory — the only "clean" case (`usesNonExemptEncryption: false`) is `ok`, the rest `info`.
 * The `--fix` network reconcile stays in the CLI.
 */
function exportComplianceChecks(ctx: DoctorContext): DoctorCheck[] {
  const iosApps = ctx.apps.filter((app) => app.bundleId);
  return iosApps.map((app) => {
    const status = describeExportComplianceConfig(app.usesNonExemptEncryption);
    return { status: status.ok ? 'ok' : 'info', title: `${app.name}: ${status.message}` };
  });
}

/**
 * Grade each iOS app's signing targets BEFORE a build: App Group portal notice (advisory) plus App ID
 * registration and capability coverage for the main bundle and any extensions (fail when not ready).
 * Best-effort when the ASC read throws — one advisory skip, not a sunk run.
 */
async function signingPreflightChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const asc = await ctx.resolveAsc();
  if (!asc) return [];

  const checks: DoctorCheck[] = [];
  for (const app of ctx.apps) {
    if (!app.bundleId) continue;
    const appGroupNotice = appGroupPreflightNotice(app.iosEntitlements);
    const extensions = resolveExtensionBundleIdsForApp(app);
    try {
      const readiness = await gatherTargetSigningReadiness(
        asc,
        app.bundleId,
        extensions,
        app.iosEntitlements,
      );
      checks.push(...signingPreflightDoctorChecks(readiness, appGroupNotice));
    } catch (error) {
      checks.push({
        status: 'info',
        title: `${app.name}: signing preflight skipped`,
        detail: errorMessage(error),
      });
    }
  }
  return checks;
}

/** Remind that the App Privacy "nutrition label" is a one-time manual step (no API). iOS apps only. */
function appPrivacyChecks(ctx: DoctorContext): DoctorCheck[] {
  if (!ctx.apps.some((app) => app.bundleId)) return [];
  const [headline, ...rest] = appPrivacyChecklist();
  return [{ status: 'info', title: headline ?? 'App Privacy', detail: rest.join('\n') }];
}

/**
 * Probe the active API key against each role-gated feature and report the access matrix, so a developer
 * learns up front their key can't (say) reply to reviews instead of hitting a 403 mid-flight. Advisory.
 */
async function keyPermissionChecks(ctx: DoctorContext): Promise<DoctorCheck[]> {
  const asc = await ctx.resolveAsc();
  if (!asc) return [];
  const bundleId = ctx.apps.find((app) => app.bundleId)?.bundleId;
  let appId: string | null = null;
  if (bundleId) {
    try {
      appId = await asc.getAppId(bundleId);
    } catch {
      appId = null;
    }
  }
  const results = await probeKeyPermissions(asc, appId);
  return [
    {
      status: 'info',
      title: 'API-key role access (per feature):',
      detail: results.map((result) => `  ${formatPermissionLine(result)}`).join('\n'),
    },
  ];
}

/**
 * Run the read-only doctor preflight for a platform and return the structured {@link DoctorReport}.
 *
 * The body of `launch doctor`, the wizard's guided setup, and the `doctor` MCP tool all call this. Each
 * section is run behind a guard: a section that throws becomes a single `fail` check (with the error
 * message) rather than aborting the run, so a flaky probe degrades one line instead of the whole report.
 * `ok` is the verdict — `true` exactly when no check is `fail` (advisory `info` never fails the run).
 */
export async function inspectDoctor(ctx: DoctorContext): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const collect = async (
    label: string,
    run: () => Promise<DoctorCheck[]> | DoctorCheck[],
  ): Promise<void> => {
    try {
      checks.push(...(await run()));
    } catch (error) {
      checks.push({ status: 'fail', title: `${label} check failed`, detail: errorMessage(error) });
    }
  };

  await collect('Package manager', () => packageManagerChecks(ctx));
  if (ctx.platform === 'android') {
    await collect('Android toolchain', () => androidToolchainChecks(ctx));
    await collect('Credentials', () => credentialsCheck(ctx));
    await collect('Play account', () => playAccountChecks(ctx));
    await collect('App config', () => configChecks(ctx, 'android'));
  } else {
    await collect('iOS toolchain', () => iosToolchainChecks(ctx));
    await collect('Credentials', () => credentialsCheck(ctx));
    await collect('Codesign identity', () => codesignCheck(ctx));
    await collect('Apple account', () => appleAccountChecks(ctx));
    await collect('Signing preflight', () => signingPreflightChecks(ctx));
    await collect('App config', () => configChecks(ctx, 'ios'));
    await collect('Export compliance', () => exportComplianceChecks(ctx));
    await collect('App privacy', () => appPrivacyChecks(ctx));
    await collect('API-key permissions', () => keyPermissionChecks(ctx));
  }

  return { platform: ctx.platform, checks, ok: checks.every((check) => check.status !== 'fail') };
}
