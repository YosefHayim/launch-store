import type { AscHost } from './host.ts';
import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  VersionExperimentResource,
} from '../../types/apple-catalog.ts';

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
    function flatMapExperiment(experiment: {
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

    return appleResources.flatMap(flatMapExperiment);
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
    function flatMapTreatment(treatment: {
      id: string;
      attributes: { name?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const treatmentName = treatment.attributes.name;
      if (treatmentName == null) return [];
      return [{ id: treatment.id, name: treatmentName }];
    }

    return appleResources.flatMap(flatMapTreatment);
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
    function flatMapLocalization(localization: {
      id: string;
      attributes: { locale?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const locale = localization.attributes.locale;
      if (locale == null) return [];
      return [{ id: localization.id, locale }];
    }

    return appleResources.flatMap(flatMapLocalization);
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
