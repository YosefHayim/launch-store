import type {
  AlternativeDistributionDomainResource,
  AlternativeDistributionKeyResource,
  MerchantIdResource,
  PassTypeIdResource,
} from '../../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import type { ResourceSingle } from './shared.ts';
import type { components } from '../../apple-api-types.ts';

export class ConnectDistribution {
  constructor(private readonly client: AscHost) {}

  async listAlternativeDistributionDomains(): Promise<AlternativeDistributionDomainResource[]> {
    const appleResources = await this.client.requestAll<{
      domain?: string;
      referenceName?: string;
    }>('/alternativeDistributionDomains?limit=200');
    function mapDomain(domain: {
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

    return appleResources.map(mapDomain);
  }

  async createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void> {
    const requestDocument: components['schemas']['AlternativeDistributionDomainCreateRequest'] = {
      data: { type: 'alternativeDistributionDomains', attributes: { domain, referenceName } },
    };
    await this.client.request<unknown>('POST', '/alternativeDistributionDomains', requestDocument);
  }

  async listAlternativeDistributionKeys(): Promise<AlternativeDistributionKeyResource[]> {
    const appleResources = await this.client.requestAll<{
      publicKey?: string;
    }>('/alternativeDistributionKeys?limit=200');
    function mapDistributionKey(distributionKey: {
      id: string;
      attributes: { publicKey?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const keyResource: AlternativeDistributionKeyResource = { id: distributionKey.id };
      if (distributionKey.attributes.publicKey != null)
        Object.assign(keyResource, { publicKey: distributionKey.attributes.publicKey });
      return keyResource;
    }

    return appleResources.map(mapDistributionKey);
  }

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

  async listMerchantIds(): Promise<MerchantIdResource[]> {
    const appleResources = await this.client.requestAll<{
      identifier?: string;
      name?: string;
    }>('/merchantIds?limit=200');
    function mapMerchant(merchant: {
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

    return appleResources.map(mapMerchant);
  }

  async createMerchantId(identifier: string, name: string): Promise<void> {
    const requestDocument: components['schemas']['MerchantIdCreateRequest'] = {
      data: { type: 'merchantIds', attributes: { name, identifier } },
    };
    await this.client.request<unknown>('POST', '/merchantIds', requestDocument);
  }

  async listPassTypeIds(): Promise<PassTypeIdResource[]> {
    const appleResources = await this.client.requestAll<{
      identifier?: string;
      name?: string;
    }>('/passTypeIds?limit=200');
    function mapPassType(passType: {
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

    return appleResources.map(mapPassType);
  }

  async createPassTypeId(identifier: string, name: string): Promise<void> {
    const requestDocument: components['schemas']['PassTypeIdCreateRequest'] = {
      data: { type: 'passTypeIds', attributes: { name, identifier } },
    };
    await this.client.request<unknown>('POST', '/passTypeIds', requestDocument);
  }
}
