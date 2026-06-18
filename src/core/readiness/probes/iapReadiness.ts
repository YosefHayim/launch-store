/**
 * Shared grading for the two IAP probes (`apple-iap-products`, `apple-subscriptions`): both ask the same
 * question of a declared product — does it exist on App Store Connect, and if so is it actually submittable?
 * Apple answers the second part itself via the resource's lifecycle `state`, so this helper trusts that
 * signal rather than re-deriving readiness from localizations + price. Keeping it in one place means both
 * probes classify identically and a change to "what counts as not-ready" lands once.
 */

import type { AppProducts } from "../../types.js";

/**
 * Every Apple product id one app declares: its one-off in-app purchases plus every subscription across all
 * of its subscription groups. The file-based IAP probes (`apple-iap-code-reference`, `apple-storekit-config`)
 * ask their question of the whole catalog, so they share this flattening rather than each re-walking the
 * `inAppPurchases` + `subscriptionGroups` shape. Returns `[]` when the app declares no products.
 */
export function declaredAppleProductIds(products: AppProducts | undefined): string[] {
  if (!products) return [];
  const purchases = (products.inAppPurchases ?? []).map((purchase) => purchase.productId);
  const subscriptions = (products.subscriptionGroups ?? []).flatMap((group) =>
    group.subscriptions.map((subscription) => subscription.productId),
  );
  return [...purchases, ...subscriptions];
}

/**
 * The lifecycle state Apple reports for a product still missing required metadata (a name, a price, or a
 * localization). It's the canonical "you started this product but never finished it" signal and the one
 * thing that silently keeps a product out of a submission, so it's the blocking state we grade on. Other
 * states (`READY_TO_SUBMIT`, `WAITING_FOR_REVIEW`, `APPROVED`, …) mean the product is at least submittable
 * and pass through informationally.
 */
const MISSING_METADATA = "MISSING_METADATA";

/** A `checked` finding's status + copy, without the per-app fields the probe stamps on. */
export interface ProductGrade {
  status: "ok" | "blocker";
  detail: string;
  hint?: string;
}

/**
 * Grade one declared product against its live App Store Connect counterpart (or `undefined` when absent).
 *
 * @param productId Apple product id the config declares — used verbatim in the human-readable detail.
 * @param live      The matching live product (by `productId`), or `undefined` when it doesn't exist yet.
 * @param kind      Whether this is an in-app purchase or a subscription, for accurate copy.
 */
export function gradeDeclaredProduct(
  productId: string,
  live: { state?: string | undefined } | undefined,
  kind: "in-app purchase" | "subscription",
): ProductGrade {
  if (!live) {
    return {
      status: "blocker",
      detail: `${productId}: declared but not on App Store Connect`,
      hint: `run \`launch sync\` to create the ${kind}`,
    };
  }
  if (live.state === MISSING_METADATA) {
    return {
      status: "blocker",
      detail: `${productId}: missing metadata (name, price, or localization)`,
      hint: "run `launch sync` to fill it in, or complete it in App Store Connect",
    };
  }
  return { status: "ok", detail: `${productId}: ${live.state ?? "present"}` };
}
