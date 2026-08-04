import { Effect } from 'effect';
import { errorMessage } from '@core/services/errorMessage.js';
import {
  reconcilePlaySubscriptions,
  type PlaySubscriptionsApi,
} from '@core/store/playSubscriptions.js';
import type { AppDescriptor } from '@core/types/app.js';
import type { SubscriptionConfig } from '@core/types/catalog.js';
import type { LaunchConfig } from '@core/types/config.js';
import type { AppPlan, PlanContext, SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan play-subscriptions`. */
const SURFACE = 'play-subscriptions';
/** One app's Play-subscriptions plan target: its package name paired with the declared Play-overridden subscriptions. */
type PlaySubscriptionsTarget = {
  app: string;
  packageName: string;
  subscriptions: SubscriptionConfig[];
};
/** Resolve the apps that declare at least one Play-overridden subscription, with their package + subscriptions. */
const targetsFor = (apps: AppDescriptor[], config: LaunchConfig): PlaySubscriptionsTarget[] => {
  const targets: PlaySubscriptionsTarget[] = [];
  for (const app of apps) {
    if (!app.packageName) continue;
    if (!app.bundleId) continue;
    let subscriptionGroups = config.products?.[app.bundleId]?.subscriptionGroups;
    if (subscriptionGroups === undefined) subscriptionGroups = [];
    const subscriptions = subscriptionGroups
      .flatMap((group) => group.subscriptions)
      .filter((subscription) => subscription.play);
    if (subscriptions.length === 0) continue;
    targets.push({ app: app.name, packageName: app.packageName, subscriptions });
  }
  return targets;
};
/** Plan one app's Play subscriptions in dry-run, capturing a precondition failure (e.g. unreachable app) as `error`. */
const planTarget = (
  api: PlaySubscriptionsApi,
  target: PlaySubscriptionsTarget,
): Effect.Effect<AppPlan> =>
  reconcilePlaySubscriptions(api, {
    packageName: target.packageName,
    subscriptions: target.subscriptions,
    dryRun: true,
  }).pipe(
    Effect.match({
      onSuccess: (report): AppPlan => ({
        app: target.app,
        identifier: target.packageName,
        actions: report.actions,
      }),
      onFailure: (reconciliationFailure): AppPlan => ({
        app: target.app,
        identifier: target.packageName,
        actions: [],
        error: errorMessage(reconciliationFailure),
      }),
    }),
  );
/**
 * The Play-subscriptions planner. Omits itself when no app declares a Play-overridden subscription; reports
 * a skip with an actionable hint when no Play service account is configured (the `--check` gate turns that
 * into an error); otherwise returns the per-app diff. Apps are planned concurrently and isolated - one
 * app's precondition failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const playSubscriptionsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'play',
  plan(planContext: PlanContext) {
    return Effect.gen(function* () {
      const targets = targetsFor(planContext.apps, planContext.config);
      if (targets.length === 0) return { surface: SURFACE, store: 'play', state: 'omitted' };
      const api = yield* planContext.resolvePlayApi();
      if (!api) {
        return {
          surface: SURFACE,
          store: 'play',
          state: 'skipped',
          reason: 'no Play service account',
          hint: 'run `launch creds set-key --platform android`',
        };
      }
      const apps = yield* Effect.forEach(targets, (target) => planTarget(api, target), {
        concurrency: 'unbounded',
      });
      return {
        surface: SURFACE,
        store: 'play',
        state: 'planned',
        scope: 'app',
        direction: 'two-way',
        apps,
      };
    });
  },
};
