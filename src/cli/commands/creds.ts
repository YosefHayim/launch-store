/**
 * `relay creds [status|set-key|setup]` — inspect or provision Apple credentials.
 *
 * - `set-key` imports an App Store Connect API key (`.p8` + Key ID + Issuer ID) into the Keychain.
 * - `setup` runs the one-time provisioning: registers the App ID and creates/reuses the distribution
 *   certificate + App Store provisioning profile via the API (with a confirmation before each real
 *   Apple resource), so a later `relay build` just reuses them.
 * - `status` reports what's stored.
 */

import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { cancel, isCancel, text } from "@clack/prompts";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { interactiveConfirm, selectApp } from "../../core/pipeline.js";
import { ensureSigningCredentials } from "../../apple/credentials.js";
import { loadAscKey, localCredentialsProvider, storeAscKey } from "../../providers/credentials/local.js";

/** Prompt for a required value, exiting cleanly if the user cancels. */
async function ask(message: string, placeholder?: string): Promise<string> {
  const value = await text({
    message,
    validate: (v) => (v.trim() === "" ? "Required." : undefined),
    ...(placeholder ? { placeholder } : {}),
  });
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return value.trim();
}

/** Import an App Store Connect API key into the Keychain. */
async function setKey(): Promise<void> {
  const keyId = await ask("App Store Connect Key ID", "e.g. QS5924Q3MD");
  const issuerId = await ask("Issuer ID", "the UUID from Users & Access → Integrations");
  const p8Path = await ask("Path to the .p8 file", "~/Downloads/AuthKey_XXXX.p8");
  const home = process.env["HOME"] ?? "~";
  const p8 = readFileSync(p8Path.replace(/^~/, home), "utf8");
  await storeAscKey(keyId, issuerId, p8);
  console.log(`Stored API key ${keyId} in the Keychain.`);
}

/** Provision (or reuse) the distribution certificate + provisioning profile for an app. */
async function setup(): Promise<void> {
  const ascKey = await loadAscKey();
  if (!ascKey) throw new Error("Import an API key first: relay creds set-key");
  const { apps } = await loadConfig();
  const app = await selectApp(apps, undefined);
  if (!app.bundleId) throw new Error(`No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`);
  const signing = await ensureSigningCredentials({
    bundleId: app.bundleId,
    appName: app.name,
    ascKey,
    log: createLogger(false),
    dryRun: false,
    confirmCreate: interactiveConfirm,
  });
  console.log(
    `Ready: distribution cert ${signing.certSerial}, profile ${signing.profileName} (team ${signing.teamId}).`,
  );
}

/** Attach the `creds` command to the program. */
export function registerCredsCommand(program: Command): void {
  program
    .command("creds")
    .argument("[action]", "status | set-key | setup", "status")
    .action(async (action: string) => {
      switch (action) {
        case "status":
          console.log(await localCredentialsProvider.status());
          return;
        case "set-key":
          await setKey();
          return;
        case "setup":
          await setup();
          return;
        default:
          throw new Error(`Unknown action "${action}". Use "status", "set-key", or "setup".`);
      }
    });
}
