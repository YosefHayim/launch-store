// App Store Connect in-app purchases and promoted purchases.

/** An in-app purchase (the `inAppPurchasesV2` resource) on an app. */
export type InAppPurchaseResource = Readonly<{
  id: string;
  productId: string;
  name: string;
  inAppPurchaseType: string;
  state?: string;
}>;

/** A promoted purchase on an app's product page. */
export type PromotedPurchaseResource = Readonly<{
  id: string;
  inAppPurchaseId: string | null;
  subscriptionId: string | null;
  enabled: boolean;
  visibleForAllUsers: boolean;
}>;

/** A promoted product to register - exactly one of the two ids is set (resolved from a config `productId`). */
export type PromotedPurchaseCreate = Readonly<{
  appId: string;
  inAppPurchaseId?: string;
  subscriptionId?: string;
  visibleForAllUsers: boolean;
  enabled: boolean;
}>;
