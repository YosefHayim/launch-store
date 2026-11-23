// Registers the commands that list, create, localize, and delete App Store in-app events.

import type { Command } from '@/cli/command.js';
import {
  eventsCommandProgram,
  type CreateEventCommandInput,
  type LocalizeEventCommandInput,
} from './events-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the `events` command group to the program. */
export function registerEventsCommand(program: Command): void {
  const events = program
    .command('events')
    .description('read and manage App Store in-app events from the CLI');

  function runList(options: { app?: string; json?: boolean }) {
    const eventsProgram = eventsCommandProgram({
      operation: 'list',
      app: options.app,
      json: options.json == true,
    });

    return runCliProgram(eventsProgram);
  }

  events
    .command('list')
    .description("list an app's in-app events and their localizations")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action(runList);

  function runCreate(
    referenceName: string,
    options: Omit<CreateEventCommandInput, 'operation' | 'referenceName'>,
  ) {
    const eventsProgram = eventsCommandProgram({
      operation: 'create',
      referenceName,
      ...options,
    });

    return runCliProgram(eventsProgram);
  }

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
    .action(runCreate);

  function runLocalize(
    eventId: string,
    options: Omit<LocalizeEventCommandInput, 'operation' | 'eventId'>,
  ) {
    const eventsProgram = eventsCommandProgram({ operation: 'localize', eventId, ...options });
    return runCliProgram(eventsProgram);
  }

  events
    .command('localize')
    .description("set (or update) one locale's copy on an event")
    .argument('<eventId>', 'the event id from `events list`')
    .requiredOption('--locale <code>', 'the locale to set (e.g. en-US)')
    .option('--name <text>', 'the event name shown to users')
    .option('--short <text>', 'the short description')
    .option('--long <text>', 'the long description')
    .action(runLocalize);

  function runDelete(eventId: string, options: { yes?: boolean }) {
    const eventsProgram = eventsCommandProgram({
      operation: 'delete',
      eventId,
      yes: options.yes == true,
    });

    return runCliProgram(eventsProgram);
  }

  events
    .command('delete')
    .description('delete a draft in-app event')
    .argument('<eventId>', 'the event id from `events list`')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runDelete);
}
