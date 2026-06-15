/**
 * The Google Play subscriptions plan surface: the auto-renewable subscriptions a user declares under
 * `products[bundleId].subscriptionGroups[].subscriptions[]` that carry a `play` override (product + base
 * plan + offers). Runs the same reconciler as `launch play-subscriptions` ({@link reconcilePlaySubscriptions})
 * in dry-run, so the diff it reports is exactly what that command would apply — minus any writes.
 * Apple-only subscriptions (no `play` override) are filtered out, mirroring the command's gating.
 *
 * The catalog is keyed by iOS bundle id, so an app needs both a `packageName` (to reach Play) and a
 * `bundleId` (to locate its subscriptions); apps missing either, or with no Play-overridden subscription,
 * contribute nothing to this surface.
 */

import { reconcilePlaySubscriptions, type PlaySubscriptionsApi } from "../../playSubscriptions.js";
import type { AppDescriptor, LaunchConfig, SubscriptionConfig } from "../../types.js";
import type { AppPlan, PlanContext, SurfacePlan, SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan play-subscriptions`. */
const SURFACE = "play-subscriptions";

/** One app's Play-subscriptions plan target: its package name paired with the declared Play-overridden subscriptions. */
interface PlaySubscriptionsTarget {
  app: string;
  packageName: string;
  subscriptions: SubscriptionConfig[];
}

/** Resolve the apps that declare at least one Play-overridden subscription, with their package + subscriptions. */
function targetsFor(apps: AppDescriptor[], config: LaunchConfig): PlaySubscriptionsTarget[] {
  const targets: PlaySubscriptionsTarget[] = [];
  for (const app of apps) {
    if (!app.packageName || !app.bundleId) continue;
    const subscriptions = (config.products?.[app.bundleId]?.subscriptionGroups ?? [])
      .flatMap((group) => group.subscriptions)
      .filter((subscription) => subscription.play);
    if (subscriptions.length === 0) continue;
    targets.push({ app: app.name, packageName: app.packageName, subscriptions });
  }
  return targets;
}

/** Plan one app's Play subscriptions in dry-run, capturing a precondition failure (e.g. unreachable app) as `error`. */
async function planTarget(api: PlaySubscriptionsApi, target: PlaySubscriptionsTarget): Promise<AppPlan> {
  try {
    const report = await reconcilePlaySubscriptions(api, {
      packageName: target.packageName,
      subscriptions: target.subscriptions,
      dryRun: true,
    });
    return { app: target.app, identifier: target.packageName, actions: report.actions };
  } catch (error) {
    return {
      app: target.app,
      identifier: target.packageName,
      actions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The Play-subscriptions planner. Omits itself when no app declares a Play-overridden subscription; reports
 * a skip with an actionable hint when no Play service account is configured (the `--check` gate turns that
 * into an error); otherwise returns the per-app diff. Apps are planned concurrently and isolated — one
 * app's precondition failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const playSubscriptionsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "play",
  async plan(ctx: PlanContext): Promise<SurfacePlan> {
    const targets = targetsFor(ctx.apps, ctx.config);
    if (targets.length === 0) return { surface: SURFACE, store: "play", state: "omitted" };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return {
        surface: SURFACE,
        store: "play",
        state: "skipped",
        reason: "no Play service account",
        hint: "run `launch creds set-key --platform android`",
      };
    }

    const apps = await Promise.all(targets.map((target) => planTarget(api, target)));
    return { surface: SURFACE, store: "play", state: "planned", apps };
  },
};
