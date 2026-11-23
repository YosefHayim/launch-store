import type { AscHost } from './host.ts';
import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  VersionExperimentResource,
} from '@/types/apple-catalog.js';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectExperiments {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of all App Store version experiments for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversionexperimentsv2
   */
  async listVersionExperiments(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<VersionExperimentResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      state?: string;
      trafficProportion?: number;
      startDate?: string;
    }>(
      applyAppleListQuery(
        `/apps/${appId}/appStoreVersionExperimentsV2`,
        listQuery,
        APPLE_PAGE_LIMIT,
        {
          'fields[appStoreVersionExperiments]': 'name,state,trafficProportion,startDate',
        },
      ),
    );

    function readVersionExperiment(experiment: {
      id: string;
      attributes: { name?: string; state?: string; trafficProportion?: number; startDate?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const experimentName = experiment.attributes.name;

      if (experimentName == null) return [];

      let state = experiment.attributes.state;

      if (state == null) state = '';

      const versionExperiment: VersionExperimentResource = {
        id: experiment.id,
        name: experimentName,
        state,
      };

      if (experiment.attributes.trafficProportion != null)
        Object.assign(versionExperiment, {
          trafficProportion: experiment.attributes.trafficProportion,
        });

      if (experiment.attributes.startDate != null)
        Object.assign(versionExperiment, { startDate: experiment.attributes.startDate });

      return [versionExperiment];
    }

    return appleResources.flatMap(readVersionExperiment);
  }

  /**
   * Add a new experiment to an App Store version.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-appstoreversionexperiments
   */
  async createVersionExperiment(
    appId: string,
    input: {
      name: string;
      platform: string;
      trafficProportion: number;
    },
  ): Promise<VersionExperimentResource> {
    const appleResources = await this.client.createResource<Record<string, never>>(
      this.client.v2('/appStoreVersionExperiments'),
      {
        type: 'appStoreVersionExperiments',
        attributes: {
          name: input.name,
          platform: input.platform,
          trafficProportion: input.trafficProportion,
        },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    );

    return {
      id: appleResources.id,
      name: input.name,
      state: 'PREPARE_FOR_SUBMISSION',
      trafficProportion: input.trafficProportion,
    };
  }

  /**
   * Get a list of all treatments for a specific App Store version experiment.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appstoreversionexperiments-_id_-appstoreversionexperimenttreatments
   */
  async listExperimentTreatments(
    experimentId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ExperimentTreatmentResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
    }>(
      this.client.v2(
        applyAppleListQuery(
          `/appStoreVersionExperiments/${experimentId}/appStoreVersionExperimentTreatments`,
          listQuery,
          APPLE_PAGE_LIMIT,
          { 'fields[appStoreVersionExperimentTreatments]': 'name' },
        ),
      ),
    );

    function readExperimentTreatment(treatment: {
      id: string;
      attributes: { name?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const treatmentName = treatment.attributes.name;

      if (treatmentName == null) return [];

      return [{ id: treatment.id, name: treatmentName }];
    }

    return appleResources.flatMap(readExperimentTreatment);
  }

  /**
   * Add a new treatment to an App Store version experiment.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionexperimenttreatments
   */
  async createExperimentTreatment(
    experimentId: string,
    input: {
      name: string;
      appIconName?: string;
    },
  ): Promise<ExperimentTreatmentResource> {
    const attributes: {
      name: string;
      appIconName?: string;
    } = { name: input.name };

    if (input.appIconName) attributes.appIconName = input.appIconName;

    const appleResources = await this.client.createResource<Record<string, never>>(
      '/appStoreVersionExperimentTreatments',
      {
        type: 'appStoreVersionExperimentTreatments',
        attributes,
        relationships: {
          appStoreVersionExperimentV2: {
            data: { type: 'appStoreVersionExperiments', id: experimentId },
          },
        },
      },
    );

    return { id: appleResources.id, name: input.name };
  }

  /**
   * Update the name, the started state, and the proportion of traffic to send to an App Store
   * experiment.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-appstoreversionexperiments-_id_
   */
  async startVersionExperiment(experimentId: string): Promise<void> {
    await this.client.updateResource(
      this.client.v2(`/appStoreVersionExperiments/${experimentId}`),
      {
        type: 'appStoreVersionExperiments',
        id: experimentId,
        attributes: { started: true },
      },
    );
  }

  /**
   * Get a list of all localizations for a specific App Store version experiment treatment.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatments-_id_-appstoreversionexperimenttreatmentlocalizations
   */
  async listExperimentTreatmentLocalizations(
    treatmentId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ExperimentTreatmentLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
    }>(
      applyAppleListQuery(
        `/appStoreVersionExperimentTreatments/${treatmentId}/appStoreVersionExperimentTreatmentLocalizations`,
        listQuery,
        APPLE_PAGE_LIMIT,
        {
          'fields[appStoreVersionExperimentTreatmentLocalizations]': 'locale',
        },
      ),
    );

    function readTreatmentLocalization(localization: {
      id: string;
      attributes: { locale?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const locale = localization.attributes.locale;

      if (locale == null) return [];

      return [{ id: localization.id, locale }];
    }

    return appleResources.flatMap(readTreatmentLocalization);
  }

  /**
   * Add a new localization for an App Store version experiment treatment.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionexperimenttreatmentlocalizations
   */
  async createExperimentTreatmentLocalization(
    treatmentId: string,
    locale: string,
  ): Promise<ExperimentTreatmentLocalizationResource> {
    const appleResources = await this.client.createResource<Record<string, never>>(
      '/appStoreVersionExperimentTreatmentLocalizations',
      {
        type: 'appStoreVersionExperimentTreatmentLocalizations',
        attributes: { locale },
        relationships: {
          appStoreVersionExperimentTreatment: {
            data: { type: 'appStoreVersionExperimentTreatments', id: treatmentId },
          },
        },
      },
    );

    return { id: appleResources.id, locale };
  }
}
