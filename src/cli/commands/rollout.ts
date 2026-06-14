/**
 * `launch rollout <pause|resume|complete> [platform]` — steer an in-progress phased release.
 *
 * Apple's phased release rolls an approved update out to a growing percentage of users over 7 days.
 * This command pauses that rollout (freeze at the current percentage), resumes it, or completes it
 * (release to everyone now) — the controls that otherwise live in the App Store Connect website.
 * It acts on the version that's currently rolling out, and errors clearly when none is.
 */

import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { selectApp, resolveIosAccount } from "../../core/pipeline.js";
import { loadAscKeyById } from "../../core/accounts.js";
import { createLogger } from "../../core/logger.js";
import { withSpinner } from "../../core/progress.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { controlPhasedRelease, type RolloutAction } from "../../core/appStoreRelease.js";

interface RolloutOptions {
  app?: string;
  account?: string;
  explain: boolean;
}

/** The phased-rollout actions a user can type, for arg validation. */
const ACTIONS = new Set<RolloutAction>(["pause", "resume", "complete"]);

/** Human-readable confirmation for each completed action. */
const ACTION_DONE: Record<RolloutAction, string> = {
  pause: "paused",
  resume: "resumed",
  complete: "completed (releasing to everyone)",
};

/** Attach the `rollout` command to the program. */
export function registerRolloutCommand(program: Command): void {
  program
    .command("rollout")
    .description("steer an in-progress phased release: pause, resume, or complete it")
    .argument("<action>", "pause, resume, or complete")
    .argument("[platform]", "ios (default)", "ios")
    .option("-a, --app <name>", "app handle")
    .option("--account <id>", "Apple account label or Key ID (default: the active account)")
    .option("--explain", "expand each step", false)
    .action(async (action: string, platform: string, options: RolloutOptions) => {
      if (platform !== "ios") throw new Error(`\`launch rollout\` is iOS-only for now. Got "${platform}".`);
      if (!ACTIONS.has(action as RolloutAction)) {
        throw new Error(`Unknown action "${action}". Use pause, resume, or complete.`);
      }
      await runRollout(action as RolloutAction, options);
    });
}

/** Resolve the app + account, then apply the phased-rollout control action. */
async function runRollout(action: RolloutAction, options: RolloutOptions): Promise<void> {
  const log = createLogger(options.explain);
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const bundleId = app.bundleId;
  if (!bundleId) throw new Error(`No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`);

  const account = await resolveIosAccount(options, log);
  const ascKey = await loadAscKeyById(account.keyId);
  if (!ascKey)
    throw new Error(`No App Store Connect key stored for account ${account.label}. Run \`launch creds set-key\`.`);
  const client = new AppStoreConnectClient(ascKey);

  const appId = await client.getAppId(bundleId);
  if (!appId) throw new Error(`No App Store Connect record for ${bundleId}. Nothing is rolling out.`);

  const result = await withSpinner(`Setting phased rollout to ${action}`, () =>
    controlPhasedRelease(client, appId, action),
  );
  log.step("rollout", `${result.versionString}: ${result.from} → ${result.to} · ${ACTION_DONE[action]}`);
}
