/**
 * `relay doctor` — preflight check.
 *
 * Verifies the toolchain a local iOS build needs (Xcode, Ruby, fastlane, CocoaPods, openssl) and,
 * when an API key is present, the things that otherwise fail deep inside a build: an unsigned/expired
 * Apple agreement, and apps with no App Store Connect record (the one step the API can't create).
 */

import type { Command } from "commander";
import { exists } from "../../core/exec.js";
import { loadConfig } from "../../core/config.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { loadAscKey, localCredentialsProvider } from "../../providers/credentials/local.js";

/** A single tool to probe and the hint shown when it's missing. */
interface ToolCheck {
  label: string;
  command: string;
  fix: string;
}

const APP_STORE_CONNECT_APPS_URL = "https://appstoreconnect.apple.com/apps";

const TOOL_CHECKS: ToolCheck[] = [
  {
    label: "Xcode (xcodebuild)",
    command: "xcodebuild",
    fix: "Install Xcode from the App Store, then `xcode-select --install`.",
  },
  { label: "Ruby", command: "ruby", fix: "Install Ruby (it ships with macOS, or use Homebrew/rbenv)." },
  { label: "fastlane", command: "fastlane", fix: "Install with `brew install fastlane` or `gem install fastlane`." },
  { label: "CocoaPods (pod)", command: "pod", fix: "Install with `brew install cocoapods`." },
  { label: "openssl", command: "openssl", fix: "Install with `brew install openssl` (ships with macOS)." },
  { label: "Node", command: "node", fix: "Install Node 18+." },
];

/** Probe Apple for an unsigned/expired agreement and for missing app records; best-effort. */
async function checkAppleAccount(): Promise<boolean> {
  const ascKey = await loadAscKey();
  if (!ascKey) {
    console.log("• No API key imported — skipping Apple checks (`relay creds set-key`).");
    return true;
  }
  const client = new AppStoreConnectClient(ascKey);
  try {
    await client.assertReady();
    console.log("✓ Apple agreements accepted");
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

/** Attach the `doctor` command to the program. */
export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("check that the local toolchain and Apple account are ready")
    .action(async () => {
      let allOk = true;
      for (const check of TOOL_CHECKS) {
        const ok = await exists(check.command);
        allOk &&= ok;
        console.log(`${ok ? "✓" : "✗"} ${check.label}${ok ? "" : `  — ${check.fix}`}`);
      }
      console.log(`• ${await localCredentialsProvider.status()}`);
      const appleOk = await checkAppleAccount();
      if (!allOk || !appleOk) process.exitCode = 1;
    });
}
