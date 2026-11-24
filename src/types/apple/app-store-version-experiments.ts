// App Store version experiments that test a product page.

/** A product-page A/B experiment (Apple's v2 model), matched by its `name`. */
export type VersionExperimentResource = Readonly<{
  id: string;
  name: string;
  state: string;
  trafficProportion?: number;
  startDate?: string;
}>;

/** One treatment (variant arm) of a version experiment, matched by its `name`. */
export type ExperimentTreatmentResource = Readonly<{
  id: string;
  name: string;
}>;

/** One locale of an experiment treatment; it holds that locale's treatment screenshot sets. */
export type ExperimentTreatmentLocalizationResource = Readonly<{
  id: string;
  locale: string;
}>;
