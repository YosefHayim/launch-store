import type {
  AppEventAttributes,
  AppEventLocalizationAttributes,
  ResourceSingle,
} from './shared.js';
import type {
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  NewAppEvent,
} from '@/types/appleCatalog.js';
import type { AscHost } from './host.js';
import { toAppEvent, toAppEventLocalization } from './shared.js';

export class ConnectEvents {
  constructor(private readonly client: AscHost) {}

  async listAppEvents(appId: string): Promise<AppEventResource[]> {
    const appleResources = await this.client.requestAll<AppEventAttributes>(
      `/apps/${appId}/appEvents?limit=200&fields[appEvents]=referenceName,badge,eventState,primaryLocale,deepLink,priority,purpose`,
    );
    return appleResources.map((appleEvent) => toAppEvent(appleEvent, ''));
  }

  async listAppEventLocalizations(eventId: string): Promise<AppEventLocalizationResource[]> {
    const appleResources = await this.client.requestAll<AppEventLocalizationAttributes>(
      `/appEvents/${eventId}/localizations?limit=200&fields[appEventLocalizations]=locale,name,shortDescription,longDescription`,
    );
    return appleResources.map((localization) => toAppEventLocalization(localization, ''));
  }

  async createAppEvent(appId: string, attributes: NewAppEvent): Promise<AppEventResource> {
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
    const appleResources = await this.client.createResource<AppEventAttributes>('/appEvents', {
      type: 'appEvents',
      attributes: eventAttributes,
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return toAppEvent(appleResources, attributes.referenceName);
  }

  async deleteAppEvent(eventId: string): Promise<void> {
    await this.client.deleteResource(`/appEvents/${eventId}`);
  }

  async createAppEventLocalization(
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const eventLocalizationAttributes = { locale };
    if (attributes.name !== undefined)
      Object.assign(eventLocalizationAttributes, { name: attributes.name });
    if (attributes.shortDescription !== undefined)
      Object.assign(eventLocalizationAttributes, { shortDescription: attributes.shortDescription });
    if (attributes.longDescription !== undefined)
      Object.assign(eventLocalizationAttributes, { longDescription: attributes.longDescription });
    const appleResources = await this.client.createResource<AppEventLocalizationAttributes>(
      '/appEventLocalizations',
      {
        type: 'appEventLocalizations',
        attributes: eventLocalizationAttributes,
        relationships: { appEvent: { data: { type: 'appEvents', id: eventId } } },
      },
    );
    return toAppEventLocalization(appleResources, locale);
  }

  async updateAppEventLocalization(
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const eventLocalizationAttributes: AppEventLocalizationInput = {};
    if (attributes.name !== undefined)
      Object.assign(eventLocalizationAttributes, { name: attributes.name });
    if (attributes.shortDescription !== undefined)
      Object.assign(eventLocalizationAttributes, { shortDescription: attributes.shortDescription });
    if (attributes.longDescription !== undefined)
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
    return toAppEventLocalization(appleResources, '');
  }
}
