import type {
  AlternativeDistributionDomainResource,
  AlternativeDistributionKeyResource,
  MerchantIdResource,
  PassTypeIdResource,
} from '@/types/apple-catalog.js';
import type { AscHost } from './host.ts';
import type { ResourceSingle } from './shared.ts';
import type { components } from '@/apple-api-types.js';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectDistribution {
  constructor(private readonly client: AscHost) {}

  /**
   * List all the alternative distribution domains for your account.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributiondomains
   */
  async listAlternativeDistributionDomains(
    listQuery: AppleListQuery | null = null,
  ): Promise<AlternativeDistributionDomainResource[]> {
    const appleResources = await this.client.requestAll<{
      domain?: string;
      referenceName?: string;
    }>(applyAppleListQuery('/alternativeDistributionDomains', listQuery, APPLE_PAGE_LIMIT));

    function copyDistributionDomain(domain: {
      id: string;
      attributes: { domain?: string; referenceName?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const distributionDomain: AlternativeDistributionDomainResource = { id: domain.id };

      if (domain.attributes.domain != null)
        Object.assign(distributionDomain, { domain: domain.attributes.domain });

      if (domain.attributes.referenceName != null)
        Object.assign(distributionDomain, { referenceName: domain.attributes.referenceName });

      return distributionDomain;
    }

    return appleResources.map(copyDistributionDomain);
  }

  /**
   * Add an alternative distribution domain to your account.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-alternativedistributiondomains
   */
  async createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void> {
    const requestDocument: components['schemas']['AlternativeDistributionDomainCreateRequest'] = {
      data: { type: 'alternativeDistributionDomains', attributes: { domain, referenceName } },
    };
    await this.client.request<unknown>('POST', '/alternativeDistributionDomains', requestDocument);
  }

  /**
   * List the alternative distribution key for your account.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionkeys
   */
  async listAlternativeDistributionKeys(
    listQuery: AppleListQuery | null = null,
  ): Promise<AlternativeDistributionKeyResource[]> {
    const appleResources = await this.client.requestAll<{
      publicKey?: string;
    }>(applyAppleListQuery('/alternativeDistributionKeys', listQuery, APPLE_PAGE_LIMIT));

    function copyDistributionKey(distributionKey: {
      id: string;
      attributes: { publicKey?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const keyResource: AlternativeDistributionKeyResource = { id: distributionKey.id };

      if (distributionKey.attributes.publicKey != null)
        Object.assign(keyResource, { publicKey: distributionKey.attributes.publicKey });

      return keyResource;
    }

    return appleResources.map(copyDistributionKey);
  }

  /**
   * Add an alternative distribution key for your alternative marketplace app or web distribution.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-alternativedistributionkeys
   */
  async createAlternativeDistributionKey(publicKey: string): Promise<{
    id: string;
  }> {
    const requestDocument: components['schemas']['AlternativeDistributionKeyCreateRequest'] = {
      data: { type: 'alternativeDistributionKeys', attributes: { publicKey } },
    };
    const { data: appleResources } = await this.client.request<
      ResourceSingle<{
        publicKey?: string;
      }>
    >('POST', '/alternativeDistributionKeys', requestDocument);

    return { id: appleResources.id };
  }

  /**
   * List all merchant Ids for your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-merchantids
   */
  async listMerchantIds(listQuery: AppleListQuery | null = null): Promise<MerchantIdResource[]> {
    const appleResources = await this.client.requestAll<{
      identifier?: string;
      name?: string;
    }>(applyAppleListQuery('/merchantIds', listQuery, APPLE_PAGE_LIMIT));

    function copyMerchantId(merchant: {
      id: string;
      attributes: { identifier?: string; name?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const merchantId: MerchantIdResource = { id: merchant.id };

      if (merchant.attributes.identifier != null)
        Object.assign(merchantId, { identifier: merchant.attributes.identifier });

      if (merchant.attributes.name != null)
        Object.assign(merchantId, { name: merchant.attributes.name });

      return merchantId;
    }

    return appleResources.map(copyMerchantId);
  }

  /**
   * Add a new merchant ID to your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-merchantids
   */
  async createMerchantId(identifier: string, name: string): Promise<void> {
    const requestDocument: components['schemas']['MerchantIdCreateRequest'] = {
      data: { type: 'merchantIds', attributes: { name, identifier } },
    };
    await this.client.request<unknown>('POST', '/merchantIds', requestDocument);
  }

  /**
   * Find and list pass type IDs that are registered to your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-passtypeids
   */
  async listPassTypeIds(listQuery: AppleListQuery | null = null): Promise<PassTypeIdResource[]> {
    const appleResources = await this.client.requestAll<{
      identifier?: string;
      name?: string;
    }>(applyAppleListQuery('/passTypeIds', listQuery, APPLE_PAGE_LIMIT));

    function copyPassTypeId(passType: {
      id: string;
      attributes: { identifier?: string; name?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const passTypeId: PassTypeIdResource = { id: passType.id };

      if (passType.attributes.identifier != null)
        Object.assign(passTypeId, { identifier: passType.attributes.identifier });

      if (passType.attributes.name != null)
        Object.assign(passTypeId, { name: passType.attributes.name });

      return passTypeId;
    }

    return appleResources.map(copyPassTypeId);
  }

  /**
   * Create a new identifier for use with a pass type ID certificate using a certificate signing
   * request.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-passtypeids
   */
  async createPassTypeId(identifier: string, name: string): Promise<void> {
    const requestDocument: components['schemas']['PassTypeIdCreateRequest'] = {
      data: { type: 'passTypeIds', attributes: { name, identifier } },
    };
    await this.client.request<unknown>('POST', '/passTypeIds', requestDocument);
  }
}
