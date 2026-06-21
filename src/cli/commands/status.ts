/**
 * `launch status [--watch] [--json]` — where each app's current App Store release stands.
 *
 * Reads the live App Store version + review-submission state + build processing over the API and prints
 * a terminal verdict (and the phased-rollout state, when one's running). `--watch` polls until the
 * review settles; `--json` plus the documented exit codes (0 approved/released, 2 rejected, 3 still in
 * progress, 1 error) make it scriptable in CI. On a rejection it points at Resolution Center — Apple's
 * API doesn't expose the rejection text, so Launch links rather than scrapes.
 */

import type { Command } from "commander";
import type { AppDescriptor, LaunchConfig } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import {
  IOS_PLATFORM,
  readReleaseStatus,
  type ReleaseStatus,
  type ReleaseVerdict,
} from "../../core/appStoreRelease.js";
import { notify } from "../../core/notify.js";

/** CLI options for `launch status`. */
interface StatusOptions {
  /** Comma-separated app handles; default is every discovered iOS app. */
  app?: string;
  /** Poll until every app's review reaches a terminal verdict. */
  watch?: boolean;
  /** Machine-readable output (an array of {@link ReleaseStatus}) for CI. */
  json?: boolean;
}

/** One discovered iOS app reduced to what the status read needs. */
interface IosApp {
  name: string;
  bundleId: string;
}

/** How long to wait between `--watch` polls — App Store states change on the order of minutes. */
const WATCH_INTERVAL_MS = 30_000;

/** Resolve the iOS apps to report on from discovery + the optional `--app` selector. */
export function selectIosApps(apps: AppDescriptor[], selector: string | undefined): IosApp[] {
  const ios = apps.flatMap((app) => (app.bundleId ? [{ name: app.name, bundleId: app.bundleId }] : []));
  if (!selector) return ios;
  const wanted = selector
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const byName = new Map(ios.map((app) => [app.name, app]));
  return wanted.map((name) => {
    const app = byName.get(name);
    if (!app) throw new Error(`Unknown iOS app "${name}". iOS apps: ${ios.map((a) => a.name).join(", ") || "none"}.`);
    return app;
  });
}

/** One human status line, e.g. `v1.2.0 · In review · build 42 · phased: ACTIVE`. */
export function formatStatusLine(status: ReleaseStatus): string {
  const parts = [status.versionString ? `v${status.versionString}` : "no App Store version", status.verdict.label];
  if (status.buildNumber) {
    const processing =
      status.buildProcessingState && status.buildProcessingState !== "VALID" ? ` (${status.buildProcessingState})` : "";
    parts.push(`build ${status.buildNumber}${processing}`);
  }
  if (status.phasedReleaseState) parts.push(`phased: ${status.phasedReleaseState}`);
  return parts.join(" · ");
}

/**
 * The process exit code for a batch of verdicts — the worst wins, in priority order:
 * error (1) › rejected (2) › in progress (3) › ok (0). Lets CI gate a `launch status` call.
 */
export function worstExitCode(codes: number[]): number {
  const rank = (code: number): number => (code === 1 ? 3 : code === 2 ? 2 : code === 3 ? 1 : 0);
  return codes.reduce((worst, code) => (rank(code) > rank(worst) ? code : worst), 0);
}

/**
 * The review notification status for a verdict, or `null` when the transition isn't worth a ping.
 * A rejection notifies `rejected`; a `released`/`pending-release` verdict notifies `approved`. Other
 * settled verdicts (`preparing`, `unknown`) don't represent a review outcome, so they stay silent even
 * though their `verdict.done` is true. Pure.
 */
export function reviewStatusForVerdict(verdict: ReleaseVerdict): "approved" | "rejected" | null {
  if (verdict.state === "rejected") return "rejected";
  if (verdict.state === "released" || verdict.state === "pending-release") return "approved";
  return null;
}

/** Attach the `status` command to the program. */
export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("show each app's App Store version, review, and phased-rollout state")
    .option("-a, --app <names>", "comma-separated app handles (default: all iOS apps)")
    .option("--watch", "poll until the review reaches a terminal verdict", false)
    .option("--json", "machine-readable output for CI", false)
    .action(async (options: StatusOptions) => {
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

      const readAll = (): Promise<{ name: string; status: ReleaseStatus }[]> =>
        Promise.all(
          ios.map(async (app) => ({
            name: app.name,
            status: await readReleaseStatus(client, app.bundleId, IOS_PLATFORM),
          })),
        );

      if (options.watch && !options.json) {
        await watch(readAll, log, config);
        return;
      }

      const results = await readAll();
      if (options.json)
        console.log(
          JSON.stringify(
            results.map((result) => result.status),
            null,
            2,
          ),
        );
      else for (const { name, status } of results) log.step(name, formatStatusLine(status));
      process.exitCode = worstExitCode(results.map((result) => result.status.verdict.exitCode));
    });
}

/**
 * Poll until every app's verdict is terminal, printing each round and firing transition notifications.
 * A review notification fires once per app the first time it settles to a notify-worthy verdict; a
 * rollout `advanced` notification fires whenever an app's phased-release state changes to a new non-null
 * value between polls. Both are best-effort (never throw). The per-app `Set`/`Map` keep each transition
 * to at most one ping across the whole watch.
 */
async function watch(
  readAll: () => Promise<{ name: string; status: ReleaseStatus }[]>,
  log: ReturnType<typeof createLogger>,
  config: LaunchConfig,
): Promise<void> {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const reviewed = new Set<string>();
  const lastPhasedState = new Map<string, string>();
  for (;;) {
    const results = await readAll();
    log.gap();
    for (const { name, status } of results) {
      log.step(name, formatStatusLine(status));
      await notifyTransitions(config, name, status, reviewed, lastPhasedState);
    }
    if (results.every((result) => result.status.verdict.done)) {
      process.exitCode = worstExitCode(results.map((result) => result.status.verdict.exitCode));
      return;
    }
    await sleep(WATCH_INTERVAL_MS);
  }
}

/**
 * Fire the review/rollout notifications for one app's poll, tracking state so each transition pings at
 * most once. A review verdict notifies the first time the app reaches it (`reviewed` guards repeats); a
 * phased-state change to a new non-null value notifies as a rollout `advanced` (`lastPhasedState` tracks
 * the prior value per app). Best-effort — `notify` never throws.
 */
async function notifyTransitions(
  config: LaunchConfig,
  name: string,
  status: ReleaseStatus,
  reviewed: Set<string>,
  lastPhasedState: Map<string, string>,
): Promise<void> {
  const version = status.versionString ?? "";
  if (status.verdict.done && !reviewed.has(name)) {
    reviewed.add(name);
    const reviewStatus = reviewStatusForVerdict(status.verdict);
    if (reviewStatus) {
      await notify(config, {
        event: "review",
        status: reviewStatus,
        app: name,
        platform: "ios",
        version,
        detail: status.verdict.label,
      });
    }
  }

  const phased = status.phasedReleaseState;
  if (phased && lastPhasedState.get(name) !== phased) {
    const isFirstObservation = !lastPhasedState.has(name);
    lastPhasedState.set(name, phased);
    if (!isFirstObservation) {
      await notify(config, {
        event: "rollout",
        status: "advanced",
        app: name,
        platform: "ios",
        version,
        detail: phased,
      });
    }
  }
}
