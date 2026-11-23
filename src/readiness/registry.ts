import type { ReadinessCategory, ReadinessProbe } from '../types/readiness.ts';
import { agreementsProbe } from './probes/agreements.ts';
import { appRecordProbe } from './probes/app-record.ts';
import { subscriptionGroupProbe } from './probes/subscription-group.ts';
import { bundleIdProbe } from './probes/bundle-id.ts';
import { distributionCertProbe } from './probes/distribution-cert.ts';
import { exportComplianceProbe } from './probes/export-compliance.ts';
import { iapProductsProbe } from './probes/iap-products.ts';
import { iapCodeReferenceProbe } from './probes/iap-code-reference.ts';
import { storeKitConfigProbe } from './probes/store-kit-config.ts';
import { subscriptionsProbe } from './probes/subscriptions.ts';
import { iapPricingProbe } from './probes/iap-pricing.ts';
import { subscriptionOffersProbe } from './probes/subscription-offers.ts';
import { sandboxTestersProbe } from './probes/sandbox-testers.ts';
import { playAppProbe } from './probes/play-app.ts';
import { playFirstUploadProbe } from './probes/play-first-upload.ts';
import { playInternalTrackProbe } from './probes/play-internal-track.ts';
import { ageRatingProbe } from './probes/age-rating.ts';
import { listingUrlsProbe } from './probes/listing-urls.ts';
import { accountDeletionProbe } from './probes/account-deletion.ts';
import { demoAccountProbe } from './probes/demo-account.ts';
import { profileEntitlementsProbe } from './probes/profile-entitlements.ts';
import { screenshotsProbe } from './probes/screenshots.ts';
import { versionCopyrightProbe } from './probes/version-copyright.ts';
import { appPrivacyProbe } from './probes/app-privacy.ts';
/** Registered probes, keyed by id so re-registering one replaces it (idempotent built-in wiring). */
const PROBES = new Map<string, ReadinessProbe>();
export function registerReadinessProbe(probe: ReadinessProbe): void {
  PROBES.set(probe.id, probe);
}
export function listReadinessProbes(): ReadinessProbe[] {
  return [...PROBES.values()];
}
export function selectReadinessProbes(category: ReadinessCategory): ReadinessProbe[] {
  function isInCategory(probe: ReadinessProbe): boolean {
    return probe.categories.includes(category);
  }

  return listReadinessProbes().filter(isInCategory);
}
export function registerBuiltinProbes(): void {
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
  registerReadinessProbe(versionCopyrightProbe);
  registerReadinessProbe(appPrivacyProbe);
}
