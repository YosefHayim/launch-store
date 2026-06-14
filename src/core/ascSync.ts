/**
 * The `launch sync` reconciler: bring one app's App Store Connect product catalog (capabilities,
 * in-app purchases, subscriptions, and pricing) in line with the declared desired state.
 *
 * Design (decided in the design interview):
 * - **Declarative & stateless.** No local state file; every run reads the live account and matches
 *   declared↔actual on Apple's natural keys (`productId`, capability type, `locale`, group reference
 *   name). What you declare is the source of truth; reality is re-read each run, so it never drifts.
 * - **Additive by default.** Missing resources are created; existing ones are left untouched (we never
 *   overwrite copy you've edited in the UI). The one destructive action — removing a capability that's
 *   on Apple but not declared — is recorded but skipped unless `allowDestructive` is set.
 * - **Plan, then apply.** The same walk runs twice from the command: once with `dryRun` to produce the
 *   plan (read-only — it still GETs current state, but performs no writes), and once for real after the
 *   user confirms. Each write is isolated: a failure is captured on its action and the walk continues,
 *   so one bad product never aborts the rest. This mirrors the `core/metadata` dry-run convention.
 *
 * Scope boundary: we set up products to clear name/price "Missing Metadata", but a product still needs
 * a review screenshot (a chunked upload) before it's fully submittable — that's a deliberate follow-up.
 * Textual store-listing copy is reconciled natively here (see {@link reconcileListing}) from the same
 * `store.config.json` `launch metadata` uses; screenshots/previews stay with `launch metadata` (fastlane).
 */

import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  InAppPurchaseResource,
  ListingLocalization,
  LocalizationResource,
  PricePointResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from "../apple/ascClient.js";
import type { CapabilityType } from "./capabilities.js";
import type { AppleLocaleInfo, AppleStoreConfig } from "./storeConfig.js";
import type { AppProducts, InAppPurchaseConfig, SubscriptionConfig } from "./types.js";

/**
 * The exact slice of {@link AppStoreConnectClient} the reconciler depends on. Declaring it here (rather
 * than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake and
 * documents the client's reconcile surface in one place. `AppStoreConnectClient` satisfies it structurally.
 */
export interface AscCatalogApi {
  getAppId(bundleId: string): Promise<string | null>;
  findBundleId(identifier: string): Promise<BundleIdResource | null>;
  listBundleIdCapabilities(bundleIdResourceId: string): Promise<BundleIdCapabilityResource[]>;
  enableCapability(bundleIdResourceId: string, capabilityType: string): Promise<BundleIdCapabilityResource>;
  disableCapability(capabilityId: string): Promise<void>;
  listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]>;
  createInAppPurchase(
    appId: string,
    input: { productId: string; name: string; inAppPurchaseType: string },
  ): Promise<InAppPurchaseResource>;
  listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]>;
  createInAppPurchaseLocalization(
    iapId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource>;
  inAppPurchaseHasPrice(iapId: string): Promise<boolean>;
  findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null>;
  createInAppPurchasePriceSchedule(iapId: string, baseTerritory: string, pricePointId: string): Promise<void>;
  listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]>;
  createSubscriptionGroup(appId: string, referenceName: string): Promise<SubscriptionGroupResource>;
  listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]>;
  createSubscriptionGroupLocalization(
    groupId: string,
    input: { locale: string; name: string },
  ): Promise<LocalizationResource>;
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]>;
  createSubscription(
    groupId: string,
    input: { productId: string; name: string; subscriptionPeriod: string; groupLevel: number },
  ): Promise<SubscriptionResource>;
  listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]>;
  createSubscriptionLocalization(
    subscriptionId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource>;
  subscriptionHasPrice(subscriptionId: string): Promise<boolean>;
  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null>;
  createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void>;
  getEditableAppInfoId(appId: string): Promise<string | null>;
  listAppInfoLocalizations(appInfoId: string): Promise<ListingLocalization[]>;
  createAppInfoLocalization(appInfoId: string, locale: string, fields: Record<string, string>): Promise<void>;
  updateAppInfoLocalization(localizationId: string, fields: Record<string, string>): Promise<void>;
  getEditableVersionId(appId: string): Promise<string | null>;
  listVersionLocalizations(versionId: string): Promise<ListingLocalization[]>;
  createVersionLocalization(versionId: string, locale: string, fields: Record<string, string>): Promise<void>;
  updateVersionLocalization(localizationId: string, fields: Record<string, string>): Promise<void>;
}

/** Where an action ended up: planned (dry-run), or applied / skipped / failed after a real run. */
export type ActionStatus = "planned" | "applied" | "skipped" | "failed";

/** One unit of reconcile work — created, then displayed in the plan and (after apply) in the summary. */
export interface PlannedAction {
  /** Human-readable line, e.g. `create subscription com.acme.pro (ONE_MONTH)`. */
  description: string;
  /** Whether this removes/risks data; gated behind `allowDestructive`. */
  destructive: boolean;
  /** Lifecycle: `planned` in dry-run; `applied`/`skipped`/`failed` after an apply pass. */
  status: ActionStatus;
  /** Apple's error detail when {@link PlannedAction.status} is `failed`. */
  error?: string;
}

/** Inputs to reconcile one app. */
export interface ReconcileInput {
  /** The app's iOS bundle id — resolves both the ASC app record and the bundle-id (App ID) resource. */
  bundleId: string;
  /** Capabilities to enable, derived from `app.json` entitlements (see {@link mapEntitlementsToCapabilities}). */
  capabilities: CapabilityType[];
  /** The declared product catalog for this app. */
  products: AppProducts;
  /**
   * The app's declared App Store listing (`store.config.json`'s `apple` section). Present → reconcile
   * per-locale textual metadata natively (name/subtitle/privacy URL at the app level; description,
   * keywords, what's new, promo, URLs at the version level). Absent → listing is left untouched.
   */
  listing?: AppleStoreConfig;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
  /** Permit destructive actions (capability removal). Off by default. */
  allowDestructive: boolean;
}

/** The result of reconciling one app: its bundle id and every action planned/performed, in order. */
export interface ReconcileReport {
  bundleId: string;
  actions: PlannedAction[];
}

/** Default base territory for price-point resolution when a {@link ProductPrice} doesn't name one. */
const DEFAULT_TERRITORY = "USA";

/** Placeholder id for a resource that doesn't exist yet during a dry-run (its create closures never run). */
const DRY_RUN_ID = "(dry-run)";

/**
 * Capabilities Apple enables on every App ID and won't let you remove. We must never propose disabling
 * them just because they aren't declared, or every sync would surface a no-op destructive action.
 */
const ALWAYS_ENABLED_CAPABILITIES = new Set<string>(["IN_APP_PURCHASE", "GAME_CENTER"]);

/** Mutable per-run context threaded through the reconcile walk. */
interface ReconcileContext {
  api: AscCatalogApi;
  actions: PlannedAction[];
  dryRun: boolean;
  allowDestructive: boolean;
}

/** True once an action reached a terminal "this work happened (or was meant to)" state we can build on. */
function succeededOrPlanned(status: ActionStatus): boolean {
  return status === "applied" || status === "planned";
}

/**
 * Record an action and, unless this is a dry-run, perform it. Destructive actions are recorded but not
 * run without `allowDestructive`. A thrown error is captured on the action (status `failed`) rather than
 * propagated, so the surrounding walk keeps going. Returns the terminal status plus the run's value
 * (the created resource), which is `undefined` on a dry-run or failure — callers fall back to
 * {@link DRY_RUN_ID} for the id of a not-yet-created parent.
 */
async function act<T>(
  ctx: ReconcileContext,
  description: string,
  destructive: boolean,
  run: () => Promise<T>,
): Promise<{ status: ActionStatus; value?: T }> {
  const action: PlannedAction = { description, destructive, status: "planned" };
  ctx.actions.push(action);
  if (ctx.dryRun) return { status: action.status };
  if (destructive && !ctx.allowDestructive) {
    action.status = "skipped";
    return { status: "skipped" };
  }
  try {
    const value = await run();
    action.status = "applied";
    return { status: "applied", value };
  } catch (error) {
    action.status = "failed";
    action.error = error instanceof Error ? error.message : String(error);
    return { status: "failed" };
  }
}

/**
 * Reconcile one app end to end, in dependency order: capabilities first (a build prerequisite), then
 * in-app purchases, then subscription groups and their subscriptions. Throws only for a precondition
 * the user must fix (no ASC app record) — Apple has no API to create the app record, so that one step
 * stays manual; everything else is captured per-action.
 */
export async function reconcileApp(api: AscCatalogApi, input: ReconcileInput): Promise<ReconcileReport> {
  const ctx: ReconcileContext = {
    api,
    actions: [],
    dryRun: input.dryRun,
    allowDestructive: input.allowDestructive,
  };

  const appId = await api.getAppId(input.bundleId);
  if (!appId) {
    throw new Error(
      `No App Store Connect app record for ${input.bundleId}. Create the app once in App Store Connect ` +
        `(Apple has no API to create the app record), then re-run \`launch sync\`.`,
    );
  }

  await reconcileCapabilities(ctx, input.bundleId, input.capabilities);
  await reconcileInAppPurchases(ctx, appId, input.products.inAppPurchases ?? []);
  await reconcileSubscriptionGroups(ctx, appId, input.products.subscriptionGroups ?? []);
  if (input.listing) await reconcileListing(ctx, appId, input.listing);

  return { bundleId: input.bundleId, actions: ctx.actions };
}

/** Enable declared capabilities that aren't on yet; (destructively) remove undeclared extras. */
async function reconcileCapabilities(
  ctx: ReconcileContext,
  bundleId: string,
  desired: CapabilityType[],
): Promise<void> {
  const resource = await ctx.api.findBundleId(bundleId);
  if (!resource) {
    if (desired.length > 0) {
      ctx.actions.push({
        description: `bundle id ${bundleId} is not registered yet — run a build (or \`launch creds\`) to register it before syncing ${desired.length} capabilit${desired.length === 1 ? "y" : "ies"}`,
        destructive: false,
        status: "skipped",
      });
    }
    return;
  }

  const current = await ctx.api.listBundleIdCapabilities(resource.id);
  const currentTypes = new Set(current.map((capability) => capability.capabilityType));
  for (const capability of desired) {
    if (currentTypes.has(capability)) continue;
    await act(ctx, `enable capability ${capability}`, false, () => ctx.api.enableCapability(resource.id, capability));
  }

  const desiredTypes = new Set<string>(desired);
  for (const capability of current) {
    if (desiredTypes.has(capability.capabilityType) || ALWAYS_ENABLED_CAPABILITIES.has(capability.capabilityType)) {
      continue;
    }
    await act(ctx, `disable capability ${capability.capabilityType}`, true, () =>
      ctx.api.disableCapability(capability.id),
    );
  }
}

/** Create missing in-app purchases, fill in localizations, and set an initial price. */
async function reconcileInAppPurchases(
  ctx: ReconcileContext,
  appId: string,
  desired: InAppPurchaseConfig[],
): Promise<void> {
  if (desired.length === 0) return;
  const current = await ctx.api.listInAppPurchases(appId);

  for (const iap of desired) {
    const match = current.find((existing) => existing.productId === iap.productId);
    let iapId: string;
    let existingLocales: Set<string>;
    let priced: boolean;

    if (match) {
      iapId = match.id;
      const locales = await ctx.api.listInAppPurchaseLocalizations(iapId);
      existingLocales = new Set(locales.map((localization) => localization.locale));
      priced = await ctx.api.inAppPurchaseHasPrice(iapId);
    } else {
      const created = await act(ctx, `create in-app purchase ${iap.productId} (${iap.type})`, false, () =>
        ctx.api.createInAppPurchase(appId, {
          productId: iap.productId,
          name: iap.referenceName,
          inAppPurchaseType: iap.type,
        }),
      );
      if (!succeededOrPlanned(created.status)) continue;
      iapId = created.value?.id ?? DRY_RUN_ID;
      existingLocales = new Set();
      priced = false;
    }

    for (const localization of iap.localizations) {
      if (existingLocales.has(localization.locale)) continue;
      await act(ctx, `add IAP copy ${iap.productId} [${localization.locale}]`, false, () =>
        ctx.api.createInAppPurchaseLocalization(iapId, localization),
      );
    }

    if (iap.price && !priced) {
      const territory = iap.price.baseTerritory ?? DEFAULT_TERRITORY;
      const customerPrice = iap.price.customerPrice;
      await act(ctx, `set IAP price ${iap.productId} = ${customerPrice} (${territory})`, false, async () => {
        const point = await ctx.api.findInAppPurchasePricePoint(iapId, territory, customerPrice);
        if (!point) throw new Error(`No ${territory} price point matches ${customerPrice} for ${iap.productId}.`);
        await ctx.api.createInAppPurchasePriceSchedule(iapId, territory, point.id);
      });
    }
  }
}

/** Create missing subscription groups, their display names, and the subscriptions within them. */
async function reconcileSubscriptionGroups(
  ctx: ReconcileContext,
  appId: string,
  desired: AppProducts["subscriptionGroups"] = [],
): Promise<void> {
  if (desired.length === 0) return;
  const current = await ctx.api.listSubscriptionGroups(appId);

  for (const group of desired) {
    const match = current.find((existing) => existing.referenceName === group.referenceName);
    let groupId: string;
    let existingGroupLocales: Set<string>;
    let existingSubs: SubscriptionResource[];

    if (match) {
      groupId = match.id;
      const locales = await ctx.api.listSubscriptionGroupLocalizations(groupId);
      existingGroupLocales = new Set(locales.map((localization) => localization.locale));
      existingSubs = await ctx.api.listSubscriptions(groupId);
    } else {
      const created = await act(ctx, `create subscription group "${group.referenceName}"`, false, () =>
        ctx.api.createSubscriptionGroup(appId, group.referenceName),
      );
      if (!succeededOrPlanned(created.status)) continue;
      groupId = created.value?.id ?? DRY_RUN_ID;
      existingGroupLocales = new Set();
      existingSubs = [];
    }

    for (const localization of group.localizations) {
      if (existingGroupLocales.has(localization.locale)) continue;
      await act(ctx, `add group name "${group.referenceName}" [${localization.locale}]`, false, () =>
        ctx.api.createSubscriptionGroupLocalization(groupId, localization),
      );
    }

    // Config order is the level ranking: the first subscription is the top level (1), the next is 2…
    for (const [index, subscription] of group.subscriptions.entries()) {
      await reconcileSubscription(ctx, groupId, existingSubs, subscription, index + 1);
    }
  }
}

/** Create one subscription (if missing), its localizations, and its initial price. */
async function reconcileSubscription(
  ctx: ReconcileContext,
  groupId: string,
  existingSubs: SubscriptionResource[],
  subscription: SubscriptionConfig,
  groupLevel: number,
): Promise<void> {
  const match = existingSubs.find((existing) => existing.productId === subscription.productId);
  let subscriptionId: string;
  let existingLocales: Set<string>;
  let priced: boolean;

  if (match) {
    subscriptionId = match.id;
    const locales = await ctx.api.listSubscriptionLocalizations(subscriptionId);
    existingLocales = new Set(locales.map((localization) => localization.locale));
    priced = await ctx.api.subscriptionHasPrice(subscriptionId);
  } else {
    const created = await act(
      ctx,
      `create subscription ${subscription.productId} (${subscription.subscriptionPeriod})`,
      false,
      () =>
        ctx.api.createSubscription(groupId, {
          productId: subscription.productId,
          name: subscription.referenceName,
          subscriptionPeriod: subscription.subscriptionPeriod,
          groupLevel,
        }),
    );
    if (!succeededOrPlanned(created.status)) return;
    subscriptionId = created.value?.id ?? DRY_RUN_ID;
    existingLocales = new Set();
    priced = false;
  }

  for (const localization of subscription.localizations) {
    if (existingLocales.has(localization.locale)) continue;
    await act(ctx, `add subscription copy ${subscription.productId} [${localization.locale}]`, false, () =>
      ctx.api.createSubscriptionLocalization(subscriptionId, localization),
    );
  }

  if (subscription.price && !priced) {
    const territory = subscription.price.baseTerritory ?? DEFAULT_TERRITORY;
    const customerPrice = subscription.price.customerPrice;
    await act(
      ctx,
      `set subscription price ${subscription.productId} = ${customerPrice} (${territory})`,
      false,
      async () => {
        const point = await ctx.api.findSubscriptionPricePoint(subscriptionId, territory, customerPrice);
        if (!point)
          throw new Error(`No ${territory} price point matches ${customerPrice} for ${subscription.productId}.`);
        await ctx.api.createSubscriptionPrice(subscriptionId, point.id);
      },
    );
  }
}

/**
 * Maximum character lengths Apple enforces on the listing fields Launch writes. A value over the limit
 * is rejected at the boundary (recorded as a skipped action) rather than sent for Apple to bounce.
 */
const LISTING_LIMITS: Record<string, number> = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  promotionalText: 170,
  description: 4000,
  whatsNew: 4000,
};

/** Which localization level a set of fields belongs to — used only for readable plan lines. */
type ListingLevel = "appInfo" | "version";

/** The result of routing one locale's config into the two App Store Connect localization levels. */
interface RoutedListing {
  /** App-level fields (`appInfoLocalizations`): name, subtitle, privacy URL — persist across versions. */
  appInfo: Record<string, string>;
  /** Version-level fields (`appStoreVersionLocalizations`): description, keywords, what's new, promo, URLs. */
  version: Record<string, string>;
}

/**
 * Route one locale's `store.config.json` listing into the app-level and version-level field sets,
 * translating field names to Apple's (`title`→`name`, `releaseNotes`→`whatsNew`) and joining keywords
 * into the comma-separated string Apple stores. Only present, non-empty values are carried over.
 */
function routeListing(info: AppleLocaleInfo): RoutedListing {
  const appInfo: Record<string, string> = {};
  if (info.title) appInfo["name"] = info.title;
  if (info.subtitle) appInfo["subtitle"] = info.subtitle;
  if (info.privacyPolicyUrl) appInfo["privacyPolicyUrl"] = info.privacyPolicyUrl;

  const version: Record<string, string> = {};
  if (info.description) version["description"] = info.description;
  if (info.keywords && info.keywords.length > 0) version["keywords"] = info.keywords.join(",");
  if (info.releaseNotes) version["whatsNew"] = info.releaseNotes;
  if (info.promotionalText) version["promotionalText"] = info.promotionalText;
  if (info.supportUrl) version["supportUrl"] = info.supportUrl;
  if (info.marketingUrl) version["marketingUrl"] = info.marketingUrl;

  return { appInfo, version };
}

/** Split a field set into the ones within Apple's length limits and human errors for the rest. */
function validateListing(fields: Record<string, string>): { valid: Record<string, string>; errors: string[] } {
  const valid: Record<string, string> = {};
  const errors: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const limit = LISTING_LIMITS[key];
    if (limit !== undefined && value.length > limit) {
      errors.push(`${key} is ${value.length} chars (max ${limit})`);
    } else {
      valid[key] = value;
    }
  }
  return { valid, errors };
}

/** The subset of `desired` whose value differs from what's already stored — i.e. what a PATCH must send. */
function changedFields(desired: Record<string, string>, current: Record<string, string>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (current[key] !== value) changed[key] = value;
  }
  return changed;
}

/** Render a field as a short quoted preview for the plan, or `∅` when previously unset. */
function preview(value: string | undefined): string {
  if (value === undefined) return "∅";
  return `"${value.length > 24 ? `${value.slice(0, 24)}…` : value}"`;
}

/** Describe field changes as `key ∅→"new", key2 "old"→"new"` for the dry-run plan (old→new per field). */
function describeChanges(changed: Record<string, string>, current: Record<string, string>): string {
  return Object.keys(changed)
    .map((key) => `${key} ${preview(current[key])}→${preview(changed[key])}`)
    .join(", ");
}

/** Human label for a localization level in plan lines. */
function levelLabel(level: ListingLevel): string {
  return level === "appInfo" ? "App Info" : "App Store version";
}

/** Operations + current state for reconciling one locale at one localization level. */
interface LevelReconcile {
  level: ListingLevel;
  locale: string;
  /** Desired fields for this level (already routed; not yet length-validated). */
  desired: Record<string, string>;
  /** The editable parent id (appInfo / version), or null when none is editable. */
  parentId: string | null;
  /** The existing localization for this locale, if Apple already has one. */
  current: ListingLocalization | undefined;
  /** Field Apple requires to *create* the locale (the app-level `name`); omit when none. */
  requiredKey?: string;
  create: (parentId: string, fields: Record<string, string>) => Promise<void>;
  update: (localizationId: string, fields: Record<string, string>) => Promise<void>;
}

/** Reconcile one locale at one level: validate lengths, then create the locale or patch changed fields. */
async function reconcileLevel(ctx: ReconcileContext, ops: LevelReconcile): Promise<void> {
  const { valid, errors } = validateListing(ops.desired);
  for (const error of errors) {
    ctx.actions.push({
      description: `listing [${ops.locale}] ${levelLabel(ops.level)}: ${error} — skipped`,
      destructive: false,
      status: "skipped",
    });
  }
  if (Object.keys(valid).length === 0) return;

  const parentId = ops.parentId;
  if (!parentId) {
    ctx.actions.push({
      description: `listing [${ops.locale}] ${levelLabel(ops.level)}: no editable ${levelLabel(ops.level)} to update — prepare one in App Store Connect`,
      destructive: false,
      status: "skipped",
    });
    return;
  }

  if (ops.current) {
    const changed = changedFields(valid, ops.current.fields);
    if (Object.keys(changed).length === 0) return;
    const { id, fields } = ops.current;
    await act(
      ctx,
      `update listing [${ops.locale}] ${levelLabel(ops.level)}: ${describeChanges(changed, fields)}`,
      false,
      () => ops.update(id, changed),
    );
    return;
  }

  if (ops.requiredKey && !(ops.requiredKey in valid)) {
    ctx.actions.push({
      description: `listing [${ops.locale}] ${levelLabel(ops.level)}: needs ${ops.requiredKey} to create the locale — skipped`,
      destructive: false,
      status: "skipped",
    });
    return;
  }
  await act(
    ctx,
    `create listing [${ops.locale}] ${levelLabel(ops.level)}: ${Object.keys(valid).join(", ")}`,
    false,
    () => ops.create(parentId, valid),
  );
}

/**
 * Reconcile the app's textual store listing per locale, at both levels: app-level (`appInfoLocalizations`
 * — name/subtitle/privacy URL) and version-level (`appStoreVersionLocalizations` — description, keywords,
 * what's new, promo text, URLs). Resolves the editable appInfo + App Store version once, then for each
 * declared locale patches only the fields that differ (or creates the locale when Apple lacks it). When
 * no editable target exists, the affected fields are recorded as skipped with guidance.
 */
async function reconcileListing(ctx: ReconcileContext, appId: string, listing: AppleStoreConfig): Promise<void> {
  const locales = Object.entries(listing.info);
  if (locales.length === 0) return;

  const appInfoId = await ctx.api.getEditableAppInfoId(appId);
  const versionId = await ctx.api.getEditableVersionId(appId);
  const appInfoLocales = appInfoId ? await ctx.api.listAppInfoLocalizations(appInfoId) : [];
  const versionLocales = versionId ? await ctx.api.listVersionLocalizations(versionId) : [];
  const appInfoByLocale = new Map(appInfoLocales.map((localization) => [localization.locale, localization]));
  const versionByLocale = new Map(versionLocales.map((localization) => [localization.locale, localization]));

  for (const [locale, info] of locales) {
    const routed = routeListing(info);
    await reconcileLevel(ctx, {
      level: "appInfo",
      locale,
      desired: routed.appInfo,
      parentId: appInfoId,
      current: appInfoByLocale.get(locale),
      requiredKey: "name",
      create: (parentId, fields) => ctx.api.createAppInfoLocalization(parentId, locale, fields),
      update: (id, fields) => ctx.api.updateAppInfoLocalization(id, fields),
    });
    await reconcileLevel(ctx, {
      level: "version",
      locale,
      desired: routed.version,
      parentId: versionId,
      current: versionByLocale.get(locale),
      create: (parentId, fields) => ctx.api.createVersionLocalization(parentId, locale, fields),
      update: (id, fields) => ctx.api.updateVersionLocalization(id, fields),
    });
  }
}
