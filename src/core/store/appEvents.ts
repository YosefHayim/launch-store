import { Data, Effect } from 'effect';
import type { MutableDeep } from '../types/mutable.js';
import type {
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  NewAppEvent,
} from '../types/appleCatalog.js';

/** The App Store transport operations required by the in-app-events domain. */
export type AscAppEventsApi = Readonly<{
  getAppId: (bundleId: string) => Effect.Effect<string | null, unknown>;
  listAppEvents: (appId: string) => Effect.Effect<AppEventResource[], unknown>;
  listAppEventLocalizations: (
    eventId: string,
  ) => Effect.Effect<AppEventLocalizationResource[], unknown>;
  createAppEvent: (
    appId: string,
    attributes: NewAppEvent,
  ) => Effect.Effect<AppEventResource, unknown>;
  deleteAppEvent: (eventId: string) => Effect.Effect<void, unknown>;
  createAppEventLocalization: (
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ) => Effect.Effect<AppEventLocalizationResource, unknown>;
  updateAppEventLocalization: (
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ) => Effect.Effect<AppEventLocalizationResource, unknown>;
}>;

/** An in-app-event request or validation step failed. */
export type AppEventFailure = Readonly<{
  readonly _tag: 'AppEventFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeAppEventFailure = Data.tagged<AppEventFailure>('AppEventFailure');

/** Apple's in-app-event badges. */
export const APP_EVENT_BADGES: readonly string[] = [
  'LIVE_EVENT',
  'PREMIERE',
  'CHALLENGE',
  'COMPETITION',
  'NEW_SEASON',
  'MAJOR_UPDATE',
  'SPECIAL_EVENT',
];

/** How prominently Apple may feature an event. */
export const APP_EVENT_PRIORITIES: readonly string[] = ['HIGH', 'NORMAL'];

/** The supported marketing purposes for an event. */
export const APP_EVENT_PURPOSES: readonly string[] = [
  'APPROPRIATE_FOR_ALL_USERS',
  'ATTRACT_NEW_USERS',
  'KEEP_ACTIVE_USERS_INFORMED',
  'BRING_BACK_LAPSED_USERS',
];

/** One event paired with its localizations. */
export type AppEventWithLocalizations = Readonly<{
  event: AppEventResource;
  localizations: readonly AppEventLocalizationResource[];
}>;

/** Input for creating a draft in-app event. */
export type CreateEventRequest = Readonly<{
  referenceName: string;
  badge?: string | undefined;
  primaryLocale?: string | undefined;
  deepLink?: string | undefined;
  priority?: string | undefined;
  purpose?: string | undefined;
}>;

/** Input for creating or updating one event localization. */
export type LocalizeEventRequest = Readonly<{
  locale: string;
  name?: string | undefined;
  shortDescription?: string | undefined;
  longDescription?: string | undefined;
}>;

/** The stored localization and whether existing copy was replaced. */
export type LocalizeResult = Readonly<{
  localization: AppEventLocalizationResource;
  replaced: boolean;
}>;

/** Convert a transport failure into the in-app-event error channel. */
const appEventFailure = (operation: string, cause: unknown): AppEventFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeAppEventFailure({ operation, message, cause });
};

/** Run one transport call in the in-app-event error channel. */
const runEventRequest = <Success>(
  operation: string,
  requestEffect: Effect.Effect<Success, unknown>,
): Effect.Effect<Success, AppEventFailure> =>
  requestEffect.pipe(Effect.mapError((cause) => appEventFailure(operation, cause)));

/** Build the missing-App-Store-record failure shared by list and create. */
const missingAppRecord = (bundleId: string): AppEventFailure =>
  makeAppEventFailure({
    operation: 'resolve App Store app',
    message:
      `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this ` +
      'account can access the app.',
    cause: bundleId,
  });

/** Validate and normalize an optional Apple enum attribute. */
const validateEventEnum = (
  field: string,
  fieldText: string | undefined,
  allowedValues: readonly string[],
): Effect.Effect<string | undefined, AppEventFailure> => {
  if (fieldText === undefined) return Effect.succeed(undefined);
  const normalizedField = fieldText.trim().toUpperCase();
  if (allowedValues.includes(normalizedField)) return Effect.succeed(normalizedField);
  return Effect.fail(
    makeAppEventFailure({
      operation: `validate ${field}`,
      message: `Invalid ${field} "${fieldText}". Valid ${field}s: ${allowedValues.join(', ')}.`,
      cause: fieldText,
    }),
  );
};

/** List an app's in-app events with their localizations. */
export const listEvents = (
  appEventsStore: AscAppEventsApi,
  bundleId: string,
): Effect.Effect<readonly AppEventWithLocalizations[], AppEventFailure> =>
  Effect.gen(function* () {
    const appId = yield* runEventRequest(
      'resolve App Store app',
      appEventsStore.getAppId(bundleId),
    );
    if (appId === null) return yield* Effect.fail(missingAppRecord(bundleId));
    const appEvents = yield* runEventRequest(
      'list in-app events',
      appEventsStore.listAppEvents(appId),
    );
    return yield* Effect.forEach(
      appEvents,
      (appEvent) =>
        runEventRequest(
          'list event localizations',
          appEventsStore.listAppEventLocalizations(appEvent.id),
        ).pipe(Effect.map((localizations) => ({ event: appEvent, localizations }))),
      { concurrency: 'unbounded' },
    );
  });

/** Create a validated draft in-app event. */
export const createEvent = (
  appEventsStore: AscAppEventsApi,
  bundleId: string,
  eventRequest: CreateEventRequest,
): Effect.Effect<AppEventResource, AppEventFailure> =>
  Effect.gen(function* () {
    const referenceName = eventRequest.referenceName.trim();
    if (referenceName.length === 0) {
      return yield* Effect.fail(
        makeAppEventFailure({
          operation: 'validate reference name',
          message: 'A reference name is required to create an in-app event.',
          cause: eventRequest.referenceName,
        }),
      );
    }
    const badge = yield* validateEventEnum('badge', eventRequest.badge, APP_EVENT_BADGES);
    const priority = yield* validateEventEnum(
      'priority',
      eventRequest.priority,
      APP_EVENT_PRIORITIES,
    );
    const purpose = yield* validateEventEnum('purpose', eventRequest.purpose, APP_EVENT_PURPOSES);
    const appId = yield* runEventRequest(
      'resolve App Store app',
      appEventsStore.getAppId(bundleId),
    );
    if (appId === null) return yield* Effect.fail(missingAppRecord(bundleId));
    const eventAttributes: MutableDeep<NewAppEvent> = { referenceName };
    if (badge !== undefined) eventAttributes.badge = badge;
    if (eventRequest.primaryLocale !== undefined) {
      eventAttributes.primaryLocale = eventRequest.primaryLocale.trim();
    }
    if (eventRequest.deepLink !== undefined) {
      eventAttributes.deepLink = eventRequest.deepLink.trim();
    }
    if (priority !== undefined) eventAttributes.priority = priority;
    if (purpose !== undefined) eventAttributes.purpose = purpose;
    return yield* runEventRequest(
      'create in-app event',
      appEventsStore.createAppEvent(appId, eventAttributes),
    );
  });

/** Create or update one locale's event copy. */
export const localizeEvent = (
  appEventsStore: AscAppEventsApi,
  eventId: string,
  localizationRequest: LocalizeEventRequest,
): Effect.Effect<LocalizeResult, AppEventFailure> =>
  Effect.gen(function* () {
    const locale = localizationRequest.locale.trim();
    if (locale.length === 0) {
      return yield* Effect.fail(
        makeAppEventFailure({
          operation: 'validate event locale',
          message: 'A locale is required to localize an in-app event.',
          cause: localizationRequest.locale,
        }),
      );
    }
    const localizationAttributes: MutableDeep<AppEventLocalizationInput> = {};
    if (localizationRequest.name !== undefined) {
      localizationAttributes.name = localizationRequest.name;
    }
    if (localizationRequest.shortDescription !== undefined) {
      localizationAttributes.shortDescription = localizationRequest.shortDescription;
    }
    if (localizationRequest.longDescription !== undefined) {
      localizationAttributes.longDescription = localizationRequest.longDescription;
    }
    if (Object.keys(localizationAttributes).length === 0) {
      return yield* Effect.fail(
        makeAppEventFailure({
          operation: 'validate event localization',
          message: 'Provide at least one of --name, --short, or --long to localize the event.',
          cause: localizationRequest,
        }),
      );
    }
    const localizations = yield* runEventRequest(
      'list event localizations',
      appEventsStore.listAppEventLocalizations(eventId),
    );
    const existingLocalization = localizations.find(
      (localization) => localization.locale.toLowerCase() === locale.toLowerCase(),
    );
    if (existingLocalization !== undefined) {
      const storedLocalization = yield* runEventRequest(
        'update event localization',
        appEventsStore.updateAppEventLocalization(existingLocalization.id, localizationAttributes),
      );
      return {
        localization: { ...storedLocalization, locale: existingLocalization.locale },
        replaced: true,
      };
    }
    const storedLocalization = yield* runEventRequest(
      'create event localization',
      appEventsStore.createAppEventLocalization(eventId, locale, localizationAttributes),
    );
    return { localization: storedLocalization, replaced: false };
  });

/** Delete a draft in-app event by its App Store resource id. */
export const deleteEvent = (
  appEventsStore: AscAppEventsApi,
  eventId: string,
): Effect.Effect<void, AppEventFailure> =>
  runEventRequest('delete in-app event', appEventsStore.deleteAppEvent(eventId));
