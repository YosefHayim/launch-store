import { Effect } from 'effect';
import type { AscSurfacesApi, PlayCatalogApi } from '@core/types/plan.js';

const emptyReadFor = (methodName: string): unknown => {
  if (methodName.startsWith('list')) return [];
  return null;
};

/**
 * A stand-in for the App Store Connect client that never touches the network. Every read answers "nothing
 * there yet" unless a sample store overrides it; every write is absent because plans never send changes.
 */
export const makeSampleAscApi = (sampleReads: Partial<AscSurfacesApi>): AscSurfacesApi => {
  const sampleMethods: Record<string, unknown> = { ...sampleReads };
  return new Proxy(sampleMethods, {
    get: (targetMethods, methodName) => {
      if (typeof methodName !== 'string') return undefined;
      const sampleMethod = targetMethods[methodName];
      if (sampleMethod !== undefined) return sampleMethod;
      return () => Effect.succeed(emptyReadFor(methodName));
    },
  }) as AscSurfacesApi;
};

/** A stand-in for the Google Play client: the app exists, nothing is published yet. */
export const makeSamplePlayApi = (sampleReads: Partial<PlayCatalogApi>): PlayCatalogApi => ({
  assertAppExists: () => Effect.void,
  listInAppProducts: () => Effect.succeed([]),
  insertInAppProduct: () => Effect.void,
  updateInAppProduct: () => Effect.void,
  listSubscriptions: () => Effect.succeed([]),
  createSubscription: () => Effect.void,
  patchSubscription: () => Effect.void,
  activateBasePlan: () => Effect.void,
  listSubscriptionOffers: () => Effect.succeed([]),
  createSubscriptionOffer: () => Effect.void,
  activateSubscriptionOffer: () => Effect.void,
  ...sampleReads,
});
