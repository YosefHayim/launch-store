import type {
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  NewAppEvent,
} from '@core/types/appleCatalog.js';
import type {
  AppStoreConnectRequests,
  ResourceSingle,
} from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-events-and-metadata
/** Apple's raw `appEvents` attribute bag. Optional draft fields come back as `null` until set. */
type AppEventAttributes = {
  referenceName?: string;
  badge?: string | null;
  eventState?: string;
  primaryLocale?: string | null;
  deepLink?: string | null;
  priority?: string | null;
  purpose?: string | null;
};
/** Apple's raw `appEventLocalizations` attribute bag. Unset copy comes back as `null`. */
type AppEventLocalizationAttributes = {
  locale?: string;
  name?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
};
/**
 * Project an ASC `appEvents` resource object into an AppEventResource. `fallbackReferenceName`
 * fills a missing `referenceName`: the requested name on create, the empty string on a list.
 */
const toAppEvent = (
  appleEvent: {
    id: string;
    attributes: AppEventAttributes;
  },
  fallbackReferenceName: string,
): AppEventResource => {
  let referenceName = appleEvent.attributes.referenceName;
  if (referenceName === undefined) referenceName = fallbackReferenceName;
  const appEvent: AppEventResource = { id: appleEvent.id, referenceName };
  if (typeof appleEvent.attributes.badge === 'string')
    Object.assign(appEvent, { badge: appleEvent.attributes.badge });
  if (appleEvent.attributes.eventState !== undefined)
    Object.assign(appEvent, { eventState: appleEvent.attributes.eventState });
  if (typeof appleEvent.attributes.primaryLocale === 'string')
    Object.assign(appEvent, { primaryLocale: appleEvent.attributes.primaryLocale });
  if (typeof appleEvent.attributes.deepLink === 'string')
    Object.assign(appEvent, { deepLink: appleEvent.attributes.deepLink });
  if (typeof appleEvent.attributes.priority === 'string')
    Object.assign(appEvent, { priority: appleEvent.attributes.priority });
  if (typeof appleEvent.attributes.purpose === 'string')
    Object.assign(appEvent, { purpose: appleEvent.attributes.purpose });
  return appEvent;
};
/**
 * Project an ASC `appEventLocalizations` resource object into an AppEventLocalizationResource.
 * `fallbackLocale` supplies the locale on a PATCH response (Apple's update payload omits the unchanged
 * `locale`); it's the empty string when the caller doesn't need it (the create path passes the locale).
 */
const toAppEventLocalization = (
  appleResources: {
    id: string;
    attributes: AppEventLocalizationAttributes;
  },
  fallbackLocale: string,
): AppEventLocalizationResource => {
  let locale = appleResources.attributes.locale;
  if (locale === undefined) locale = fallbackLocale;
  const eventLocalization: AppEventLocalizationResource = {
    id: appleResources.id,
    locale,
  };
  if (typeof appleResources.attributes.name === 'string')
    Object.assign(eventLocalization, { name: appleResources.attributes.name });
  if (typeof appleResources.attributes.shortDescription === 'string')
    Object.assign(eventLocalization, {
      shortDescription: appleResources.attributes.shortDescription,
    });
  if (typeof appleResources.attributes.longDescription === 'string')
    Object.assign(eventLocalization, {
      longDescription: appleResources.attributes.longDescription,
    });
  return eventLocalization;
};
export const makeAppEventsApi = (api: AppStoreConnectRequests) => {
  /** List an app's in-app events (newest lifecycle first is not guaranteed; Apple returns creation order). */
  const listAppEvents = async (appId: string): Promise<AppEventResource[]> => {
    const appleResources = await api.requestAll<AppEventAttributes>(
      `/apps/${appId}/appEvents?limit=200&fields[appEvents]=referenceName,badge,eventState,primaryLocale,deepLink,priority,purpose`,
    );
    return appleResources.map((appleEvent) => toAppEvent(appleEvent, ''));
  };
  /** List one event's localizations (per-locale name + descriptions). */
  const listAppEventLocalizations = async (
    eventId: string,
  ): Promise<AppEventLocalizationResource[]> => {
    const appleResources = await api.requestAll<AppEventLocalizationAttributes>(
      `/appEvents/${eventId}/localizations?limit=200&fields[appEventLocalizations]=locale,name,shortDescription,longDescription`,
    );
    return appleResources.map((localization) => toAppEventLocalization(localization, ''));
  };
  /** Create a draft in-app event for an app, returning the created event. */
  const createAppEvent = async (
    appId: string,
    attributes: NewAppEvent,
  ): Promise<AppEventResource> => {
    const eventAttributes = { referenceName: attributes.referenceName };
    if (attributes.badge !== undefined) Object.assign(eventAttributes, { badge: attributes.badge });
    if (attributes.primaryLocale !== undefined)
      Object.assign(eventAttributes, { primaryLocale: attributes.primaryLocale });
    if (attributes.deepLink !== undefined)
      Object.assign(eventAttributes, { deepLink: attributes.deepLink });
    if (attributes.priority !== undefined)
      Object.assign(eventAttributes, { priority: attributes.priority });
    if (attributes.purpose !== undefined)
      Object.assign(eventAttributes, { purpose: attributes.purpose });
    const appleResources = await api.createResource<AppEventAttributes>('/appEvents', {
      type: 'appEvents',
      attributes: eventAttributes,
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return toAppEvent(appleResources, attributes.referenceName);
  };
  /** Delete an in-app event by id (only a DRAFT event can be deleted). */
  const deleteAppEvent = async (eventId: string): Promise<void> => {
    await api.deleteResource(`/appEvents/${eventId}`);
  };
  /** Create a localization (locale + copy) for an event, returning the created localization. */
  const createAppEventLocalization = async (
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> => {
    const eventLocalizationAttributes = { locale };
    if (attributes.name !== undefined)
      Object.assign(eventLocalizationAttributes, { name: attributes.name });
    if (attributes.shortDescription !== undefined)
      Object.assign(eventLocalizationAttributes, { shortDescription: attributes.shortDescription });
    if (attributes.longDescription !== undefined)
      Object.assign(eventLocalizationAttributes, { longDescription: attributes.longDescription });
    const appleResources = await api.createResource<AppEventLocalizationAttributes>(
      '/appEventLocalizations',
      {
        type: 'appEventLocalizations',
        attributes: eventLocalizationAttributes,
        relationships: { appEvent: { data: { type: 'appEvents', id: eventId } } },
      },
    );
    return toAppEventLocalization(appleResources, locale);
  };
  /** Update an existing event localization's copy by its id, returning the updated localization. */
  const updateAppEventLocalization = async (
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> => {
    const eventLocalizationAttributes: AppEventLocalizationInput = {};
    if (attributes.name !== undefined)
      Object.assign(eventLocalizationAttributes, { name: attributes.name });
    if (attributes.shortDescription !== undefined)
      Object.assign(eventLocalizationAttributes, { shortDescription: attributes.shortDescription });
    if (attributes.longDescription !== undefined)
      Object.assign(eventLocalizationAttributes, { longDescription: attributes.longDescription });
    const { data: appleResources } = await api.request<
      ResourceSingle<AppEventLocalizationAttributes>
    >('PATCH', `/appEventLocalizations/${localizationId}`, {
      data: {
        type: 'appEventLocalizations',
        id: localizationId,
        attributes: eventLocalizationAttributes,
      },
    });
    return toAppEventLocalization(appleResources, '');
  };

  return {
    listAppEvents,
    listAppEventLocalizations,
    createAppEvent,
    deleteAppEvent,
    createAppEventLocalization,
    updateAppEventLocalization,
  };
};
