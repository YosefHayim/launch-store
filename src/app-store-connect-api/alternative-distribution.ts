// Docs: https://developer.apple.com/documentation/appstoreconnectapi/alternative-marketplaces-and-web-distribution
import type { components } from '@apple/generated/schema.js';
import type {
  AlternativeDistributionDomainResource,
  AlternativeDistributionKeyResource,
} from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests, ResourceSingle } from './api-client.js';
export const makeAlternativeDistributionApi = (api: AppStoreConnectRequests) => {
  /**
   * List the team's authorized alternative-distribution domains (EU DMA web distribution). Team-level -
   * no app scope - so the reconciler matches declared domains to these by `domain`.
   */
  const listAlternativeDistributionDomains = async (): Promise<
    AlternativeDistributionDomainResource[]
  > => {
    const appleResources = await api.requestAll<{
      domain?: string;
      referenceName?: string;
    }>('/alternativeDistributionDomains?limit=200');
    return appleResources.map((domain) => {
      const distributionDomain: AlternativeDistributionDomainResource = { id: domain.id };
      if (domain.attributes.domain !== undefined)
        Object.assign(distributionDomain, { domain: domain.attributes.domain });
      if (domain.attributes.referenceName !== undefined)
        Object.assign(distributionDomain, { referenceName: domain.attributes.referenceName });
      return distributionDomain;
    });
  };
  /** Authorize a new alternative-distribution domain for the team. */
  const createAlternativeDistributionDomain = async (
    domain: string,
    referenceName: string,
  ): Promise<void> => {
    const requestDocument: components['schemas']['AlternativeDistributionDomainCreateRequest'] = {
      data: { type: 'alternativeDistributionDomains', attributes: { domain, referenceName } },
    };
    await api.request<unknown>('POST', '/alternativeDistributionDomains', requestDocument);
  };
  /** List the team's registered alternative-distribution public keys (usually zero or one). */
  const listAlternativeDistributionKeys = async (): Promise<
    AlternativeDistributionKeyResource[]
  > => {
    const appleResources = await api.requestAll<{
      publicKey?: string;
    }>('/alternativeDistributionKeys?limit=200');
    return appleResources.map((distributionKey) => {
      const keyResource: AlternativeDistributionKeyResource = { id: distributionKey.id };
      if (distributionKey.attributes.publicKey !== undefined)
        Object.assign(keyResource, { publicKey: distributionKey.attributes.publicKey });
      return keyResource;
    });
  };
  /** Register the team's alternative-distribution package-signing public key (the PEM `publicKey`). */
  const createAlternativeDistributionKey = async (
    publicKey: string,
  ): Promise<{
    id: string;
  }> => {
    const requestDocument: components['schemas']['AlternativeDistributionKeyCreateRequest'] = {
      data: { type: 'alternativeDistributionKeys', attributes: { publicKey } },
    };
    const { data: appleResources } = await api.request<
      ResourceSingle<{
        publicKey?: string;
      }>
    >('POST', '/alternativeDistributionKeys', requestDocument);
    return { id: appleResources.id };
  };
  return {
    listAlternativeDistributionDomains,
    createAlternativeDistributionDomain,
    listAlternativeDistributionKeys,
    createAlternativeDistributionKey,
  };
};
