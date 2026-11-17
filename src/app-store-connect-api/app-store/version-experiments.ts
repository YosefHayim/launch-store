import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  ScreenshotSetResource,
  VersionExperimentResource,
} from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-store-version-experiments
export const makeVersionExperimentsApi = (api: AppStoreConnectRequests) => {
  const listScreenshotSetsOf = async (
    ownerType: string,
    ownerId: string,
  ): Promise<ScreenshotSetResource[]> => {
    const appleResources = await api.requestAll<{
      screenshotDisplayType?: string;
    }>(
      `/${ownerType}/${ownerId}/appScreenshotSets?fields[appScreenshotSets]=screenshotDisplayType&limit=200`,
    );
    return appleResources.map((screenshotSet) => {
      let screenshotDisplayType = screenshotSet.attributes.screenshotDisplayType;
      if (screenshotDisplayType === undefined) screenshotDisplayType = '';
      return { id: screenshotSet.id, screenshotDisplayType };
    });
  };
  const createScreenshotSetOf = async (
    ownerRelationship: string,
    ownerType: string,
    ownerId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> => {
    const appleResources = await api.createResource<{
      screenshotDisplayType?: string;
    }>('/appScreenshotSets', {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: displayType },
      relationships: { [ownerRelationship]: { data: { type: ownerType, id: ownerId } } },
    });
    let screenshotDisplayType = appleResources.attributes.screenshotDisplayType;
    if (screenshotDisplayType === undefined) screenshotDisplayType = displayType;
    return { id: appleResources.id, screenshotDisplayType };
  };
  /** List an app's product-page A/B experiments (v2), matched by name. */
  const listVersionExperiments = async (appId: string): Promise<VersionExperimentResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** Create a product-page A/B experiment on `/v2` (the v1 create takes a version, not an app and platform). */
  const createVersionExperiment = async (
    appId: string,
    input: {
      name: string;
      platform: string;
      trafficProportion: number;
    },
  ): Promise<VersionExperimentResource> => {
    const appleResources = await api.createResource<Record<string, never>>(
      api.v2('/appStoreVersionExperiments'),
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
  };
  /** List a version experiment's treatments (variant arms), matched by name. */
  const listExperimentTreatments = async (
    experimentId: string,
  ): Promise<ExperimentTreatmentResource[]> => {
    const appleResources = await api.requestAll<{
      name?: string;
    }>(
      api.v2(
        `/appStoreVersionExperiments/${experimentId}/appStoreVersionExperimentTreatments?limit=200&fields[appStoreVersionExperimentTreatments]=name`,
      ),
    );
    return appleResources.flatMap((treatment) => {
      const treatmentName = treatment.attributes.name;
      if (treatmentName === undefined) return [];
      return [{ id: treatment.id, name: treatmentName }];
    });
  };
  /** Create one treatment (variant arm) on a version experiment. */
  const createExperimentTreatment = async (
    experimentId: string,
    input: {
      name: string;
      appIconName?: string;
    },
  ): Promise<ExperimentTreatmentResource> => {
    const attributes: {
      name: string;
      appIconName?: string;
    } = { name: input.name };
    if (input.appIconName) attributes.appIconName = input.appIconName;
    const appleResources = await api.createResource<Record<string, never>>(
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
  };
  /** Start an approved product-page experiment (the v2 `started: true` PATCH). */
  const startVersionExperiment = async (experimentId: string): Promise<void> => {
    await api.updateResource(api.v2(`/appStoreVersionExperiments/${experimentId}`), {
      type: 'appStoreVersionExperiments',
      id: experimentId,
      attributes: { started: true },
    });
  };
  /** List a treatment's localizations (one per locale), matched by locale. */
  const listExperimentTreatmentLocalizations = async (
    treatmentId: string,
  ): Promise<ExperimentTreatmentLocalizationResource[]> => {
    const appleResources = await api.requestAll<{
      locale?: string;
    }>(
      `/appStoreVersionExperimentTreatments/${treatmentId}/appStoreVersionExperimentTreatmentLocalizations?limit=200&fields[appStoreVersionExperimentTreatmentLocalizations]=locale`,
    );
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      return [{ id: localization.id, locale }];
    });
  };
  /** Add one locale to a treatment so it can hold that locale's screenshot sets. */
  const createExperimentTreatmentLocalization = async (
    treatmentId: string,
    locale: string,
  ): Promise<ExperimentTreatmentLocalizationResource> => {
    const appleResources = await api.createResource<Record<string, never>>(
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
  };
  /** List the screenshot sets bound to one experiment treatment localization. */
  const listTreatmentScreenshotSets = async (
    treatmentLocalizationId: string,
  ): Promise<ScreenshotSetResource[]> => {
    return listScreenshotSetsOf(
      'appStoreVersionExperimentTreatmentLocalizations',
      treatmentLocalizationId,
    );
  };
  /** Create a screenshot set for one display type under an experiment treatment localization. */
  const createTreatmentScreenshotSet = async (
    treatmentLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> => {
    return createScreenshotSetOf(
      'appStoreVersionExperimentTreatmentLocalization',
      'appStoreVersionExperimentTreatmentLocalizations',
      treatmentLocalizationId,
      displayType,
    );
  };

  return {
    listVersionExperiments,
    createVersionExperiment,
    listExperimentTreatments,
    createExperimentTreatment,
    startVersionExperiment,
    listExperimentTreatmentLocalizations,
    createExperimentTreatmentLocalization,
    listTreatmentScreenshotSets,
    createTreatmentScreenshotSet,
  };
};
