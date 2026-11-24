// A Google Play inappproducts resource and its price.

export type PlayMoney = Readonly<{ priceMicros?: string; currency?: string }>;

export type InAppProductResource = Readonly<{
  sku: string;
  status?: string;
  purchaseType?: string;
  defaultLanguage?: string;
  defaultPrice?: PlayMoney;
  prices?: Record<string, PlayMoney>;
  listings?: Record<string, Readonly<{ title?: string; description?: string }>>;
}>;
