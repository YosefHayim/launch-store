/**
 * Transition notifications — the EAS-`webhook` parity hook, plus the post-upload milestones a dev
 * actually waits on.
 *
 * A local Mac build can run many minutes, and Apple's review verdict and a phased rollout's day-N
 * advance land hours or days later, so a ping on each transition is high-value. When `launch.config.ts`
 * declares a {@link NotifyConfig}, {@link notify} POSTs a Slack/Discord-compatible JSON body to the
 * webhook and/or runs a shell command with the event in its environment. It is strictly best-effort:
 * every failure is swallowed and logged, never thrown, so a flaky webhook can't fail a build that
 * already succeeded.
 *
 * The payload builders ({@link notifyPayload}, {@link notifyMessage}, {@link notifyEnv}) are pure and
 * unit-tested; only {@link notify} does I/O (the POST + the shell run).
 */

import type { LaunchConfig, NotifyConfig, Platform } from './types.js';
import { runQuiet } from './exec.js';
import { createLogger } from './logger.js';

/** Fields every {@link NotifyEvent} carries, regardless of which transition fired it. */
interface NotifyEventBase {
  app: string;
  platform: Platform;
  version: string;
}

/**
 * A finished build or submit run — the original completion ping. `event` is the furthest stage reached
 * (`submit` once an upload was attempted, else `build`); `status` is its outcome. Size/buildNumber/
 * destination are filled when known (a success has them; an early failure may not). Fired from the
 * build→submit pipeline and the `release` command.
 */
export interface CompletionEvent extends NotifyEventBase {
  event: 'build' | 'submit';
  status: 'success' | 'failure';
  /** iOS build number / Android versionCode, when the run got far enough to assign one. */
  buildNumber?: number;
  /** Worst-case store download in bytes, when a size report was produced. */
  sizeBytes?: number;
  /** Where it landed, e.g. `TestFlight`, `App Store review`, `Google Play (internal track)`. */
  destination?: string;
  /** Failure message, present only when `status` is `failure`. */
  error?: string;
}

/**
 * An App Store review reached a verdict. Fired from `launch status --watch` the first time an app
 * settles to a terminal verdict, so a dev who walked away learns the outcome without babysitting the
 * poll loop.
 */
export interface ReviewEvent extends NotifyEventBase {
  event: 'review';
  status: 'approved' | 'rejected';
  /** The verdict's human label, e.g. `Live on the App Store` / `Rejected — open Resolution Center`. */
  detail?: string;
}

/**
 * A phased rollout changed state. Fired from `launch rollout` after a successful pause/resume/complete,
 * and from `launch status --watch` when Apple advances the ramp (`advanced`) between polls.
 */
export interface RolloutEvent extends NotifyEventBase {
  event: 'rollout';
  status: 'paused' | 'resumed' | 'completed' | 'advanced';
  /** The phased-release state, e.g. `ACTIVE`, `COMPLETE`. */
  detail?: string;
}

/** Every transition Launch can notify on — a discriminated union keyed on `event`. */
export type NotifyEvent = CompletionEvent | ReviewEvent | RolloutEvent;

/** A one-line human summary of the event, used as the Slack/Discord message text. */
export function notifyMessage(event: NotifyEvent): string {
  switch (event.event) {
    case 'build':
    case 'submit': {
      const icon = event.status === 'success' ? '✅' : '❌';
      const what = event.event === 'submit' ? 'submit' : 'build';
      const head = `${icon} Launch: ${event.app} ${event.version}`;
      if (event.status === 'failure') {
        return `${head} — ${what} failed${event.error ? `: ${event.error}` : ''}`;
      }
      const where = event.destination ? ` → ${event.destination}` : '';
      const build = event.buildNumber !== undefined ? ` (${event.buildNumber})` : '';
      return `${head}${build} ${what} succeeded${where}`;
    }
    case 'review': {
      const icon = event.status === 'approved' ? '✅' : '❌';
      const head = `${icon} Launch: ${event.app} ${event.version} — review ${event.status}`;
      return event.detail ? `${head}: ${event.detail}` : head;
    }
    case 'rollout': {
      const head = `🚀 Launch: ${event.app} ${event.version} — rollout ${event.status}`;
      return event.detail ? `${head} (${event.detail})` : head;
    }
  }
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
  if (event.event === 'review' || event.event === 'rollout') {
    if (event.detail !== undefined) env['LAUNCH_DETAIL'] = event.detail;
  } else {
    if (event.buildNumber !== undefined) env['LAUNCH_BUILD_NUMBER'] = String(event.buildNumber);
    if (event.sizeBytes !== undefined) env['LAUNCH_SIZE_BYTES'] = String(event.sizeBytes);
    if (event.destination) env['LAUNCH_DESTINATION'] = event.destination;
    if (event.error) env['LAUNCH_ERROR'] = event.error;
  }
  return env;
}

/** POST the payload to the webhook. Best-effort: any network/HTTP error is reported, never thrown. */
async function postWebhook(
  url: string,
  event: NotifyEvent,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(notifyPayload(event)),
    });
    if (!response.ok) log.warn(`Notification webhook returned ${response.status}.`);
  } catch (error) {
    log.warn(
      `Notification webhook failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Run the shell hook with the event in its environment, like a git hook. Routed through
 * `core/exec.ts` (`shell: false`, explicit `["-c", command]` argv) rather than `child_process.exec`,
 * so Node never spawns a shell over a concatenated string — the AGENTS.md rule. The command is the
 * user's own `launch.config.ts` value, and event data reaches it only as `LAUNCH_*` environment vars,
 * never spliced into the command string, so there is no injection path from Launch-controlled data.
 * Output is drained (not printed) to keep the post-run summary clean; a non-zero exit or spawn error
 * is reported, never thrown — a notification must not fail a build that already ran.
 */
async function runHook(
  command: string,
  event: NotifyEvent,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  try {
    await runQuiet('/bin/sh', ['-c', command], { env: notifyEnv(event) });
  } catch (error) {
    log.warn(
      `Notification command failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Fire the configured notifications for `event`. A no-op when neither a `webhookUrl` nor a `command` is
 * set, or when `notify.events` is declared and doesn't include this event's transition. The webhook and
 * the shell hook run concurrently; both are best-effort, so this resolves even when one (or both) fail —
 * a notification must never break a build, review, or rollout that already happened.
 */
export async function notify(config: LaunchConfig, event: NotifyEvent): Promise<void> {
  const notifyConfig: NotifyConfig | undefined = config.notify;
  if (!notifyConfig?.webhookUrl && !notifyConfig?.command) return;
  if (notifyConfig.events && !notifyConfig.events.includes(event.event)) return;
  const log = createLogger(false);
  await Promise.all([
    notifyConfig.webhookUrl ? postWebhook(notifyConfig.webhookUrl, event, log) : Promise.resolve(),
    notifyConfig.command ? runHook(notifyConfig.command, event, log) : Promise.resolve(),
  ]);
}
