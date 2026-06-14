/**
 * Build/submit completion notifications — EAS-webhook parity for local builds.
 *
 * A local Mac build can run many minutes; a ping when it finishes (or fails) is high-value. Each
 * configured hook (`launch.config.ts` → {@link NotifyConfig}) can POST to a Slack/Discord-compatible
 * webhook and/or run a shell command with the build metadata in its environment. Dependency-free: the
 * webhook is a plain `fetch` POST, the shell command runs through `core/exec.ts` (`sh -c`, no string
 * interpolation from us). Notifications are best-effort — a failed ping never fails the build — and a
 * no-op when nothing is configured, so an unconfigured project is unaffected.
 */

import type { LaunchConfig, NotifyHook, Platform } from "./types.js";
import { run } from "./exec.js";
import { mb } from "./pipeline.js";

/**
 * What happened, for one notification. Carries enough for a readable message and a rich shell env:
 * what kind of step (build vs submit), whether it succeeded, and the build's identity/size/destination.
 */
export interface NotifyEvent {
  kind: "build" | "submit";
  status: "success" | "failure";
  app: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  /** Where it landed (TestFlight / a Play track), when known. */
  destination?: string;
  /** Worst-case store download in bytes, when known (build events). */
  downloadBytes?: number;
  /** Error message, on failure. */
  error?: string;
}

/** A one-line human summary of an event, used as the webhook `text` and a final console line. */
export function formatNotifyMessage(event: NotifyEvent): string {
  const icon = event.status === "success" ? "✅" : "❌";
  const verb = event.kind === "build" ? "build" : "submit";
  const head = `${icon} ${event.app} ${event.version} (build ${event.buildNumber}) · ${event.platform} ${verb} ${event.status}`;
  const parts: string[] = [];
  if (event.status === "failure") {
    if (event.error) parts.push(event.error);
  } else {
    if (event.destination) parts.push(`→ ${event.destination}`);
    if (event.downloadBytes !== undefined) parts.push(`download ${mb(event.downloadBytes)}`);
  }
  return parts.length > 0 ? `${head} · ${parts.join(" · ")}` : head;
}

/** The `LAUNCH_*` environment a shell hook receives — all values stringified, undefined keys omitted. */
export function notifyEnv(event: NotifyEvent): Record<string, string> {
  const env: Record<string, string> = {
    LAUNCH_KIND: event.kind,
    LAUNCH_STATUS: event.status,
    LAUNCH_APP: event.app,
    LAUNCH_PLATFORM: event.platform,
    LAUNCH_VERSION: event.version,
    LAUNCH_BUILD_NUMBER: String(event.buildNumber),
    LAUNCH_MESSAGE: formatNotifyMessage(event),
  };
  if (event.destination !== undefined) env["LAUNCH_DESTINATION"] = event.destination;
  if (event.downloadBytes !== undefined) env["LAUNCH_DOWNLOAD_BYTES"] = String(event.downloadBytes);
  if (event.error !== undefined) env["LAUNCH_ERROR"] = event.error;
  return env;
}

/** Fire one hook's webhook + shell, swallowing errors so a notification never breaks the build. */
async function fireHook(hook: NotifyHook, event: NotifyEvent): Promise<void> {
  if (hook.webhook) {
    try {
      await fetch(hook.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: formatNotifyMessage(event) }),
      });
    } catch {
      /* a webhook that's unreachable/misconfigured must not fail the build */
    }
  }
  if (hook.shell) {
    try {
      await run("sh", ["-c", hook.shell], { env: notifyEnv(event) });
    } catch {
      /* the user's hook command failed — surface nothing; it's a side-channel, not the build */
    }
  }
}

/**
 * Fire the hook for this event kind, if configured. The single entry point the pipeline calls on
 * build/submit completion (success or failure). No-op when `notify` or the specific hook is absent.
 */
export async function notify(config: LaunchConfig, event: NotifyEvent): Promise<void> {
  const hook = event.kind === "build" ? config.notify?.onBuildComplete : config.notify?.onSubmitComplete;
  if (!hook) return;
  await fireHook(hook, event);
}
