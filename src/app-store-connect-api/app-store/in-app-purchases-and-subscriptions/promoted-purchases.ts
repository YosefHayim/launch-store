import type { components } from '@apple/generated/schema.js';
import type { PromotedPurchaseCreate, PromotedPurchaseResource } from '@core/types/appleCatalog.js';
import type {
  AppStoreConnectRequests,
  ResourceSingle,
} from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/promoted-purchases-top
/**
 * One page of `/apps/{id}/promotedPurchases`, read with each row's product `relationships` intact (which
 * `requestAll` drops) - the linkage is how a promoted purchase is matched to
 * a config `productId`. Kept as a named interface so the paginating read isn't self-referential (TS7022).
 */
type PromotedPurchasePage = {
  data: {
    id: string;
    attributes?: {
      enabled?: boolean;
      visibleForAllUsers?: boolean;
    };
    relationships?: {
      inAppPurchaseV2?: {
        data?: {
          id: string;
        } | null;
      };
      subscription?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  links?: {
    next?: string;
  };
};
export const makePromotedPurchasesApi = (api: AppStoreConnectRequests) => {
  /** List an app's promoted purchases in their current product-page order, with each one's product linkage. */
  const listPromotedPurchases = async (appId: string): Promise<PromotedPurchaseResource[]> => {
    const all: PromotedPurchaseResource[] = [];
    let next: string | undefined = `/apps/${appId}/promotedPurchases?limit=200`;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: PromotedPurchasePage = await api.request<PromotedPurchasePage>('GET', next);
      for (const promotedPurchase of page.data) {
        let inAppPurchaseId: string | null = null;
        const returnedInAppPurchaseId = promotedPurchase.relationships?.inAppPurchaseV2?.data?.id;
        if (returnedInAppPurchaseId !== undefined) inAppPurchaseId = returnedInAppPurchaseId;
        let subscriptionId: string | null = null;
        const returnedSubscriptionId = promotedPurchase.relationships?.subscription?.data?.id;
        if (returnedSubscriptionId !== undefined) subscriptionId = returnedSubscriptionId;
        let enabled = promotedPurchase.attributes?.enabled;
        if (enabled === undefined) enabled = false;
        let visibleForAllUsers = promotedPurchase.attributes?.visibleForAllUsers;
        if (visibleForAllUsers === undefined) visibleForAllUsers = false;
        all.push({
          id: promotedPurchase.id,
          inAppPurchaseId,
          subscriptionId,
          enabled,
          visibleForAllUsers,
        });
      }
      next = page.links?.next;
    }
    return all;
  };
  /** Register a promoted purchase for one product (subscription or IAP) on an app. */
  const createPromotedPurchase = async (
    input: PromotedPurchaseCreate,
  ): Promise<PromotedPurchaseResource> => {
    const promotedPurchaseRelationships = {
      app: { data: { type: 'apps' as const, id: input.appId } },
    };
    if (input.inAppPurchaseId !== undefined)
      Object.assign(promotedPurchaseRelationships, {
        inAppPurchaseV2: { data: { type: 'inAppPurchases', id: input.inAppPurchaseId } },
      });
    if (input.subscriptionId !== undefined)
      Object.assign(promotedPurchaseRelationships, {
        subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
      });
    const requestDocument: components['schemas']['PromotedPurchaseCreateRequest'] = {
      data: {
        type: 'promotedPurchases',
        attributes: { visibleForAllUsers: input.visibleForAllUsers, enabled: input.enabled },
        relationships: promotedPurchaseRelationships,
      },
    };
    const { data: appleResources } = await api.request<
      ResourceSingle<{
        enabled?: boolean;
        visibleForAllUsers?: boolean;
      }>
    >('POST', '/promotedPurchases', requestDocument);
    let inAppPurchaseId: string | null = null;
    if (input.inAppPurchaseId !== undefined) inAppPurchaseId = input.inAppPurchaseId;
    let subscriptionId: string | null = null;
    if (input.subscriptionId !== undefined) subscriptionId = input.subscriptionId;
    let enabled = appleResources.attributes.enabled;
    if (enabled === undefined) enabled = input.enabled;
    let visibleForAllUsers = appleResources.attributes.visibleForAllUsers;
    if (visibleForAllUsers === undefined) visibleForAllUsers = input.visibleForAllUsers;
    return { id: appleResources.id, inAppPurchaseId, subscriptionId, enabled, visibleForAllUsers };
  };
  /** Replace the app's promoted-purchase ordering with `orderedIds` (the product-page display order). */
  const reorderPromotedPurchases = async (
    appId: string,
    orderedIds: readonly string[],
  ): Promise<void> => {
    const requestDocument: components['schemas']['AppPromotedPurchasesLinkagesRequest'] = {
      data: orderedIds.map((id) => ({ type: 'promotedPurchases', id })),
    };
    await api.request<unknown>(
      'PATCH',
      `/apps/${appId}/relationships/promotedPurchases`,
      requestDocument,
    );
  };
  return {
    listPromotedPurchases,
    createPromotedPurchase,
    reorderPromotedPurchases,
  };
};
