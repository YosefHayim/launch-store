/**
 * Build/submit completion notifications — the EAS-`webhook` parity hook.
 *
 * A local Mac build can run many minutes, so a ping on completion (success or failure) is high-value.
 * When `launch.config.ts` declares a {@link NotifyConfig}, {@link notifyCompletion} POSTs a
 * Slack/Discord-compatible JSON body to the webhook and/or runs a shell command with the event in its
 * environment. It is strictly best-effort: every failure is swallowed and logged, never thrown, so a
 * flaky webhook can't fail a build that already succeeded.
 *
 * The payload builders ({@link notifyPayload}, {@link notifyMessage}, {@link notifyEnv}) are pure and
 * unit-tested; only {@link notifyCompletion} does I/O (the POST + the shell run).
 */

import { exec } from "node:child_process";
import type { LaunchConfig, NotifyConfig, Platform } from "./types.js";
import { createLogger } from "./logger.js";

/**
 * The completion event passed to {@link notifyCompletion} — everything a webhook payload or shell hook
 * reports about a finished run. `event` is the furthest stage reached (`submit` once an upload was
 * attempted, else `build`); `status` is its outcome. Size/buildNumber/destination are filled when
 * known (a success has them; an early failure may not).
 */
export interface NotifyEvent {
  event: "build" | "submit";
  status: "success" | "failure";
  app: string;
  platform: Platform;
  version: string;
  /** iOS build number / Android versionCode, when the run got far enough to assign one. */
  buildNumber?: number;
  /** Worst-case store download in bytes, when a size report was produced. */
  sizeBytes?: number;
  /** Where it landed, e.g. `TestFlight`, `App Store review`, `Google Play (internal track)`. */
  destination?: string;
  /** Failure message, present only when `status` is `failure`. */
  error?: string;
}

/** A one-line human summary of the event, used as the Slack/Discord message text. */
export function notifyMessage(event: NotifyEvent): string {
  const icon = event.status === "success" ? "✅" : "❌";
  const what = event.event === "submit" ? "submit" : "build";
  const head = `${icon} Launch: ${event.app} ${event.version}`;
  if (event.status === "failure") {
    return `${head} — ${what} failed${event.error ? `: ${event.error}` : ""}`;
  }
  const where = event.destination ? ` → ${event.destination}` : "";
  const build = event.buildNumber !== undefined ? ` (${event.buildNumber})` : "";
  return `${head}${build} ${what} succeeded${where}`;
}

/**
 * The JSON body POSTed to the webhook. `text` (Slack) and `content` (Discord) both carry the human
 * message so the same URL works for either; the structured event fields ride alongside for a custom
 * endpoint. Pure — the exact bytes are determined by the event.
 */
export function notifyPayload(event: NotifyEvent): Record<string, unknown> {
  const message = notifyMessage(event);
  return { text: message, content: message, ...event };
}

/** The `LAUNCH_*` environment a shell hook receives. Omitted fields simply don't appear. */
export function notifyEnv(event: NotifyEvent): Record<string, string> {
  const env: Record<string, string> = {
    LAUNCH_EVENT: event.event,
    LAUNCH_STATUS: event.status,
    LAUNCH_APP: event.app,
    LAUNCH_PLATFORM: event.platform,
    LAUNCH_VERSION: event.version,
    LAUNCH_MESSAGE: notifyMessage(event),
  };
  if (event.buildNumber !== undefined) env["LAUNCH_BUILD_NUMBER"] = String(event.buildNumber);
  if (event.sizeBytes !== undefined) env["LAUNCH_SIZE_BYTES"] = String(event.sizeBytes);
  if (event.destination) env["LAUNCH_DESTINATION"] = event.destination;
  if (event.error) env["LAUNCH_ERROR"] = event.error;
  return env;
}

/** POST the payload to the webhook. Best-effort: any network/HTTP error is reported, never thrown. */
async function postWebhook(url: string, event: NotifyEvent, log: ReturnType<typeof createLogger>): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(notifyPayload(event)),
    });
    if (!response.ok) log.warn(`Notification webhook returned ${response.status}.`);
  } catch (error) {
    log.warn(`Notification webhook failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run the shell hook with the event in its environment. Uses the platform shell (like a git hook) —
 * the command is the user's own config, not interpolated Launch data, so there's no injection vector.
 * Best-effort: a non-zero exit or spawn error is reported, never thrown.
 */
function runHook(command: string, event: NotifyEvent, log: ReturnType<typeof createLogger>): Promise<void> {
  return new Promise((resolve) => {
    exec(command, { env: { ...process.env, ...notifyEnv(event) } }, (error) => {
      if (error) log.warn(`Notification command failed: ${error.message}`);
      resolve();
    });
  });
}

/**
 * Fire the configured completion notifications for `event`. A no-op when neither a `webhookUrl` nor a
 * `command` is set. The webhook and the shell hook run concurrently; both are best-effort, so this
 * resolves even when one (or both) fail — a notification must never break a build that already ran.
 */
export async function notifyCompletion(config: LaunchConfig, event: NotifyEvent): Promise<void> {
  const notify: NotifyConfig | undefined = config.notify;
  if (!notify?.webhookUrl && !notify?.command) return;
  const log = createLogger(false);
  await Promise.all([
    notify.webhookUrl ? postWebhook(notify.webhookUrl, event, log) : Promise.resolve(),
    notify.command ? runHook(notify.command, event, log) : Promise.resolve(),
  ]);
}
