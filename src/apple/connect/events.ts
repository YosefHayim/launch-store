import type {
  AppEventAttributes,
  AppEventLocalizationAttributes,
  ResourceSingle,
} from './shared.ts';
import type {
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  NewAppEvent,
} from '../../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import { readAppEvent, readAppEventLocalization } from './shared.ts';

export class ConnectEvents {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of in-app events for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appevents
   */
  async listAppEvents(appId: string): Promise<AppEventResource[]> {
    const appleResources = await this.client.requestAll<AppEventAttributes>(
      `/apps/${appId}/appEvents?limit=200&fields[appEvents]=referenceName,badge,eventState,primaryLocale,deepLink,priority,purpose`,
    );

    function mapAppleEvent(appleEvent: {
      id: string;
      attributes: AppEventAttributes;
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return readAppEvent(appleEvent, '');
    }

    return appleResources.map(mapAppleEvent);
  }

  /**
   * Get a list of all localizations for a specific in-app event.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appevents-_id_-localizations
   */
  async listAppEventLocalizations(eventId: string): Promise<AppEventLocalizationResource[]> {
    const appleResources = await this.client.requestAll<AppEventLocalizationAttributes>(
      `/appEvents/${eventId}/localizations?limit=200&fields[appEventLocalizations]=locale,name,shortDescription,longDescription`,
    );

    function mapLocalization(localization: {
      id: string;
      attributes: AppEventLocalizationAttributes;
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return readAppEventLocalization(localization, '');
    }

    return appleResources.map(mapLocalization);
  }

  /**
   * Create a new in-app event for your app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appevents
   */
  async createAppEvent(appId: string, attributes: NewAppEvent): Promise<AppEventResource> {
    const eventAttributes = { referenceName: attributes.referenceName };

    if (attributes.badge != null) Object.assign(eventAttributes, { badge: attributes.badge });

    if (attributes.primaryLocale != null)
      Object.assign(eventAttributes, { primaryLocale: attributes.primaryLocale });

    if (attributes.deepLink != null)
      Object.assign(eventAttributes, { deepLink: attributes.deepLink });

    if (attributes.priority != null)
      Object.assign(eventAttributes, { priority: attributes.priority });

    if (attributes.purpose != null) Object.assign(eventAttributes, { purpose: attributes.purpose });

    const appleResources = await this.client.createResource<AppEventAttributes>('/appEvents', {
      type: 'appEvents',
      attributes: eventAttributes,
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });

    return readAppEvent(appleResources, attributes.referenceName);
  }

  /**
   * Delete an in-app event and its related metadata.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appevents-_id_
   */
  async deleteAppEvent(eventId: string): Promise<void> {
    await this.client.deleteResource(`/appEvents/${eventId}`);
  }

  /**
   * Add a new localization for an in-app event.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appeventlocalizations
   */
  async createAppEventLocalization(
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const eventLocalizationAttributes = { locale };

    if (attributes.name != null)
      Object.assign(eventLocalizationAttributes, { name: attributes.name });

    if (attributes.shortDescription != null)
      Object.assign(eventLocalizationAttributes, { shortDescription: attributes.shortDescription });

    if (attributes.longDescription != null)
      Object.assign(eventLocalizationAttributes, { longDescription: attributes.longDescription });

    const appleResources = await this.client.createResource<AppEventLocalizationAttributes>(
      '/appEventLocalizations',
      {
        type: 'appEventLocalizations',
        attributes: eventLocalizationAttributes,
        relationships: { appEvent: { data: { type: 'appEvents', id: eventId } } },
      },
    );

    return readAppEventLocalization(appleResources, locale);
  }

  /**
   * Update the localized metadata for a specific in-app event.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appeventlocalizations-_id_
   */
  async updateAppEventLocalization(
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const eventLocalizationAttributes: AppEventLocalizationInput = {};

    if (attributes.name != null)
      Object.assign(eventLocalizationAttributes, { name: attributes.name });

    if (attributes.shortDescription != null)
      Object.assign(eventLocalizationAttributes, { shortDescription: attributes.shortDescription });

    if (attributes.longDescription != null)
      Object.assign(eventLocalizationAttributes, { longDescription: attributes.longDescription });

    const { data: appleResources } = await this.client.request<
      ResourceSingle<AppEventLocalizationAttributes>
    >('PATCH', `/appEventLocalizations/${localizationId}`, {
      data: {
        type: 'appEventLocalizations',
        id: localizationId,
        attributes: eventLocalizationAttributes,
      },
    });

    return readAppEventLocalization(appleResources, '');
  }
}
