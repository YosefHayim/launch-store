import type { AscHost } from './host.js';
import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  VersionExperimentResource,
} from '@/core/types/appleCatalog.js';

export class ConnectExperiments {
  constructor(private readonly client: AscHost) {}

  async listVersionExperiments(appId: string): Promise<VersionExperimentResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      state?: string;
      trafficProportion?: number;
      startDate?: string;
    }>(
      `/apps/${appId}/appStoreVersionExperimentsV2?limit=200&fields[appStoreVersionExperiments]=name,state,trafficProportion,startDate`,
    );
    return appleResources.flatMap((experiment) => {
      const experimentName = experiment.attributes.name;
      if (experimentName === undefined) return [];
      let state = experiment.attributes.state;
      if (state === undefined) state = '';
      const versionExperiment: VersionExperimentResource = {
        id: experiment.id,
        name: experimentName,
        state,
      };
      if (experiment.attributes.trafficProportion !== undefined)
        Object.assign(versionExperiment, {
          trafficProportion: experiment.attributes.trafficProportion,
        });
      if (experiment.attributes.startDate !== undefined)
        Object.assign(versionExperiment, { startDate: experiment.attributes.startDate });
      return [versionExperiment];
    });
  }

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

  async listExperimentTreatments(experimentId: string): Promise<ExperimentTreatmentResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
    }>(
      this.client.v2(
        `/appStoreVersionExperiments/${experimentId}/appStoreVersionExperimentTreatments?limit=200&fields[appStoreVersionExperimentTreatments]=name`,
      ),
    );
    return appleResources.flatMap((treatment) => {
      const treatmentName = treatment.attributes.name;
      if (treatmentName === undefined) return [];
      return [{ id: treatment.id, name: treatmentName }];
    });
  }

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

  async listExperimentTreatmentLocalizations(
    treatmentId: string,
  ): Promise<ExperimentTreatmentLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
    }>(
      `/appStoreVersionExperimentTreatments/${treatmentId}/appStoreVersionExperimentTreatmentLocalizations?limit=200&fields[appStoreVersionExperimentTreatmentLocalizations]=locale`,
    );
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      return [{ id: localization.id, locale }];
    });
  }

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
