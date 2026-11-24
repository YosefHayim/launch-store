// App Store custom product pages and their versions.

/** A custom product page - an alternate App Store listing (marketing variant), matched by its `name`. */
export type CustomProductPageResource = Readonly<{
  id: string;
  name: string;
}>;

/** One version of a custom product page; its localizations hang off it. `state` decides whether it's editable. */
export type CustomProductPageVersionResource = Readonly<{
  id: string;
  state: string;
}>;

/** One locale's custom-product-page copy. Launch writes the `promotionalText`; screenshots are out of scope. */
export type CustomProductPageLocalizationResource = Readonly<{
  id: string;
  locale: string;
  promotionalText?: string;
}>;
