import type { ReadinessCategory, ReadinessProbe } from '../types/readiness.js';
import { agreementsProbe } from './probes/agreements.js';
import { appRecordProbe } from './probes/appRecord.js';
import { subscriptionGroupProbe } from './probes/subscriptionGroup.js';
import { bundleIdProbe } from './probes/bundleId.js';
import { distributionCertProbe } from './probes/distributionCert.js';
import { exportComplianceProbe } from './probes/exportCompliance.js';
import { iapProductsProbe } from './probes/iapProducts.js';
import { iapCodeReferenceProbe } from './probes/iapCodeReference.js';
import { storeKitConfigProbe } from './probes/storeKitConfig.js';
import { subscriptionsProbe } from './probes/subscriptions.js';
import { iapPricingProbe } from './probes/iapPricing.js';
import { subscriptionOffersProbe } from './probes/subscriptionOffers.js';
import { sandboxTestersProbe } from './probes/sandboxTesters.js';
import { playAppProbe } from './probes/playApp.js';
import { playFirstUploadProbe } from './probes/playFirstUpload.js';
import { playInternalTrackProbe } from './probes/playInternalTrack.js';
import { ageRatingProbe } from './probes/ageRating.js';
import { listingUrlsProbe } from './probes/listingUrls.js';
import { accountDeletionProbe } from './probes/accountDeletion.js';
import { demoAccountProbe } from './probes/demoAccount.js';
import { profileEntitlementsProbe } from './probes/profileEntitlements.js';
import { screenshotsProbe } from './probes/screenshots.js';
/** Registered probes, keyed by id so re-registering one replaces it (idempotent built-in wiring). */
const PROBES = new Map<string, ReadinessProbe>();
export const registerReadinessProbe = (probe: ReadinessProbe): void => {
  PROBES.set(probe.id, probe);
};
export const listReadinessProbes = (): ReadinessProbe[] => {
  return [...PROBES.values()];
};
export const selectReadinessProbes = (category: ReadinessCategory): ReadinessProbe[] => {
  return listReadinessProbes().filter((probe) => probe.categories.includes(category));
};
export const registerBuiltinProbes = (): void => {
  registerReadinessProbe(agreementsProbe);
  registerReadinessProbe(appRecordProbe);
  registerReadinessProbe(subscriptionGroupProbe);
  registerReadinessProbe(bundleIdProbe);
  registerReadinessProbe(distributionCertProbe);
  registerReadinessProbe(exportComplianceProbe);
  registerReadinessProbe(iapProductsProbe);
  registerReadinessProbe(iapCodeReferenceProbe);
  registerReadinessProbe(storeKitConfigProbe);
  registerReadinessProbe(subscriptionsProbe);
  registerReadinessProbe(iapPricingProbe);
  registerReadinessProbe(subscriptionOffersProbe);
  registerReadinessProbe(sandboxTestersProbe);
  registerReadinessProbe(playAppProbe);
  registerReadinessProbe(playFirstUploadProbe);
  registerReadinessProbe(playInternalTrackProbe);
  registerReadinessProbe(ageRatingProbe);
  registerReadinessProbe(listingUrlsProbe);
  registerReadinessProbe(accountDeletionProbe);
  registerReadinessProbe(demoAccountProbe);
  registerReadinessProbe(profileEntitlementsProbe);
  registerReadinessProbe(screenshotsProbe);
};
