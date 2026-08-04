import type { Effect } from 'effect';
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
} from './appleCatalog.js';
import type { AppDescriptor } from './app.js';
import type { InAppPurchaseConfig, SubscriptionGroupConfig } from './catalog.js';
/**
 * How faithfully a domain reverse-maps from App Store Connect into config, which drives plan rendering
 * and how loudly the orchestrator flags gaps:
 * - `importable` - a high-fidelity 1:1 import (products, listing copy).
 * - `advisory` - recoverable but lossy; some values can't be read and surface as
 *   {@link import("../adopt/capabilities.js").NEEDS_VALUE} (capabilities, whose identifier values come
 *   from the provisioning profile, not the API).
 * - `detect` - read-only; we report what exists and delegate the "add" elsewhere (certs/profiles, whose
 *   private key Apple never returns).
 */
export type Fidelity = 'importable' | 'advisory' | 'detect';
/** A JSON-compatible iOS entitlement value (string toggle, identifier array, boolean flag, nested dict). */
export type EntitlementValue =
  | string
  | number
  | boolean
  | null
  | EntitlementValue[]
  | Readonly<{
      [key: string]: EntitlementValue;
    }>;
/**
 * The read-only slice of the App Store Connect client the adopters depend on. Declared here (rather than
 * taking the concrete client) so each adopter unit-tests against a hand-rolled fake - exactly the pattern
 * `ascSync.ts`'s `AscCatalogApi` uses. `AppStoreConnectClient` satisfies it structurally. Read-only by
 * design: adopt never mutates App Store Connect (it writes local config), so no create/update methods
 * belong here.
 */
export type AdoptCatalogApi = Readonly<{
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  getLatestMarketingVersion(bundleId: string): Effect.Effect<string | null, unknown>;
  getLatestBuildNumber(bundleId: string): Effect.Effect<number, unknown>;
  findBundleId(identifier: string): Effect.Effect<BundleIdResource | null, unknown>;
  listBundleIdCapabilities(
    bundleIdResourceId: string,
  ): Effect.Effect<readonly BundleIdCapabilityResource[], unknown>;
  listProfilesForBundleId(
    bundleIdResourceId: string,
  ): Effect.Effect<readonly ProfileResource[], unknown>;
  listMerchantIds(): Effect.Effect<readonly MerchantIdResource[], unknown>;
  listInAppPurchases(appId: string): Effect.Effect<readonly InAppPurchaseResource[], unknown>;
  listInAppPurchaseLocalizations(
    iapId: string,
  ): Effect.Effect<readonly LocalizationResource[], unknown>;
  inAppPurchaseHasPrice(iapId: string): Effect.Effect<boolean, unknown>;
  listSubscriptionGroups(
    appId: string,
  ): Effect.Effect<readonly SubscriptionGroupResource[], unknown>;
  listSubscriptionGroupLocalizations(
    groupId: string,
  ): Effect.Effect<readonly LocalizationResource[], unknown>;
  listSubscriptions(groupId: string): Effect.Effect<readonly SubscriptionResource[], unknown>;
  listSubscriptionLocalizations(
    subscriptionId: string,
  ): Effect.Effect<readonly LocalizationResource[], unknown>;
  subscriptionHasPrice(subscriptionId: string): Effect.Effect<boolean, unknown>;
  listDistributionCertificates(): Effect.Effect<readonly CertificateResource[], unknown>;
}>;
/**
 * One app being adopted, resolved by the orchestrator before any adopter runs. `appId`/`bundleId` are
 * guaranteed present - detection only enqueues an app once its App Store Connect record resolves - so
 * adopters never re-resolve them or guard against null. `keyId` is the active account (the certs adopter
 * matches profiles against the keychain under it); `cwd` is where `launch.config.ts` lives.
 */
export type AdoptTarget = Readonly<{
  app: AppDescriptor;
  appId: string;
  bundleId: string;
  keyId: string;
  cwd: string;
  hasLaunchConfig: boolean;
}>;
/** One imported product piece destined for `products[bundleId]` in `launch.config.ts`. */
export type ProductPiece =
  | Readonly<{
      type: 'iap';
      iap: InAppPurchaseConfig;
    }>
  | Readonly<{
      type: 'subscriptionGroup';
      group: SubscriptionGroupConfig;
    }>;
/**
 * The concrete change a {@link PlannedWrite} carries, discriminated by its `home` (which file/store it
 * targets). The orchestrator groups writes by `home` to apply them coherently - products pieces merge
 * into one `products` block, entitlements merge into one `app.json` patch - which is why the change is
 * structured data rather than ascSync's apply-closure: a closure can't be aggregated across adopters.
 */
export type AdoptChange =
  | Readonly<{
      home: 'launch.config';
      bundleId: string;
      piece: ProductPiece;
    }>
  | Readonly<{
      home: 'app.json';
      configPath: string;
      key: string;
      value: EntitlementValue;
    }>
  | Readonly<{
      home: 'store.config';
      bundleId: string;
      configPath: string;
      appName: string;
    }>
  | Readonly<{
      home: 'keychain';
    }>;
/**
 * One proposed change surfaced in the plan and (after confirm) applied. `description` is the plan line;
 * `note` is an advisory caveat shown beneath it (a {@link import("../adopt/capabilities.js").NEEDS_VALUE}
 * gap, an un-imported price, an off-Mac degrade). A write whose `change.home` is `keychain` is
 * detect-only: it's reported, never applied. Mirrors `ascSync.ts`'s `PlannedAction`, adapted from
 * "write to ASC" to "write to local config".
 */
export type PlannedWrite = Readonly<{
  description: string;
  fidelity: Fidelity;
  note?: string;
  change: AdoptChange;
}>;
/**
 * One domain's importer. Registered like a provider (see
 * {@link import("../adopt/registry.js").registerAdopter}); the orchestrator resolves every registered
 * adopter and calls {@link Adopter.read}, which is **read-only** - it returns the writes it *would* make
 * without touching disk, so the same call produces both the dry-run plan and the apply work list. Adding
 * `gameCenter` / `appClips` later is a new file + one `registerAdopter()` line; the orchestrator is never
 * touched.
 */
export type Adopter<Requirements = never> = {
  domain: string;
  fidelity: Fidelity;
  read(
    asc: AdoptCatalogApi,
    target: AdoptTarget,
  ): Effect.Effect<PlannedWrite[], unknown, Requirements>;
};
