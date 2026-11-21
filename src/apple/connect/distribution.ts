import type {
  AlternativeDistributionDomainResource,
  AlternativeDistributionKeyResource,
  MerchantIdResource,
  PassTypeIdResource,
} from '@/types/appleCatalog.js';
import type { AscHost } from './host.js';
import type { ResourceSingle } from './shared.js';
import type { components } from '@/apple/generated/schema.js';

export class ConnectDistribution {
  constructor(private readonly client: AscHost) {}

  async listAlternativeDistributionDomains(): Promise<AlternativeDistributionDomainResource[]> {
    const appleResources = await this.client.requestAll<{
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
    return appleResources.map((distributionKey) => {
      const keyResource: AlternativeDistributionKeyResource = { id: distributionKey.id };
      if (distributionKey.attributes.publicKey !== undefined)
        Object.assign(keyResource, { publicKey: distributionKey.attributes.publicKey });
      return keyResource;
    });
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
    return appleResources.map((merchant) => {
      const merchantId: MerchantIdResource = { id: merchant.id };
      if (merchant.attributes.identifier !== undefined)
        Object.assign(merchantId, { identifier: merchant.attributes.identifier });
      if (merchant.attributes.name !== undefined)
        Object.assign(merchantId, { name: merchant.attributes.name });
      return merchantId;
    });
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
    return appleResources.map((passType) => {
      const passTypeId: PassTypeIdResource = { id: passType.id };
      if (passType.attributes.identifier !== undefined)
        Object.assign(passTypeId, { identifier: passType.attributes.identifier });
      if (passType.attributes.name !== undefined)
        Object.assign(passTypeId, { name: passType.attributes.name });
      return passTypeId;
    });
  }

  async createPassTypeId(identifier: string, name: string): Promise<void> {
    const requestDocument: components['schemas']['PassTypeIdCreateRequest'] = {
      data: { type: 'passTypeIds', attributes: { name, identifier } },
    };
    await this.client.request<unknown>('POST', '/passTypeIds', requestDocument);
  }
}
