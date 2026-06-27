/**
 * The `launch events` domain: read an app's **in-app events**, create a draft event, manage its localized
 * copy, and delete a draft — all through the App Store Connect API key (no portal session). In-app events
 * are App Store product-page happenings (live events, premieres, challenges, …); EAS has no equivalent.
 *
 * Scope (deliberately bounded — this is a niche slice of #54): the **event records and their localizations**.
 * Territory scheduling, event screenshots/video clips, and submitting an event for review are out of scope
 * here — submission in particular routes through the shared `reviewSubmissions` machinery and would
 * duplicate the release flow. A created event is a DRAFT the developer schedules + submits in App Store
 * Connect (or via a future slice).
 *
 * Design (mirrors `core/reviews.ts` / `core/team.ts`): the {@link AscAppEventsApi} slice names the exact
 * client surface this module needs, so the logic is unit-testable with a hand-rolled fake and
 * `AppStoreConnectClient` satisfies it structurally. Enum-valued attributes (badge, priority, purpose) are
 * validated up front so a typo gets the valid list instead of Apple's opaque 4xx.
 */

import type {
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  NewAppEvent,
} from '../apple/ascClient.js';
import { appRecordNotFound } from './asc/storeSync.js';

/** The exact slice of {@link AppStoreConnectClient} the in-app-events domain depends on. */
export interface AscAppEventsApi {
  getAppId(bundleId: string): Promise<string | null>;
  listAppEvents(appId: string): Promise<AppEventResource[]>;
  listAppEventLocalizations(eventId: string): Promise<AppEventLocalizationResource[]>;
  createAppEvent(appId: string, attributes: NewAppEvent): Promise<AppEventResource>;
  deleteAppEvent(eventId: string): Promise<void>;
  createAppEventLocalization(
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource>;
  updateAppEventLocalization(
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource>;
}

/** Apple's in-app-event badges (`AppEventBadge`). Validated before create so a typo fails fast. */
export const APP_EVENT_BADGES: readonly string[] = [
  'LIVE_EVENT',
  'PREMIERE',
  'CHALLENGE',
  'COMPETITION',
  'NEW_SEASON',
  'MAJOR_UPDATE',
  'SPECIAL_EVENT',
];

/** How prominently Apple may feature an event (`AppEventPriority`). */
export const APP_EVENT_PRIORITIES: readonly string[] = ['HIGH', 'NORMAL'];

/** An event's marketing purpose (`AppEventPurpose`). */
export const APP_EVENT_PURPOSES: readonly string[] = [
  'APPROPRIATE_FOR_ALL_USERS',
  'ATTRACT_NEW_USERS',
  'KEEP_ACTIVE_USERS_INFORMED',
  'BRING_BACK_LAPSED_USERS',
];

/** One event paired with its localizations — what `launch events list` renders. */
export interface AppEventWithLocalizations {
  event: AppEventResource;
  localizations: AppEventLocalizationResource[];
}

/** CLI-facing request to create a draft event; enum fields are validated by {@link createEvent}. */
export interface CreateEventRequest {
  referenceName: string;
  badge?: string;
  primaryLocale?: string;
  deepLink?: string;
  priority?: string;
  purpose?: string;
}

/** CLI-facing request to set one locale's copy on an event. */
export interface LocalizeEventRequest {
  locale: string;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
}

/** Outcome of {@link localizeEvent}: the stored localization and whether it replaced existing copy. */
export interface LocalizeResult {
  localization: AppEventLocalizationResource;
  /** True when a localization for the locale already existed and this call updated it (vs. created). */
  replaced: boolean;
}

/** Validate an optional enum attribute, returning the canonical (upper-cased) value or undefined when unset. */
function validateEnum(
  field: string,
  value: string | undefined,
  allowed: readonly string[],
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toUpperCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid ${field} "${value}". Valid ${field}s: ${allowed.join(', ')}.`);
  }
  return normalized;
}

/**
 * List an app's in-app events, each paired with its localizations. Resolves the ASC app record from the
 * bundle id first, throwing an actionable error when none exists.
 */
export async function listEvents(
  api: AscAppEventsApi,
  bundleId: string,
): Promise<AppEventWithLocalizations[]> {
  const appId = await api.getAppId(bundleId);
  if (!appId) throw appRecordNotFound(bundleId);

  const events = await api.listAppEvents(appId);
  return Promise.all(
    events.map(async (event) => ({
      event,
      localizations: await api.listAppEventLocalizations(event.id),
    })),
  );
}

/**
 * Create a draft in-app event. Validates the reference name and the enum attributes (badge/priority/purpose)
 * before resolving the app record and creating the event.
 */
export async function createEvent(
  api: AscAppEventsApi,
  bundleId: string,
  request: CreateEventRequest,
): Promise<AppEventResource> {
  const referenceName = request.referenceName.trim();
  if (!referenceName) throw new Error('A reference name is required to create an in-app event.');

  const badge = validateEnum('badge', request.badge, APP_EVENT_BADGES);
  const priority = validateEnum('priority', request.priority, APP_EVENT_PRIORITIES);
  const purpose = validateEnum('purpose', request.purpose, APP_EVENT_PURPOSES);

  const appId = await api.getAppId(bundleId);
  if (!appId) throw appRecordNotFound(bundleId);

  return api.createAppEvent(appId, {
    referenceName,
    ...(badge ? { badge } : {}),
    ...(request.primaryLocale ? { primaryLocale: request.primaryLocale.trim() } : {}),
    ...(request.deepLink ? { deepLink: request.deepLink.trim() } : {}),
    ...(priority ? { priority } : {}),
    ...(purpose ? { purpose } : {}),
  });
}

/**
 * Set one locale's copy on an event — an upsert: update the existing localization for the locale, or create
 * one when none exists. Requires at least one copy field. Reports `replaced` so the command can say whether
 * it overwrote existing copy.
 */
export async function localizeEvent(
  api: AscAppEventsApi,
  eventId: string,
  request: LocalizeEventRequest,
): Promise<LocalizeResult> {
  const locale = request.locale.trim();
  if (!locale) throw new Error('A locale is required to localize an in-app event.');

  const attributes: AppEventLocalizationInput = {};
  if (request.name !== undefined) attributes.name = request.name;
  if (request.shortDescription !== undefined)
    attributes.shortDescription = request.shortDescription;
  if (request.longDescription !== undefined) attributes.longDescription = request.longDescription;
  if (Object.keys(attributes).length === 0) {
    throw new Error('Provide at least one of --name, --short, or --long to localize the event.');
  }

  const existing = (await api.listAppEventLocalizations(eventId)).find(
    (localization) => localization.locale.toLowerCase() === locale.toLowerCase(),
  );
  if (existing) {
    const localization = await api.updateAppEventLocalization(existing.id, attributes);
    // PATCH omits the unchanged locale; carry the known one through so callers always have it.
    return { localization: { ...localization, locale: existing.locale }, replaced: true };
  }

  const localization = await api.createAppEventLocalization(eventId, locale, attributes);
  return { localization, replaced: false };
}

/** Delete a draft in-app event by id. */
export async function deleteEvent(api: AscAppEventsApi, eventId: string): Promise<void> {
  await api.deleteAppEvent(eventId);
}
