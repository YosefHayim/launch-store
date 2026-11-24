// Lists, creates, localizes, and deletes in-app events on App Store Connect.

import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { AppEvents, type AppEventWithLocalizations } from './app-events.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { readStoreBundleId } from '../store/shared/select-store-app.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { redactText } from '../services/platform/redact.ts';

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
type EventsCommandInput =
  | Readonly<{ operation: 'list'; app?: string | undefined; json: boolean }>
  | CreateEventCommandInput
  | LocalizeEventCommandInput
  | Readonly<{ operation: 'delete'; eventId: string; yes: boolean }>;

function isPresentDetail(eventDetail: string | undefined): eventDetail is string {
  return eventDetail != null;
}

/** Render one event and its localizations as a readable text block. */
function renderAppEvent(appEvent: AppEventWithLocalizations): string {
  const event = appEvent.event;
  const localizations = appEvent.localizations;
  const eventDetails = [event.badge, event.eventState].filter(isPresentDetail);

  const hasPrimaryLocale = event.primaryLocale != null;

  if (hasPrimaryLocale) {
    eventDetails.push(`primary ${event.primaryLocale}`);
  }

  const eventLines = [`${event.id}  ${event.referenceName}`];

  const hasDetails = eventDetails.length > 0;

  if (hasDetails) {
    eventLines.push(`  ${eventDetails.join('  ')}`);
  }

  const hasDeepLink = event.deepLink != null;

  if (hasDeepLink) {
    eventLines.push(`  -> ${event.deepLink}`);
  }

  for (const localization of localizations) {
    let localizedName = '(no name)';

    const hasName = localization.name != null;

    if (hasName) {
      localizedName = localization.name;
    }

    eventLines.push(`  [${localization.locale}] ${localizedName}`);
  }

  return eventLines.join('\n');
}

function eventBlock(appEvent: AppEventWithLocalizations): string {
  return renderAppEvent(appEvent);
}

/** List the selected app's in-app events. */
async function listEventsProgram(
  commandInput: Extract<EventsCommandInput, { operation: 'list' }>,
): Promise<void> {
  try {
    const bundleId = await readStoreBundleId(commandInput.app);
    const appleStore = await loadActiveAppleStore();
    const events = new AppEvents(appleStore);
    const appEvents = await events.list(bundleId);
    const wantsJson = commandInput.json;

    if (wantsJson) {
      const serialized = JSON.stringify(appEvents, null, 2);
      console.log(redactText(serialized));
      return;
    }

    const isEmpty = appEvents.length == 0;

    if (isEmpty) {
      console.log(
        redactText(
          'No in-app events yet. Create one with `launch-store events create <referenceName> --badge ...`.',
        ),
      );
      return;
    }

    console.log(redactText(appEvents.map(eventBlock).join('\n\n')));

    let eventSuffix = 's';

    const isSingleEvent = appEvents.length == 1;

    if (isSingleEvent) {
      eventSuffix = '';
    }

    console.log(redactText(`\n${appEvents.length} event${eventSuffix}.`));
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Create one validated draft in-app event. */
async function createEventProgram(commandInput: CreateEventCommandInput): Promise<void> {
  try {
    const bundleId = await readStoreBundleId(commandInput.app);
    const appleStore = await loadActiveAppleStore();
    const events = new AppEvents(appleStore);
    const createdEvent = await events.create(bundleId, {
      referenceName: commandInput.referenceName,
      badge: commandInput.badge,
      primaryLocale: commandInput.locale,
      deepLink: commandInput.deepLink,
      priority: commandInput.priority,
      purpose: commandInput.purpose,
    });
    let eventState = 'DRAFT';

    const hasEventState = createdEvent.eventState != null;

    if (hasEventState) {
      eventState = createdEvent.eventState;
    }
    console.log(
      redactText(
        `event created - ${createdEvent.id} - ${createdEvent.referenceName} (${eventState})`,
      ),
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Create or update one event localization. */
async function localizeEventProgram(commandInput: LocalizeEventCommandInput): Promise<void> {
  try {
    const appleStore = await loadActiveAppleStore();
    const events = new AppEvents(appleStore);
    const localizationOutcome = await events.localize(commandInput.eventId, {
      locale: commandInput.locale,
      name: commandInput.name,
      shortDescription: commandInput.short,
      longDescription: commandInput.long,
    });
    let operationLabel = 'localization created';

    const replacedExisting = localizationOutcome.replaced;

    if (replacedExisting) {
      operationLabel = 'localization updated';
    }
    console.log(
      redactText(
        `${operationLabel} - [${localizationOutcome.localization.locale}] ${commandInput.eventId}`,
      ),
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Confirm and delete one draft in-app event. */
async function deleteEventProgram(
  commandInput: Extract<EventsCommandInput, { operation: 'delete' }>,
): Promise<void> {
  try {
    const skipConfirmation = commandInput.yes;
    const needsConfirmation = !skipConfirmation;

    if (needsConfirmation) {
      const terminalIsInteractive = checkTerminalIsInteractive();
      const needsATerminal = !terminalIsInteractive;

      if (needsATerminal) {
        throw new Error(
          'Refusing to delete without confirmation. Re-run with --yes (non-interactive).',
          { cause: 'confirmation-required' },
        );
      }

      const confirmed = await new LaunchPrompt().confirm(
        `Delete in-app event ${commandInput.eventId}?`,
      );

      const declined = !confirmed;

      if (declined) {
        new LaunchPrompt().cancel('Aborted - nothing deleted.');
        return;
      }
    }

    const appleStore = await loadActiveAppleStore();
    const events = new AppEvents(appleStore);

    await events.delete(commandInput.eventId);
    console.log(redactText(`event deleted - ${commandInput.eventId}`));
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Run one in-app-events operation. */
export async function eventsCommandProgram(commandInput: EventsCommandInput): Promise<void> {
  if (commandInput.operation == 'list') {
    await listEventsProgram(commandInput);
    return;
  }

  if (commandInput.operation == 'create') {
    await createEventProgram(commandInput);
    return;
  }

  if (commandInput.operation == 'localize') {
    await localizeEventProgram(commandInput);
    return;
  }

  await deleteEventProgram(commandInput);
}
