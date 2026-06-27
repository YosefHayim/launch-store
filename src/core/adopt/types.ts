/**
 * Shared vocabulary for `launch adopt` — the one-time **pull** that bootstraps Launch config from an
 * app that already ships (see `docs/adr/0002-adopt-existing-app.md`).
 *
 * Where `core/ascSync.ts` pushes declared config *up* to App Store Connect, adopt reads the live
 * account *down* into config. Each domain (products, capabilities, certs, listing) is a small
 * {@link Adopter} registered like a provider; the orchestrator walks the registry and runs one shared
 * plan→confirm→write. These types are the seam between the adopters, the registry, and the
 * orchestrator — kept here (not in `core/types.ts`) for the same reason `ascSync.ts` keeps its
 * `AscCatalogApi`/`PlannedAction` local: they describe the *adopt mechanism*, not a config shape.
 */

import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  CertificateResource,
  InAppPurchaseResource,
  LocalizationResource,
  MerchantIdResource,
  ProfileResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from '../../apple/ascClient.js';
import type { AppDescriptor, InAppPurchaseConfig, SubscriptionGroupConfig } from '../types.js';

/**
 * How faithfully a domain reverse-maps from App Store Connect into config, which drives plan rendering
 * and how loudly the orchestrator flags gaps:
 * - `importable` — a high-fidelity 1:1 import (products, listing copy).
 * - `advisory` — recoverable but lossy; some values can't be read and surface as {@link NEEDS_VALUE}
 *   (capabilities, whose identifier values come from the provisioning profile, not the API).
 * - `detect` — read-only; we report what exists and delegate the "add" elsewhere (certs/profiles, whose
 *   private key Apple never returns).
 */
export type Fidelity = 'importable' | 'advisory' | 'detect';

/**
 * The deliberately-invalid placeholder written for a value adopt couldn't recover (e.g. an app-group id
 * when the bundle has the capability enabled but no profile carried the concrete identifier). It is
 * invalid on purpose: a build fails loudly on it rather than silently shipping a broken entitlement, so
 * the developer is forced to fill it in. A clean `launch doctor` follow-up can flag it (see the ADR).
 */
export const NEEDS_VALUE = 'NEEDS_VALUE';

/** A JSON-compatible iOS entitlement value (string toggle, identifier array, boolean flag, nested dict). */
export type EntitlementValue =
  | string
  | number
  | boolean
  | null
  | EntitlementValue[]
  | { [key: string]: EntitlementValue };

/**
 * The read-only slice of the App Store Connect client the adopters depend on. Declared here (rather than
 * taking the concrete client) so each adopter unit-tests against a hand-rolled fake — exactly the pattern
 * `ascSync.ts`'s `AscCatalogApi` uses. `AppStoreConnectClient` satisfies it structurally. Read-only by
 * design: adopt never mutates App Store Connect (it writes local config), so no create/update methods
 * belong here.
 */
export interface AdoptCatalogApi {
  getAppId(bundleId: string): Promise<string | null>;
  getLatestMarketingVersion(bundleId: string): Promise<string | null>;
  getLatestBuildNumber(bundleId: string): Promise<number>;
  findBundleId(identifier: string): Promise<BundleIdResource | null>;
  listBundleIdCapabilities(bundleIdResourceId: string): Promise<BundleIdCapabilityResource[]>;
  listProfilesForBundleId(bundleIdResourceId: string): Promise<ProfileResource[]>;
  listMerchantIds(): Promise<MerchantIdResource[]>;
  listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]>;
  listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]>;
  inAppPurchaseHasPrice(iapId: string): Promise<boolean>;
  listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]>;
  listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]>;
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]>;
  listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]>;
  subscriptionHasPrice(subscriptionId: string): Promise<boolean>;
  listDistributionCertificates(): Promise<CertificateResource[]>;
}

/**
 * One app being adopted, resolved by the orchestrator before any adopter runs. `appId`/`bundleId` are
 * guaranteed present — detection only enqueues an app once its App Store Connect record resolves — so
 * adopters never re-resolve them or guard against null. `keyId` is the active account (the certs adopter
 * matches profiles against the keychain under it); `cwd` is where `launch.config.ts` lives.
 */
export interface AdoptTarget {
  /** The discovered app (its `app.json` bundle id, dir, config path, and current entitlements). */
  app: AppDescriptor;
  /** Resolved App Store Connect app id. */
  appId: string;
  /** The app's iOS bundle id (adopt is iOS-only). */
  bundleId: string;
  /** Active Apple account Key ID — namespaces the local signing index the certs adopter reads. */
  keyId: string;
  /** Directory holding `launch.config.ts` (the adopt run's working directory). */
  cwd: string;
  /** Whether a `launch.config.ts` already exists (fresh-write vs print-the-block). */
  hasLaunchConfig: boolean;
}

/** One imported product piece destined for `products[bundleId]` in `launch.config.ts`. */
export type ProductPiece =
  | { type: 'iap'; iap: InAppPurchaseConfig }
  | { type: 'subscriptionGroup'; group: SubscriptionGroupConfig };

/**
 * The concrete change a {@link PlannedWrite} carries, discriminated by its `home` (which file/store it
 * targets). The orchestrator groups writes by `home` to apply them coherently — products pieces merge
 * into one `products` block, entitlements merge into one `app.json` patch — which is why the change is
 * structured data rather than ascSync's apply-closure: a closure can't be aggregated across adopters.
 */
export type AdoptChange =
  | { home: 'launch.config'; bundleId: string; piece: ProductPiece }
  | { home: 'app.json'; configPath: string; key: string; value: EntitlementValue }
  | { home: 'store.config'; bundleId: string; configPath: string; appName: string }
  | { home: 'keychain' };

/**
 * One proposed change surfaced in the plan and (after confirm) applied. `description` is the plan line;
 * `note` is an advisory caveat shown beneath it (a {@link NEEDS_VALUE} gap, an un-imported price, an
 * off-Mac degrade). A write whose `change.home` is `keychain` is detect-only: it's reported, never
 * applied. Mirrors `ascSync.ts`'s `PlannedAction`, adapted from "write to ASC" to "write to local config".
 */
export interface PlannedWrite {
  description: string;
  fidelity: Fidelity;
  note?: string;
  change: AdoptChange;
}

/**
 * One domain's importer. Registered like a provider (see {@link import("./registry.js").registerAdopter});
 * the orchestrator resolves every registered adopter and calls {@link Adopter.read}, which is **read-only**
 * — it returns the writes it *would* make without touching disk, so the same call produces both the
 * dry-run plan and the apply work list. Adding `gameCenter` / `appClips` later is a new file + one
 * `registerAdopter()` line; the orchestrator is never touched.
 */
export interface Adopter {
  /** Stable domain key shown in the plan, e.g. `products`. */
  domain: string;
  /** The fidelity tier this domain imports at — for empty-state messaging and plan grouping. */
  fidelity: Fidelity;
  /** Read the live account for one app and return the writes it would make (no disk I/O). */
  read(asc: AdoptCatalogApi, target: AdoptTarget): Promise<PlannedWrite[]>;
}
