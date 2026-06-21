/**
 * `launch rollout <pause|resume|complete>` — steer an iOS phased release after approval.
 *
 * Apple's 7-day phased release ramps an approved update to a growing slice of users; this command
 * pauses it, resumes a paused one, or completes the ramp to 100% immediately, by PATCHing the version's
 * phased-release schedule over the API. Opt into phasing at submit time with `launch release --phased`.
 */

import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { appRecordMissingMessage, IOS_PLATFORM, pickCurrentVersion } from "../../core/appStoreRelease.js";
import { notify } from "../../core/notify.js";
import { selectIosApps } from "./status.js";

/** CLI options for `launch rollout`. */
interface RolloutOptions {
  /** Comma-separated app handles; default is every discovered iOS app. */
  app?: string;
}

/** Map a rollout verb to the App Store Connect phased-release state. Pure; throws on an unknown verb. */
export function phasedStateForAction(action: string): "PAUSE" | "ACTIVE" | "COMPLETE" {
  switch (action) {
    case "pause":
      return "PAUSE";
    case "resume":
      return "ACTIVE";
    case "complete":
      return "COMPLETE";
    default:
      throw new Error(`Unknown rollout action "${action}". Use pause | resume | complete.`);
  }
}

/** Map a rollout verb to its notification status. Pure; throws on an unknown verb (mirrors {@link phasedStateForAction}). */
export function rolloutNotifyStatus(action: string): "paused" | "resumed" | "completed" {
  switch (action) {
    case "pause":
      return "paused";
    case "resume":
      return "resumed";
    case "complete":
      return "completed";
    default:
      throw new Error(`Unknown rollout action "${action}". Use pause | resume | complete.`);
  }
}

/** Attach the `rollout` command to the program. */
export function registerRolloutCommand(program: Command): void {
  program
    .command("rollout")
    .description("steer an iOS phased release: pause | resume | complete")
    .argument("<action>", "pause | resume | complete")
    .option("-a, --app <names>", "comma-separated app handles (default: all iOS apps)")
    .action(async (action: string, options: RolloutOptions) => {
      const state = phasedStateForAction(action);
      const notifyStatus = rolloutNotifyStatus(action);
      const { config, apps } = await loadConfig();
      const ios = selectIosApps(apps, options.app);
      const log = createLogger(false);
      if (ios.length === 0) {
        log.info("No iOS apps discovered. Add an app with an ios.bundleIdentifier in app.json.");
        return;
      }

      const ascKey = await loadActiveAscKey();
      if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
      const client = new AppStoreConnectClient(ascKey);

      for (const app of ios) {
        const appId = await client.getAppId(app.bundleId);
        if (!appId) {
          log.error(`${app.name}: ${appRecordMissingMessage(app.bundleId, "launch rollout")}`);
          process.exitCode = 1;
          continue;
        }
        const version = pickCurrentVersion(await client.listAppStoreVersions(appId, IOS_PLATFORM));
        if (!version) {
          log.warn(`${app.name}: no App Store version to roll out.`);
          continue;
        }
        const phased = await client.getPhasedRelease(version.id);
        if (!phased) {
          log.warn(`${app.name}: version ${version.versionString} has no phased release (it went out all at once).`);
          process.exitCode = 1;
          continue;
        }
        await client.updatePhasedRelease(phased.id, state);
        log.step(app.name, `phased release → ${state} (was ${phased.phasedReleaseState})`);
        await notify(config, {
          event: "rollout",
          status: notifyStatus,
          app: app.name,
          platform: "ios",
          version: version.versionString,
          detail: state,
        });
      }
    });
}
