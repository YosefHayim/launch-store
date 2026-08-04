export type PlayMoneyUnits = {
  readonly currencyCode: string;
  readonly units: string;
  readonly nanos: number;
};
/** One Play market's recommended local price. */
export type ConvertedRegionPrice = {
  readonly regionCode: string;
  readonly price: PlayMoneyUnits;
};
/** Fallback prices for markets where Play does not support a local currency. */
export type OtherRegionsPrice = {
  readonly usdPrice: PlayMoneyUnits;
  readonly eurPrice: PlayMoneyUnits;
};
/** Recommended regional prices normalized from Android Publisher's generated DTO. */
export type ConvertedPrices = {
  readonly regions: ConvertedRegionPrice[];
  otherRegions?: OtherRegionsPrice;
};
