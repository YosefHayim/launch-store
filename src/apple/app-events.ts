// Lists, creates, localizes, and deletes in-app events on App Store Connect.

import type { MutableDeep } from '../types/mutable.ts';
import type {
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  NewAppEvent,
} from '../types/apple-catalog.ts';
import { hasMessage } from '../services/platform/error-message.ts';

/** The App Store transport operations required by the in-app-events domain. */
export type AscAppEventsApi = Readonly<{
  getAppId: (bundleId: string) => Promise<string | null>;
  listAppEvents: (appId: string) => Promise<AppEventResource[]>;
  listAppEventLocalizations: (eventId: string) => Promise<AppEventLocalizationResource[]>;
  createAppEvent: (appId: string, attributes: NewAppEvent) => Promise<AppEventResource>;
  deleteAppEvent: (eventId: string) => Promise<void>;
  createAppEventLocalization: (
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ) => Promise<AppEventLocalizationResource>;
  updateAppEventLocalization: (
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ) => Promise<AppEventLocalizationResource>;
}>;

/** One event paired with its localizations. */
export type AppEventWithLocalizations = Readonly<{
  event: AppEventResource;
  localizations: readonly AppEventLocalizationResource[];
}>;

/** Input for creating a draft in-app event. */
type CreateEventRequest = Readonly<{
  referenceName: string;
  badge?: string | undefined;
  primaryLocale?: string | undefined;
  deepLink?: string | undefined;
  priority?: string | undefined;
  purpose?: string | undefined;
}>;

/** Input for creating or updating one event localization. */
type LocalizeEventRequest = Readonly<{
  locale: string;
  name?: string | undefined;
  shortDescription?: string | undefined;
  longDescription?: string | undefined;
}>;

/** The stored localization and whether existing copy was replaced. */
type LocalizeResult = Readonly<{
  localization: AppEventLocalizationResource;
  replaced: boolean;
}>;

/** Convert a transport failure into an Error. */
function appEventFailure(operation: string, cause: unknown): never {
  const hasCauseMessage = hasMessage(cause);

  if (hasCauseMessage) {
    throw new Error(cause.message, { cause });
  }

  throw new Error(`${operation} failed.`, { cause });
}

/** Run one transport call in the in-app-event error channel. */
async function runEventRequest<Success>(
  operation: string,
  request: Promise<Success>,
): Promise<Success> {
  try {
    return await request;
  } catch (cause) {
    throw appEventFailure(operation, cause);
  }
}

/** Throw the missing-App-Store-record failure shared by list and create. */
function missingAppRecord(bundleId: string): never {
  throw new Error(
    `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this ` +
      'account can access the app.',
    { cause: bundleId },
  );
}

/** Validate and normalize an optional Apple enum attribute. */
function validateEventEnum(
  field: string,
  fieldText: string | undefined,
  allowedValues: readonly string[],
): string | undefined {
  const isFieldMissing = fieldText == null;

  if (isFieldMissing) {
    return undefined;
  }

  const normalizedField = fieldText.trim().toUpperCase();

  const isAllowed = allowedValues.includes(normalizedField);

  if (isAllowed) {
    return normalizedField;
  }

  throw new Error(
    `Invalid ${field} "${fieldText}". Valid ${field}s: ${allowedValues.join(', ')}.`,
    {
      cause: fieldText,
    },
  );
}

/** Lists, creates, localizes, and deletes in-app events for one app. */
export class AppEvents {
  constructor(private readonly appEventsStore: AscAppEventsApi) {}

  /** List an app's in-app events with their localizations. */
  async list(bundleId: string): Promise<readonly AppEventWithLocalizations[]> {
    const appId = await runEventRequest(
      'resolve App Store app',
      this.appEventsStore.getAppId(bundleId),
    );

    const isAppMissing = appId == null;

    if (isAppMissing) {
      throw missingAppRecord(bundleId);
    }

    const appEventsStore = this.appEventsStore;
    const appEvents = await runEventRequest(
      'list in-app events',
      appEventsStore.listAppEvents(appId),
    );

    async function attachLocalizations(
      appEvent: AppEventResource,
    ): Promise<AppEventWithLocalizations> {
      const localizations = await runEventRequest(
        'list event localizations',
        appEventsStore.listAppEventLocalizations(appEvent.id),
      );

      return { event: appEvent, localizations };
    }

    return Promise.all(appEvents.map(attachLocalizations));
  }

  /** Create a validated draft in-app event. */
  async create(bundleId: string, eventRequest: CreateEventRequest): Promise<AppEventResource> {
    const referenceName = eventRequest.referenceName.trim();

    const isReferenceNameMissing = referenceName.length == 0;

    if (isReferenceNameMissing) {
      throw new Error('A reference name is required to create an in-app event.', {
        cause: eventRequest.referenceName,
      });
    }

    const badge = validateEventEnum('badge', eventRequest.badge, [
      'LIVE_EVENT',
      'PREMIERE',
      'CHALLENGE',
      'COMPETITION',
      'NEW_SEASON',
      'MAJOR_UPDATE',
      'SPECIAL_EVENT',
    ]);
    const priority = validateEventEnum('priority', eventRequest.priority, ['HIGH', 'NORMAL']);
    const purpose = validateEventEnum('purpose', eventRequest.purpose, [
      'APPROPRIATE_FOR_ALL_USERS',
      'ATTRACT_NEW_USERS',
      'KEEP_ACTIVE_USERS_INFORMED',
      'BRING_BACK_LAPSED_USERS',
    ]);
    const appId = await runEventRequest(
      'resolve App Store app',
      this.appEventsStore.getAppId(bundleId),
    );

    const isAppMissing = appId == null;

    if (isAppMissing) {
      throw missingAppRecord(bundleId);
    }

    const eventAttributes: MutableDeep<NewAppEvent> = { referenceName };

    if (badge != null) eventAttributes.badge = badge;

    if (eventRequest.primaryLocale != null) {
      eventAttributes.primaryLocale = eventRequest.primaryLocale.trim();
    }

    if (eventRequest.deepLink != null) {
      eventAttributes.deepLink = eventRequest.deepLink.trim();
    }

    if (priority != null) eventAttributes.priority = priority;

    if (purpose != null) eventAttributes.purpose = purpose;

    return runEventRequest(
      'create in-app event',
      this.appEventsStore.createAppEvent(appId, eventAttributes),
    );
  }

  /** Create or update one locale's event copy. */
  async localize(
    eventId: string,
    localizationRequest: LocalizeEventRequest,
  ): Promise<LocalizeResult> {
    const locale = localizationRequest.locale.trim();

    const isLocaleMissing = locale.length == 0;

    if (isLocaleMissing) {
      throw new Error('A locale is required to localize an in-app event.', {
        cause: localizationRequest.locale,
      });
    }

    const localizationAttributes: MutableDeep<AppEventLocalizationInput> = {};

    if (localizationRequest.name != null) {
      localizationAttributes.name = localizationRequest.name;
    }

    if (localizationRequest.shortDescription != null) {
      localizationAttributes.shortDescription = localizationRequest.shortDescription;
    }

    if (localizationRequest.longDescription != null) {
      localizationAttributes.longDescription = localizationRequest.longDescription;
    }

    const hasNoCopy = Object.keys(localizationAttributes).length == 0;

    if (hasNoCopy) {
      throw new Error('Provide at least one of --name, --short, or --long to localize the event.', {
        cause: localizationRequest,
      });
    }

    const localizations = await runEventRequest(
      'list event localizations',
      this.appEventsStore.listAppEventLocalizations(eventId),
    );

    function localizationMatchesLocale(localization: AppEventLocalizationResource): boolean {
      return localization.locale.toLowerCase() == locale.toLowerCase();
    }

    const existingLocalization = localizations.find(localizationMatchesLocale);

    const hasExistingLocalization = existingLocalization != null;

    if (hasExistingLocalization) {
      const storedLocalization = await runEventRequest(
        'update event localization',
        this.appEventsStore.updateAppEventLocalization(
          existingLocalization.id,
          localizationAttributes,
        ),
      );

      return {
        localization: { ...storedLocalization, locale: existingLocalization.locale },
        replaced: true,
      };
    }

    const storedLocalization = await runEventRequest(
      'create event localization',
      this.appEventsStore.createAppEventLocalization(eventId, locale, localizationAttributes),
    );

    return { localization: storedLocalization, replaced: false };
  }

  /** Delete a draft in-app event by its App Store resource id. */
  delete(eventId: string): Promise<void> {
    return runEventRequest('delete in-app event', this.appEventsStore.deleteAppEvent(eventId));
  }
}
