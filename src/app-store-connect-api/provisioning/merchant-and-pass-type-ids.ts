// Docs: https://developer.apple.com/documentation/appstoreconnectapi/merchantids
import type { components } from '@apple/generated/schema.js';
import type { MerchantIdResource, PassTypeIdResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
export const makeMerchantAndPassTypeIdsApi = (api: AppStoreConnectRequests) => {
  /** List the team's registered Apple Pay merchant ids (matched to config on `identifier`). */
  const listMerchantIds = async (): Promise<MerchantIdResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** Register an Apple Pay merchant id (`merchant....`) on the team. */
  const createMerchantId = async (identifier: string, name: string): Promise<void> => {
    const requestDocument: components['schemas']['MerchantIdCreateRequest'] = {
      data: { type: 'merchantIds', attributes: { name, identifier } },
    };
    await api.request<unknown>('POST', '/merchantIds', requestDocument);
  };
  /** List the team's registered Wallet pass type ids (matched to config on `identifier`). */
  const listPassTypeIds = async (): Promise<PassTypeIdResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** Register a Wallet pass type id (`pass....`) on the team. */
  const createPassTypeId = async (identifier: string, name: string): Promise<void> => {
    const requestDocument: components['schemas']['PassTypeIdCreateRequest'] = {
      data: { type: 'passTypeIds', attributes: { name, identifier } },
    };
    await api.request<unknown>('POST', '/passTypeIds', requestDocument);
  };
  return {
    listMerchantIds,
    createMerchantId,
    listPassTypeIds,
    createPassTypeId,
  };
};
