import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect } from 'effect';
import type { Platform } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import type { NotifyConfig } from '../types/storeSurface.js';
import { executeCommandQuietly, provideNodeCommandServices } from './exec.js';
import { errorMessage } from './errorMessage.js';
import { createLogger, type Logger } from './logger.js';
/** Fields every {@link NotifyEvent} carries, regardless of which transition fired it. */
type NotifyEventBase = {
  app: string;
  platform: Platform;
  version: string;
};
/**
 * A finished build or submit run - the original completion ping. `event` is the furthest stage reached
 * (`submit` once an upload was attempted, else `build`); `status` is its outcome. Size/buildNumber/
 * destination are filled when known (a success has them; an early failure may not). Fired from the
 * build->submit pipeline and the `release` command.
 */
export type CompletionEvent = NotifyEventBase & {
  event: 'build' | 'submit';
  status: 'success' | 'failure';
  buildNumber?: number;
  sizeBytes?: number;
  destination?: string;
  error?: string;
};
/**
 * An App Store review reached a verdict. Fired from `launch status --watch` the first time an app
 * settles to a terminal verdict, so a dev who walked away learns the outcome without babysitting the
 * poll loop.
 */
export type ReviewEvent = NotifyEventBase & {
  event: 'review';
  status: 'approved' | 'rejected';
  detail?: string;
};
/**
 * A phased rollout changed state. Fired from `launch rollout` after a successful pause/resume/complete,
 * and from `launch status --watch` when Apple advances the ramp (`advanced`) between polls.
 */
export type RolloutEvent = NotifyEventBase & {
  event: 'rollout';
  status: 'paused' | 'resumed' | 'completed' | 'advanced';
  detail?: string;
};
/** Every transition Launch can notify on - a discriminated union keyed on `event`. */
export type NotifyEvent = CompletionEvent | ReviewEvent | RolloutEvent;
/** A one-line human summary of the event, used as the Slack/Discord message text. */
export const notifyMessage = (event: NotifyEvent): string => {
  switch (event.event) {
    case 'build':
    case 'submit': {
      let icon = '[ERROR]';
      if (event.status === 'success') icon = '[OK]';
      let what = 'build';
      if (event.event === 'submit') what = 'submit';
      const head = `${icon} Launch: ${event.app} ${event.version}`;
      if (event.status === 'failure') {
        let errorSuffix = '';
        if (event.error) errorSuffix = `: ${event.error}`;
        return `${head} - ${what} failed${errorSuffix}`;
      }
      let where = '';
      if (event.destination) where = ` -> ${event.destination}`;
      let buildNumberText = '';
      if (event.buildNumber !== undefined) buildNumberText = ` (${event.buildNumber})`;
      return `${head}${buildNumberText} ${what} succeeded${where}`;
    }
    case 'review': {
      let icon = '[ERROR]';
      if (event.status === 'approved') icon = '[OK]';
      const head = `${icon} Launch: ${event.app} ${event.version} - review ${event.status}`;
      if (event.detail) return `${head}: ${event.detail}`;
      return head;
    }
    case 'rollout': {
      const head = ` Launch: ${event.app} ${event.version} - rollout ${event.status}`;
      if (event.detail) return `${head} (${event.detail})`;
      return head;
    }
  }
};
/**
 * The JSON body POSTed to the webhook. `text` (Slack) and `content` (Discord) both carry the human
 * message so the same URL works for either; the structured event fields ride alongside for a custom
 * endpoint. Pure - the exact bytes are determined by the event.
 */
export const notificationDocument = (event: NotifyEvent): Record<string, unknown> => {
  const message = notifyMessage(event);
  return { text: message, content: message, ...event };
};
/** The `LAUNCH_*` environment a shell hook receives. Omitted fields simply don't appear. */
export const notifyEnv = (event: NotifyEvent): Record<string, string> => {
  const env: Record<string, string> = {
    LAUNCH_EVENT: event.event,
    LAUNCH_STATUS: event.status,
    LAUNCH_APP: event.app,
    LAUNCH_PLATFORM: event.platform,
    LAUNCH_VERSION: event.version,
    LAUNCH_MESSAGE: notifyMessage(event),
  };
  if (event.event === 'review') {
    if (event.detail !== undefined) env['LAUNCH_DETAIL'] = event.detail;
  } else if (event.event === 'rollout') {
    if (event.detail !== undefined) env['LAUNCH_DETAIL'] = event.detail;
  } else {
    if (event.buildNumber !== undefined) env['LAUNCH_BUILD_NUMBER'] = String(event.buildNumber);
    if (event.sizeBytes !== undefined) env['LAUNCH_SIZE_BYTES'] = String(event.sizeBytes);
    if (event.destination) env['LAUNCH_DESTINATION'] = event.destination;
    if (event.error) env['LAUNCH_ERROR'] = event.error;
  }
  return env;
};
/** POST one notification document and reduce every delivery failure to a warning. */
const postWebhook = (url: string, event: NotifyEvent, logger: Logger) =>
  Effect.gen(function* () {
    const webhookRequest = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.bodyJson(notificationDocument(event)),
    );
    const webhookResponse = yield* HttpClient.execute(webhookRequest);
    if (webhookResponse.status >= 200 && webhookResponse.status < 300) return;
    yield* logger.warn(`Notification webhook returned ${webhookResponse.status}.`);
  }).pipe(
    Effect.catchAll((cause) =>
      logger
        .warn(`Notification webhook failed: ${errorMessage(cause)}`)
        .pipe(Effect.catchAll(() => Effect.void)),
    ),
  );
/**
 * Run the shell hook with the event in its environment, like a git hook. Routed through
 * `core/exec.ts` (`shell: false`, explicit `["-c", command]` argv) rather than `child_process.exec`,
 * so Node never spawns a shell over a concatenated string - the AGENTS.md rule. The command is the
 * user's own `launch.config.ts` value, and event data reaches it only as `LAUNCH_*` environment vars,
 * never spliced into the command string, so there is no injection path from Launch-controlled data.
 * Output is drained (not printed) to keep the post-run summary clean; a non-zero exit or spawn error
 * is reported, never thrown - a notification must not fail a build that already ran.
 */
const runHook = (
  command: string,
  event: NotifyEvent,
  logger: Logger,
): Effect.Effect<void, unknown> =>
  provideNodeCommandServices(
    executeCommandQuietly('/bin/sh', ['-c', command], {
      environmentOverrides: notifyEnv(event),
    }),
  ).pipe(
    Effect.catchAll((cause) => logger.warn(`Notification command failed: ${errorMessage(cause)}`)),
  );
/**
 * Fire the configured notifications for `event`. A no-op when neither a `webhookUrl` nor a `command` is
 * set, or when `notify.events` is declared and doesn't include this event's transition. The webhook and
 * the shell hook run concurrently; both are best-effort, so this resolves even when one (or both) fail -
 * a notification must never break a build, review, or rollout that already happened.
 */
export const notify = (config: LaunchConfig, event: NotifyEvent) =>
  Effect.gen(function* () {
    const notifyConfig: NotifyConfig | undefined = config.notify;
    if (!notifyConfig?.webhookUrl && !notifyConfig?.command) return;
    if (notifyConfig.events && !notifyConfig.events.includes(event.event)) return;
    const logger = yield* createLogger(false);
    const notificationEffects: Effect.Effect<void, unknown, HttpClient.HttpClient>[] = [];
    if (notifyConfig.webhookUrl)
      notificationEffects.push(postWebhook(notifyConfig.webhookUrl, event, logger));
    if (notifyConfig.command)
      notificationEffects.push(runHook(notifyConfig.command, event, logger));
    yield* Effect.all(notificationEffects, { concurrency: 'unbounded', discard: true });
  });
