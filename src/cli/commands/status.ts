/**
 * `launch status [platform]` — where the app stands on App Store Connect right now.
 *
 * Reads the current App Store version's lifecycle state (in review, pending release, live, rejected),
 * the latest build's processing state, and any phased-rollout progress — the at-a-glance answer to
 * "did it go through?" without opening the website. On a rejection it deep-links to Resolution Center:
 * the rejection *message* lives behind Apple's web-session-only `iris` API, which Launch deliberately
 * never touches (API-key auth only), so the link is the honest hand-off rather than a scraped message.
 *
 * `--watch` polls until the release reaches a settled state (live, pending your release, or rejected),
 * printing each transition — useful right after `launch release`.
 */

import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { selectApp, resolveIosAccount } from "../../core/pipeline.js";
import { loadAscKeyById } from "../../core/accounts.js";
import { createLogger } from "../../core/logger.js";
import { isInteractive } from "../../core/progress.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { readReleaseStatus, type ReleaseStatus } from "../../core/appStoreRelease.js";

interface StatusOptions {
  app?: string;
  account?: string;
  watch?: boolean;
  explain: boolean;
}

/** States still moving toward a verdict — `--watch` keeps polling while the version is in one of these. */
const TRANSIENT_STATES = new Set<string>([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PROCESSING_FOR_APP_STORE",
  "PENDING_APPLE_RELEASE",
]);

const WATCH_INTERVAL_MS = 30_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Attach the `status` command to the program. */
export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("show where the app stands on App Store Connect (in review, live, rejected, rolling out)")
    .argument("[platform]", "ios (default)", "ios")
    .option("-a, --app <name>", "app handle")
    .option("--account <id>", "Apple account label or Key ID (default: the active account)")
    .option("--watch", "poll until the release settles (live, pending release, or rejected)", false)
    .option("--explain", "expand each step", false)
    .action(async (platform: string, options: StatusOptions) => {
      if (platform !== "ios") throw new Error(`\`launch status\` is iOS-only for now. Got "${platform}".`);
      await runStatus(options);
    });
}

/** Resolve the app + account, then print (or watch) its App Store release status. */
async function runStatus(options: StatusOptions): Promise<void> {
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
  if (!appId) {
    log.info(
      `No App Store Connect record for ${bundleId} yet — nothing to report. Run \`launch release ios\` to start.`,
    );
    return;
  }

  if (options.watch && isInteractive()) {
    await watchStatus(client, appId, bundleId, log);
    return;
  }
  printStatus(await readReleaseStatus(client, appId), appId, await latestBuildState(client, bundleId), log);
}

/** Poll until the release settles, printing each state transition. */
async function watchStatus(
  client: AppStoreConnectClient,
  appId: string,
  bundleId: string,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  let last = "";
  for (;;) {
    const status = await readReleaseStatus(client, appId);
    if (status.appStoreState !== last) {
      printStatus(status, appId, await latestBuildState(client, bundleId), log);
      last = status.appStoreState ?? "";
    }
    if (!status.appStoreState || !TRANSIENT_STATES.has(status.appStoreState)) return;
    await delay(WATCH_INTERVAL_MS);
  }
}

/** The newest build's processing state, best-effort (a nicety on the status readout). */
async function latestBuildState(client: AppStoreConnectClient, bundleId: string): Promise<string | null> {
  if (!bundleId) return null;
  const builds = await client.listBuilds(bundleId).catch(() => []);
  const newest = builds[0];
  return newest ? `build ${newest.buildNumber}: ${newest.processingState}` : null;
}

/** Render one status snapshot: version + state, build processing, rollout, and any rejection link. */
function printStatus(
  status: ReleaseStatus,
  appId: string,
  buildLine: string | null,
  log: ReturnType<typeof createLogger>,
): void {
  if (!status.versionString) {
    log.info("No App Store version in progress.");
    if (buildLine) log.info(buildLine);
    return;
  }
  const rows = [
    `${status.versionString} · ${status.appStoreState}${status.releaseType ? ` · ${status.releaseType}` : ""}`,
  ];
  if (buildLine) rows.push(buildLine);
  if (status.phasedReleaseState) rows.push(`phased rollout: ${status.phasedReleaseState}`);
  log.box("App Store status", rows);

  if (status.rejected) {
    log.warn(
      "Rejected by App Review. Open Resolution Center for the message and to reply " +
        `(the API can't read it): https://appstoreconnect.apple.com/apps/${appId}/resolutioncenter`,
    );
  }
}
