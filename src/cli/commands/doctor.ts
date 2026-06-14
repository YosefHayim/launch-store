/**
 * `launch doctor` — preflight check (and, with `--fix`, an installer).
 *
 * Platform-aware. For iOS it verifies the build toolchain (Xcode, Ruby, fastlane, CocoaPods, openssl)
 * and, when an API key is present, the things that otherwise fail deep inside a build: an
 * unsigned/expired Apple agreement, and apps with no App Store Connect record (the one step the API
 * can't create). For Android (`--platform android`) it runs the same philosophy in three tiers: HARD
 * toolchain checks (JDK/keytool, Android SDK, the gradle wrapper, fastlane, bundletool), a PREFLIGHT
 * that the service account can reach each app (deep-linking "Create app" + Play App Signing when not),
 * and WARNINGS for the irreducible Play gates (the new-account testing requirement, sensitive perms).
 *
 * `--fix` (iOS only) hands the toolchain check to {@link ensureToolchain}, which asks one consent and
 * installs the missing tools via Homebrew (`--yes` skips the prompt for CI/agents).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { capture, exists } from "../../core/exec.js";
import { hostOs } from "../../core/os.js";
import { loadConfig } from "../../core/config.js";
import { ANDROID_TOOLS, REQUIRED_TOOLS, ensureToolchain, fixHint } from "../../core/toolchain.js";
import { inspectPackageSetup, packageManagerWarnings } from "../../core/packageManager.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { GooglePlayClient, parseServiceAccount } from "../../google/playClient.js";
import { loadServiceAccount } from "../../google/credentials.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { checkApp, formatFinding } from "../../core/configCheck.js";
import {
  describeExportComplianceConfig,
  reconcileExportCompliance,
  summarizeExportComplianceResult,
} from "../../core/exportCompliance.js";
import { localCredentialsProvider } from "../../providers/credentials/local.js";

const APP_STORE_CONNECT_APPS_URL = "https://appstoreconnect.apple.com/apps";
const PLAY_CONSOLE_URL = "https://play.google.com/console";

/** Probe Apple for an unsigned/expired agreement and for missing app records; best-effort. */
async function checkAppleAccount(): Promise<boolean> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) {
    console.log("• No active Apple account — skipping Apple checks (`launch creds set-key`).");
    return true;
  }
  const client = new AppStoreConnectClient(ascKey);
  try {
    await client.assertReady();
    console.log("✓ Apple agreements accepted");
    // The dodge worth surfacing: API-key (JWT) auth means none of the Apple-ID 2FA breakage EAS keeps
    // hitting (codes rejected, voice/SMS delivery failures) can ever block a Launch build.
    console.log("  via App Store Connect API key — no password, no 2FA (immune to the Apple-ID 2FA failures EAS hits)");
  } catch (error) {
    console.log(`✗ Apple account check failed — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  const { apps } = await loadConfig();
  let allOk = true;
  for (const app of apps) {
    if (!app.bundleId) continue;
    const appId = await client.getAppId(app.bundleId);
    if (appId) {
      console.log(`✓ App record for ${app.bundleId}`);
    } else {
      allOk = false;
      console.log(
        `✗ No App Store Connect record for ${app.bundleId} — create it (one-time) at ${APP_STORE_CONNECT_APPS_URL}`,
      );
    }
  }
  return allOk;
}

/**
 * Report the iOS toolchain read-only: one line per tool. A missing *required* tool prints ✗ and fails
 * the check; a missing *recommended* tool (ccache) prints • and does NOT — the build still runs, just
 * uncached. Returns whether every required tool is present.
 */
async function reportToolchain(): Promise<boolean> {
  let allOk = true;
  for (const tool of REQUIRED_TOOLS) {
    const ok = await exists(tool.command);
    if (tool.tier === "recommended") {
      console.log(ok ? `✓ ${tool.label}` : `• ${tool.label} (recommended) — ${fixHint(tool)}`);
      continue;
    }
    allOk &&= ok;
    console.log(`${ok ? "✓" : "✗"} ${tool.label}${ok ? "" : `  — ${fixHint(tool)}`}`);
  }
  return allOk;
}

/**
 * Tier 1 (HARD): report the Android toolchain plus the two non-PATH prerequisites — the Android SDK
 * (`ANDROID_HOME`/`ANDROID_SDK_ROOT`) and a per-app gradle wrapper. Returns whether everything needed
 * to build is present.
 */
async function reportAndroidToolchain(): Promise<boolean> {
  let allOk = true;
  for (const tool of ANDROID_TOOLS) {
    const ok = await exists(tool.command);
    allOk &&= ok;
    console.log(`${ok ? "✓" : "✗"} ${tool.label}${ok ? "" : `  — ${fixHint(tool)}`}`);
  }

  const sdk = process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"];
  if (sdk) {
    console.log(`✓ Android SDK (${sdk})`);
  } else {
    allOk = false;
    console.log("✗ Android SDK — set ANDROID_HOME (install via Android Studio or the command-line tools)");
  }

  const { apps } = await loadConfig();
  for (const app of apps) {
    if (!app.packageName) continue;
    const hasWrapper = existsSync(join(app.dir, "android", "gradlew"));
    console.log(
      hasWrapper
        ? `✓ Gradle wrapper for ${app.name}`
        : `• No android/gradlew for ${app.name} yet — \`launch build android\` will run \`expo prebuild\` to generate it`,
    );
  }
  return allOk;
}

/**
 * Tiers 2 (PREFLIGHT) + 3 (WARN): confirm the service account can reach each app (deep-linking the
 * irreducible Play Console steps when it can't), then surface the Play gates Launch can't automate.
 * Returns whether the reachable-app preflight passed.
 */
async function checkPlayAccount(): Promise<boolean> {
  const json = await loadServiceAccount();
  if (!json) {
    console.log("• No service account imported — skipping Play checks (`launch creds set-key --platform android`).");
    return true;
  }

  const client = new GooglePlayClient(parseServiceAccount(json));
  const { apps } = await loadConfig();
  let allOk = true;
  for (const app of apps) {
    if (!app.packageName) continue;
    try {
      await client.assertAppExists(app.packageName);
      console.log(`✓ Play app reachable for ${app.packageName}`);
    } catch (error) {
      allOk = false;
      console.log(`✗ ${error instanceof Error ? error.message : String(error)}`);
      console.log(`  Create the app + enroll in Play App Signing on first release at ${PLAY_CONSOLE_URL}`);
    }
  }

  console.log(
    "• Note: a new personal Play account needs ~20 testers for 14 days on a testing track before production unlocks.",
  );
  console.log(
    "• Note: sensitive/high-risk permissions can make the Publishing API reject a release until declared in Play Console.",
  );
  return allOk;
}

/**
 * Verify the distribution identity is actually visible to `codesign`, the way a build will look it up.
 *
 * This is the guard against the EAS-class failure where, on macOS Tahoe, a distribution cert imported
 * into a *temporary* keychain reports "0 valid identities" and the build dies cryptically. Launch
 * imports into the LOGIN keychain instead, so `security find-identity -p codesigning` sees it — this
 * check confirms that's true on this machine before a build relies on it. Informational (•, never ✗)
 * when no cert is set up yet: that's a not-provisioned state, not a fault. macOS only.
 */
async function reportCodesignIdentity(): Promise<void> {
  if (hostOs() !== "macos") return;
  try {
    const output = await capture("security", ["find-identity", "-v", "-p", "codesigning"]);
    if (/Apple Distribution|iPhone Distribution/.test(output)) {
      console.log("✓ Distribution identity visible to codesign (login keychain — Tahoe-safe)");
    } else {
      console.log("• No distribution identity in the login keychain yet — `launch creds setup` imports one");
    }
  } catch {
    console.log("• Could not query codesign identities (security CLI unavailable)");
  }
}

/**
 * Validate each discovered app's Expo config against the known native-config footguns, the same
 * "fail before a wasted build" check `launch build` runs at its head. An `error` finding (invalid
 * bundle id / package, a splash with no backgroundColor) fails the doctor; a `warn` (missing icon or
 * scheme) is surfaced but doesn't. Returns whether every app passed without an error.
 */
async function reportConfigChecks(platform: "ios" | "android"): Promise<boolean> {
  const { apps } = await loadConfig();
  let allOk = true;
  for (const app of apps) {
    const findings = await checkApp(app, platform);
    if (findings.length === 0) {
      console.log(`✓ ${app.name}: app config clean`);
      continue;
    }
    for (const finding of findings) {
      if (finding.severity === "error") allOk = false;
      console.log(`${finding.severity === "error" ? "✗" : "•"} ${app.name}: ${formatFinding(finding)}`);
    }
  }
  return allOk;
}

/**
 * Report each iOS app's export-compliance posture from its Expo config (`ios.config.usesNonExemptEncryption`),
 * so a developer answers the encryption question once instead of being re-prompted on every upload. With
 * `--fix` and an active Apple account, also reconcile the latest uploaded build via the App Store Connect
 * API — answering it directly, or reusing an approved App Encryption Declaration. Always advisory (✓/•),
 * never fails the doctor and best-effort on the network side.
 */
async function reportExportCompliance(fix: boolean): Promise<void> {
  const { apps } = await loadConfig();
  const iosApps = apps.filter((app) => app.bundleId);
  if (iosApps.length === 0) return;

  const ascKey = fix ? await loadActiveAscKey() : null;
  const client = ascKey ? new AppStoreConnectClient(ascKey) : null;
  for (const app of iosApps) {
    const status = describeExportComplianceConfig(app.usesNonExemptEncryption);
    console.log(`${status.ok ? "✓" : "•"} ${app.name}: ${status.message}`);
    if (!client || !app.bundleId || app.usesNonExemptEncryption === undefined) continue;
    try {
      const buildNumber = await client.getLatestBuildNumber(app.bundleId);
      if (buildNumber === 0) continue;
      const result = await reconcileExportCompliance(client, {
        bundleId: app.bundleId,
        buildNumber,
        usesNonExemptEncryption: app.usesNonExemptEncryption,
      });
      console.log(`  ↳ build ${buildNumber}: ${summarizeExportComplianceResult(result)}`);
    } catch (error) {
      console.log(
        `  ↳ could not reconcile export compliance — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Report the detected package manager + monorepo workspace root, and warn on the known Corepack/
 * lockfile footguns (see `core/packageManager.ts`). Informational — these warn (•), never fail the
 * check, since the build still runs; surfacing them up front avoids the EAS-class wrong-PM wasted build.
 */
async function reportPackageManager(): Promise<void> {
  const setup = inspectPackageSetup(process.cwd());
  const version = setup.pm.version ? `@${setup.pm.version}` : "";
  console.log(`✓ Package manager: ${setup.pm.name}${version} (via ${setup.pm.source})`);
  if (setup.workspace) {
    console.log(`✓ Monorepo workspace root: ${setup.workspace.root} (${setup.workspace.kind})`);
  }
  const corepackAvailable = await exists("corepack");
  for (const warning of packageManagerWarnings({ info: setup.pm, lockfile: setup.lockfile, corepackAvailable })) {
    console.log(`• ${warning}`);
  }
}

/**
 * Run the doctor preflight for a platform and return whether everything required passed. The body of
 * `launch doctor`, extracted so the no-args wizard's guided setup can run the same checks inline (and
 * so callers can branch on the result instead of only reading a process exit code).
 */
export async function runDoctor(options: {
  platform: "ios" | "android";
  fix?: boolean;
  yes?: boolean;
}): Promise<boolean> {
  await reportPackageManager();
  if (options.platform === "android") {
    const toolsOk = await reportAndroidToolchain();
    console.log(`• ${await localCredentialsProvider.status()}`);
    const playOk = await checkPlayAccount();
    const configOk = await reportConfigChecks("android");
    return toolsOk && playOk && configOk;
  }
  const toolsOk = options.fix ? await ensureToolchain({ assumeYes: options.yes === true }) : await reportToolchain();
  console.log(`• ${await localCredentialsProvider.status()}`);
  await reportCodesignIdentity();
  const appleOk = await checkAppleAccount();
  const configOk = await reportConfigChecks("ios");
  await reportExportCompliance(options.fix === true);
  return toolsOk && appleOk && configOk;
}

/** Attach the `doctor` command to the program. */
export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("check that the local toolchain and store account are ready")
    .option("--platform <p>", "ios (default) or android")
    .option("--fix", "install any missing build tools (iOS only; asks for consent first)")
    .option("--yes", "skip prompts and proceed with installs (CI/agents)")
    .action(async (options: { platform?: string; fix?: boolean; yes?: boolean }) => {
      const platform = options.platform ?? "ios";
      if (platform !== "ios" && platform !== "android") {
        throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
      }
      const ok = await runDoctor({ platform, fix: options.fix === true, yes: options.yes === true });
      if (!ok) process.exitCode = 1;
    });
}
