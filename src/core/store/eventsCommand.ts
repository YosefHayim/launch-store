import { Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import {
  createEvent,
  deleteEvent,
  listEvents,
  localizeEvent,
  type AppEventWithLocalizations,
} from './appEvents.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import { resolveStoreBundleId, type StoreAppSelectionRequirements } from './selectStoreApp.js';

/** Options for creating a draft in-app event. */
export type CreateEventCommandInput = Readonly<{
  operation: 'create';
  referenceName: string;
  app?: string | undefined;
  badge?: string | undefined;
  locale?: string | undefined;
  deepLink?: string | undefined;
  priority?: string | undefined;
  purpose?: string | undefined;
}>;

/** Options for creating or updating one event localization. */
export type LocalizeEventCommandInput = Readonly<{
  operation: 'localize';
  eventId: string;
  locale: string;
  name?: string | undefined;
  short?: string | undefined;
  long?: string | undefined;
}>;

/** One in-app-events operation selected by Commander. */
export type EventsCommandInput =
  | Readonly<{ operation: 'list'; app?: string | undefined; json: boolean }>
  | CreateEventCommandInput
  | LocalizeEventCommandInput
  | Readonly<{ operation: 'delete'; eventId: string; yes: boolean }>;

/** An in-app-events command failed before it could complete. */
export type EventsCommandFailure = Readonly<{
  readonly _tag: 'EventsCommandFailure';
  readonly operation: EventsCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeEventsCommandFailure = Data.tagged<EventsCommandFailure>('EventsCommandFailure');

type EventsCommandRequirements =
  | ActiveAppleStoreRequirements
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert any dependency failure into the in-app-events command channel. */
const eventsFailure = (
  operation: EventsCommandInput['operation'],
  cause: unknown,
): EventsCommandFailure => {
  let message = `Events ${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeEventsCommandFailure({ operation, message, cause });
};

/** Render one event and its localizations as a readable text block. */
export const renderAppEvent = ({ event, localizations }: AppEventWithLocalizations): string => {
  const eventDetails = [event.badge, event.eventState].filter(
    (eventDetail): eventDetail is string => eventDetail !== undefined,
  );
  if (event.primaryLocale !== undefined) {
    eventDetails.push(`primary ${event.primaryLocale}`);
  }
  const eventLines = [`${event.id}  ${event.referenceName}`];
  if (eventDetails.length > 0) eventLines.push(`  ${eventDetails.join('  ')}`);
  if (event.deepLink !== undefined) eventLines.push(`  -> ${event.deepLink}`);
  for (const localization of localizations) {
    let localizedName = '(no name)';
    if (localization.name !== undefined) localizedName = localization.name;
    eventLines.push(`  [${localization.locale}] ${localizedName}`);
  }
  return eventLines.join('\n');
};

/** List the selected app's in-app events. */
const listEventsProgram = (
  commandInput: Extract<EventsCommandInput, { operation: 'list' }>,
): Effect.Effect<void, EventsCommandFailure, EventsCommandRequirements> =>
  Effect.gen(function* () {
    const bundleId = yield* resolveStoreBundleId(commandInput.app);
    const appleStore = yield* loadActiveAppleStore();
    const appEvents = yield* listEvents(appleStore, bundleId);
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger.line(JSON.stringify(appEvents, null, 2));
      return;
    }
    if (appEvents.length === 0) {
      yield* logger.line(
        'No in-app events yet. Create one with `launch events create <referenceName> --badge ...`.',
      );
      return;
    }
    yield* logger.line(appEvents.map(renderAppEvent).join('\n\n'));
    let eventSuffix = 's';
    if (appEvents.length === 1) eventSuffix = '';
    yield* logger.line(`\n${appEvents.length} event${eventSuffix}.`);
  }).pipe(Effect.mapError((cause) => eventsFailure('list', cause)));

/** Create one validated draft in-app event. */
const createEventProgram = (
  commandInput: CreateEventCommandInput,
): Effect.Effect<void, EventsCommandFailure, EventsCommandRequirements> =>
  Effect.gen(function* () {
    const bundleId = yield* resolveStoreBundleId(commandInput.app);
    const appleStore = yield* loadActiveAppleStore();
    const createdEvent = yield* createEvent(appleStore, bundleId, {
      referenceName: commandInput.referenceName,
      badge: commandInput.badge,
      primaryLocale: commandInput.locale,
      deepLink: commandInput.deepLink,
      priority: commandInput.priority,
      purpose: commandInput.purpose,
    });
    let eventState = 'DRAFT';
    if (createdEvent.eventState !== undefined) eventState = createdEvent.eventState;
    const logger = yield* createLogger(false);
    yield* logger.step(
      'event created',
      `${createdEvent.id} - ${createdEvent.referenceName} (${eventState})`,
    );
  }).pipe(Effect.mapError((cause) => eventsFailure('create', cause)));

/** Create or update one event localization. */
const localizeEventProgram = (
  commandInput: LocalizeEventCommandInput,
): Effect.Effect<void, EventsCommandFailure, EventsCommandRequirements> =>
  Effect.gen(function* () {
    const appleStore = yield* loadActiveAppleStore();
    const localizationOutcome = yield* localizeEvent(appleStore, commandInput.eventId, {
      locale: commandInput.locale,
      name: commandInput.name,
      shortDescription: commandInput.short,
      longDescription: commandInput.long,
    });
    let operationLabel = 'localization created';
    if (localizationOutcome.replaced) operationLabel = 'localization updated';
    const logger = yield* createLogger(false);
    yield* logger.step(
      operationLabel,
      `[${localizationOutcome.localization.locale}] ${commandInput.eventId}`,
    );
  }).pipe(Effect.mapError((cause) => eventsFailure('localize', cause)));

/** Confirm and delete one draft in-app event. */
const deleteEventProgram = (
  commandInput: Extract<EventsCommandInput, { operation: 'delete' }>,
): Effect.Effect<void, EventsCommandFailure, EventsCommandRequirements> =>
  Effect.gen(function* () {
    if (!commandInput.yes) {
      const terminal = yield* Terminal.Terminal;
      const terminalIsInteractive = yield* terminal.isTTY;
      if (!terminalIsInteractive) {
        return yield* Effect.fail(
          makeEventsCommandFailure({
            operation: 'delete',
            message:
              'Refusing to delete without confirmation. Re-run with --yes (non-interactive).',
            cause: 'confirmation-required',
          }),
        );
      }
      const prompt = yield* LaunchPrompt;
      const confirmed = yield* prompt.confirm(`Delete in-app event ${commandInput.eventId}?`);
      if (!confirmed) {
        yield* prompt.cancel('Aborted - nothing deleted.');
        return;
      }
    }
    const appleStore = yield* loadActiveAppleStore();
    yield* deleteEvent(appleStore, commandInput.eventId);
    const logger = yield* createLogger(false);
    yield* logger.step('event deleted', commandInput.eventId);
  }).pipe(Effect.mapError((cause) => eventsFailure('delete', cause)));

/** Run one in-app-events operation through the shared Effect runtime. */
export const eventsCommandProgram = (
  commandInput: EventsCommandInput,
): Effect.Effect<void, EventsCommandFailure, EventsCommandRequirements> => {
  switch (commandInput.operation) {
    case 'list':
      return listEventsProgram(commandInput);
    case 'create':
      return createEventProgram(commandInput);
    case 'localize':
      return localizeEventProgram(commandInput);
    case 'delete':
      return deleteEventProgram(commandInput);
  }
};
