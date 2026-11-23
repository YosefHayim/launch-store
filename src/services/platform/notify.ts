import type { Platform } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';
import type { NotifyConfig } from '@/types/store-surface.js';
import { errorMessage } from './error-message.ts';
import { executeCommandQuietly } from './exec.ts';
import { createLogger, type Logger } from './logger.ts';
import { redactText } from './redact.ts';
/** Fields every {@link NotifyEvent} carries, regardless of which transition fired it. */
type NotifyEventBase = {
  app: string;
  platform: Platform;
  version: string;
};
/** A finished build or submit run - the original completion ping. */
type CompletionEvent = NotifyEventBase & {
  event: 'build' | 'submit';
  status: 'success' | 'failure';
  buildNumber?: number;
  sizeBytes?: number;
  destination?: string;
  error?: string;
};
/** An App Store review reached a verdict. */
type ReviewEvent = NotifyEventBase & {
  event: 'review';
  status: 'approved' | 'rejected';
  detail?: string;
};
/** A phased rollout changed state. */
type RolloutEvent = NotifyEventBase & {
  event: 'rollout';
  status: 'paused' | 'resumed' | 'completed' | 'advanced';
  detail?: string;
};
/** Every transition Launch can notify on - a discriminated union keyed on `event`. */
export type NotifyEvent = CompletionEvent | ReviewEvent | RolloutEvent;
/** A one-line human summary of the event, used as the Slack/Discord message text. */
export function notifyMessage(event: NotifyEvent): string {
  switch (event.event) {
    case 'build':
    case 'submit': {
      let icon = '[ERROR]';

      if (event.status == 'success') icon = '[OK]';

      let what = 'build';

      if (event.event == 'submit') what = 'submit';

      const head = `${icon} Launch: ${event.app} ${event.version}`;

      if (event.status == 'failure') {
        let errorSuffix = '';

        if (event.error) errorSuffix = `: ${event.error}`;

        return `${head} - ${what} failed${errorSuffix}`;
      }

      let where = '';

      if (event.destination) where = ` -> ${event.destination}`;

      let buildNumberText = '';

      if (event.buildNumber != null) buildNumberText = ` (${event.buildNumber})`;

      return `${head}${buildNumberText} ${what} succeeded${where}`;
    }
    case 'review': {
      let icon = '[ERROR]';

      if (event.status == 'approved') icon = '[OK]';

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
}
/** The JSON body POSTed to the webhook. */
export function notificationDocument(event: NotifyEvent): Record<string, unknown> {
  const message = notifyMessage(event);
  const notification: Record<string, unknown> = {
    text: redactText(message),
    content: redactText(message),
  };

  for (const [field, eventValue] of Object.entries(event)) {
    if (typeof eventValue == 'string') notification[field] = redactText(eventValue);
    else notification[field] = eventValue;
  }

  return notification;
}
/** The `LAUNCH_*` environment a shell hook receives. Omitted fields simply don't appear. */
export function notifyEnv(event: NotifyEvent): Record<string, string> {
  const message = notifyMessage(event);
  const env: Record<string, string> = {
    LAUNCH_EVENT: event.event,
    LAUNCH_STATUS: event.status,
    LAUNCH_APP: event.app,
    LAUNCH_PLATFORM: event.platform,
    LAUNCH_VERSION: event.version,
    LAUNCH_MESSAGE: redactText(message),
  };

  if (event.event == 'review') {
    if (event.detail != null) env['LAUNCH_DETAIL'] = event.detail;
  } else if (event.event == 'rollout') {
    if (event.detail != null) env['LAUNCH_DETAIL'] = event.detail;
  } else {
    if (event.buildNumber != null) env['LAUNCH_BUILD_NUMBER'] = String(event.buildNumber);

    if (event.sizeBytes != null) env['LAUNCH_SIZE_BYTES'] = String(event.sizeBytes);

    if (event.destination) env['LAUNCH_DESTINATION'] = event.destination;

    if (event.error) env['LAUNCH_ERROR'] = event.error;
  }

  return env;
}
function isSuccessfulStatus(status: number): boolean {
  if (status < 200) {
    return false;
  }

  if (status >= 300) {
    return false;
  }

  return true;
}

function hasNotifyText(text: string | undefined): text is string {
  if (text == null) {
    return false;
  }

  return text.length > 0;
}

/** POST one notification document and reduce every delivery failure to a warning. */
async function postWebhook(url: string, event: NotifyEvent, logger: Logger): Promise<void> {
  try {
    const serialized = JSON.stringify(notificationDocument(event));
    const webhookReply = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serialized,
    });

    const delivered = isSuccessfulStatus(webhookReply.status);

    if (delivered) {
      return;
    }

    logger.warn(`Notification webhook returned ${webhookReply.status}.`);
  } catch (error) {
    const failureMessage = errorMessage(error);
    logger.warn(`Notification webhook failed: ${failureMessage}`);
  }
}

/** Run the shell hook with the event in its environment. */
async function runHook(command: string, event: NotifyEvent, logger: Logger): Promise<void> {
  try {
    await executeCommandQuietly('/bin/sh', ['-c', command], {
      environmentOverrides: notifyEnv(event),
    });
  } catch (error) {
    const failureMessage = errorMessage(error);
    logger.warn(`Notification command failed: ${failureMessage}`);
  }
}

/** Fire the configured notifications for `event`. */
export async function notify(launchConfig: LaunchConfig, event: NotifyEvent): Promise<void> {
  const notifyConfig: NotifyConfig | undefined = launchConfig.notify;
  const hasWebhook = hasNotifyText(notifyConfig?.webhookUrl);
  const hasCommand = hasNotifyText(notifyConfig?.command);

  if (hasWebhook == false) {
    if (hasCommand == false) {
      return;
    }
  }

  if (notifyConfig == null) {
    return;
  }

  if (notifyConfig.events != null) {
    const includesEvent = notifyConfig.events.includes(event.event);

    if (includesEvent == false) {
      return;
    }
  }

  const logger = createLogger(false);
  const sends: Promise<void>[] = [];

  const webhookUrl = notifyConfig.webhookUrl;
  const command = notifyConfig.command;

  if (hasNotifyText(webhookUrl)) {
    sends.push(postWebhook(webhookUrl, event, logger));
  }

  if (hasNotifyText(command)) {
    const hook = runHook(command, event, logger);
    sends.push(hook);
  }

  await Promise.all(sends);
}
