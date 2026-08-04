import type { Command } from 'commander';
import {
  eventsCommandProgram,
  type CreateEventCommandInput,
  type LocalizeEventCommandInput,
} from '@core/store/eventsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `events` command group to the program. */
export const registerEventsCommand = (program: Command): void => {
  const events = program
    .command('events')
    .description('read and manage App Store in-app events from the CLI');
  events
    .command('list')
    .description("list an app's in-app events and their localizations")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action((options: { app?: string; json?: boolean }) => {
      return runCliProgram(
        eventsCommandProgram({
          operation: 'list',
          app: options.app,
          json: options.json === true,
        }),
      );
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
    .action(
      (
        referenceName: string,
        options: Omit<CreateEventCommandInput, 'operation' | 'referenceName'>,
      ) => {
        return runCliProgram(
          eventsCommandProgram({ operation: 'create', referenceName, ...options }),
        );
      },
    );
  events
    .command('localize')
    .description("set (or update) one locale's copy on an event")
    .argument('<eventId>', 'the event id from `events list`')
    .requiredOption('--locale <code>', 'the locale to set (e.g. en-US)')
    .option('--name <text>', 'the event name shown to users')
    .option('--short <text>', 'the short description')
    .option('--long <text>', 'the long description')
    .action(
      (eventId: string, options: Omit<LocalizeEventCommandInput, 'operation' | 'eventId'>) => {
        return runCliProgram(eventsCommandProgram({ operation: 'localize', eventId, ...options }));
      },
    );
  events
    .command('delete')
    .description('delete a draft in-app event')
    .argument('<eventId>', 'the event id from `events list`')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((eventId: string, options: { yes?: boolean }) => {
      return runCliProgram(
        eventsCommandProgram({ operation: 'delete', eventId, yes: options.yes === true }),
      );
    });
};
