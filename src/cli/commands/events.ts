/**
 * `launch events list|create|localize|delete` — read and manage App Store **in-app events** from the CLI,
 * using the App Store Connect API key alone (the local equivalent of the "In-App Events" section; EAS has
 * no equivalent). Scope is the event records + their localized copy; scheduling, media, and review
 * submission are left to App Store Connect (see `core/appEvents.ts`).
 *
 * Thin glue over `core/appEvents.ts`: resolves the account + app, renders output, and guards the one
 * destructive write (deleting an event) behind a confirmation. All event logic and request shaping live in
 * the core module and the ASC client.
 */

import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { loadConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import { createLogger } from '../../core/logger.js';
import {
  createEvent,
  deleteEvent,
  listEvents,
  localizeEvent,
  type AppEventWithLocalizations,
} from '../../core/appEvents.js';

/** Options for `events create`: the app + the event's attributes, plus the CI bypass. */
interface CreateOptions {
  app?: string;
  badge?: string;
  locale?: string;
  deepLink?: string;
  priority?: string;
  purpose?: string;
}

/** Options for `events localize`: the locale and the copy fields to set. */
interface LocalizeOptions {
  locale: string;
  name?: string;
  short?: string;
  long?: string;
}

/** Build a client bound to the active Apple account, or fail with the onboarding hint. */
async function activeClient(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  return new AppStoreConnectClient(ascKey);
}

/** Resolve the selected app's iOS bundle id, erroring when the app has none. */
async function resolveBundleId(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.bundleId) {
    throw new Error(
      `No iOS bundle identifier for ${app.name} (set ios.bundleIdentifier in app.json).`,
    );
  }
  return app.bundleId;
}

/** Render one event with its localizations as a readable block. */
function renderEvent({ event, localizations }: AppEventWithLocalizations): string {
  const meta = [
    event.badge,
    event.eventState,
    event.primaryLocale ? `primary ${event.primaryLocale}` : undefined,
  ]
    .filter(Boolean)
    .join('  ');
  const lines = [`${event.id}  ${event.referenceName}`];
  if (meta) lines.push(`  ${meta}`);
  if (event.deepLink) lines.push(`  ↳ ${event.deepLink}`);
  for (const localization of localizations) {
    lines.push(`  [${localization.locale}] ${localization.name ?? '(no name)'}`);
  }
  return lines.join('\n');
}

/** Confirm a destructive write, refusing in CI unless `--yes` was passed. */
async function confirmWrite(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdout.isTTY) {
    throw new Error(
      'Refusing to delete without confirmation. Re-run with --yes (non-interactive).',
    );
  }
  const proceed = await confirm({ message });
  if (isCancel(proceed) || !proceed) {
    cancel('Aborted — nothing deleted.');
    return false;
  }
  return true;
}

/** Attach the `events` command (with `list` / `create` / `localize` / `delete` subcommands) to the program. */
export function registerEventsCommand(program: Command): void {
  const events = program
    .command('events')
    .description('read and manage App Store in-app events from the CLI');

  events
    .command('list')
    .description("list an app's in-app events and their localizations")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: { app?: string; json?: boolean }) => {
      const bundleId = await resolveBundleId(options.app);
      const client = await activeClient();
      const found = await listEvents(client, bundleId);

      if (options.json) {
        console.log(JSON.stringify(found, null, 2));
        return;
      }
      if (found.length === 0) {
        console.log(
          'No in-app events yet. Create one with `launch events create <referenceName> --badge ...`.',
        );
        return;
      }
      console.log(found.map(renderEvent).join('\n\n'));
      console.log(`\n${found.length} event${found.length === 1 ? '' : 's'}.`);
    });

  events
    .command('create')
    .description('create a draft in-app event')
    .argument('<referenceName>', 'internal reference name for the event')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--badge <badge>', 'event badge (e.g. LIVE_EVENT, PREMIERE, CHALLENGE)')
    .option('--locale <code>', 'primary locale (e.g. en-US)')
    .option('--deep-link <url>', 'deep link opened when a user taps the event')
    .option('--priority <priority>', 'HIGH or NORMAL')
    .option('--purpose <purpose>', 'marketing purpose (e.g. ATTRACT_NEW_USERS)')
    .action(async (referenceName: string, options: CreateOptions) => {
      const log = createLogger(false);
      const bundleId = await resolveBundleId(options.app);
      const client = await activeClient();
      const event = await createEvent(client, bundleId, {
        referenceName,
        ...(options.badge !== undefined ? { badge: options.badge } : {}),
        ...(options.locale !== undefined ? { primaryLocale: options.locale } : {}),
        ...(options.deepLink !== undefined ? { deepLink: options.deepLink } : {}),
        ...(options.priority !== undefined ? { priority: options.priority } : {}),
        ...(options.purpose !== undefined ? { purpose: options.purpose } : {}),
      });
      log.step(
        'event created',
        `${event.id} — ${event.referenceName} (${event.eventState ?? 'DRAFT'})`,
      );
    });

  events
    .command('localize')
    .description("set (or update) one locale's copy on an event")
    .argument('<eventId>', 'the event id from `events list`')
    .requiredOption('--locale <code>', 'the locale to set (e.g. en-US)')
    .option('--name <text>', 'the event name shown to users')
    .option('--short <text>', 'the short description')
    .option('--long <text>', 'the long description')
    .action(async (eventId: string, options: LocalizeOptions) => {
      const log = createLogger(false);
      const client = await activeClient();
      const { localization, replaced } = await localizeEvent(client, eventId, {
        locale: options.locale,
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.short !== undefined ? { shortDescription: options.short } : {}),
        ...(options.long !== undefined ? { longDescription: options.long } : {}),
      });
      log.step(
        replaced ? 'localization updated' : 'localization created',
        `[${localization.locale}] ${eventId}`,
      );
    });

  events
    .command('delete')
    .description('delete a draft in-app event')
    .argument('<eventId>', 'the event id from `events list`')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (eventId: string, options: { yes?: boolean }) => {
      const log = createLogger(false);
      if (!(await confirmWrite(`Delete in-app event ${eventId}?`, options.yes))) return;
      const client = await activeClient();
      await deleteEvent(client, eventId);
      log.step('event deleted', eventId);
    });
}
