// Holds the planned diff of launch.config.ts against App Store Connect and Google Play.

import type { AppDescriptor } from './app.ts';
import type { LaunchConfig } from './config.ts';
import type { AscCatalogApi } from '../store/apple/app-store-sync.ts';
import type { PlannedAction } from './reconcile.ts';
import type { AscReleaseApi } from '../release/release-attributes.ts';
import type { AscGameCenterApi } from '../store/apple/game-center.ts';
import type { AscAppClipsApi } from '../store/apple/app-clips.ts';
import type { AscAvailabilityApi } from '../store/apple/availability.ts';
import type { AscAccessibilityApi } from '../store/apple/accessibility.ts';
import type { AscExperimentsApi } from '../release/version-experiments.ts';
import type { AscCustomPagesApi } from '../store/apple/custom-product-pages.ts';
import type { AscWalletApi } from '../store/apple/wallet-ids.ts';
import type { AscEuDistributionApi } from '../store/apple/eu-distribution.ts';
import type { AscOffersApi } from '../store/apple/offers.ts';
import type { PreviewsApi, ScreenshotsApi } from '../store/apple/app-store-screenshots.ts';
import type { PlayProductsApi } from '../store/google/play-products.ts';
import type { PlaySubscriptionsApi } from '../store/google/play-subscriptions.ts';

/** Which store a surface belongs to - drives credential resolution and how the diff is grouped. */
export type PlanStore = 'appstore' | 'play';

/** The read surface of the Google Play catalog the Play planners share */
export type PlayCatalogApi = PlayProductsApi & PlaySubscriptionsApi;

/** The full read surface of App Store Connect the App Store planners share */
export type AscSurfacesApi = AscCatalogApi &
  AscReleaseApi &
  AscGameCenterApi &
  AscAppClipsApi &
  AscAvailabilityApi &
  AscAccessibilityApi &
  AscExperimentsApi &
  AscCustomPagesApi &
  AscWalletApi &
  AscEuDistributionApi &
  AscOffersApi &
  ScreenshotsApi &
  PreviewsApi;

/** One app's slice of a surface's plan. */
export type AppPlan = Readonly<{
  app: string;
  identifier: string;
  actions: readonly PlannedAction[];
  error?: string;
}>;

/** How completely a surface detects drift */
export type PlanDirection = 'two-way' | 'additive';

/** The outcome of running one surface planner. */
export type SurfacePlan =
  | Readonly<{
      surface: string;
      store: PlanStore;
      state: 'omitted';
    }>
  | Readonly<{
      surface: string;
      store: PlanStore;
      state: 'skipped';
      reason: string;
      hint?: string;
    }>
  | Readonly<{
      surface: string;
      store: PlanStore;
      state: 'planned';
      scope: 'app';
      direction: PlanDirection;
      apps: readonly AppPlan[];
    }>
  | Readonly<{
      surface: string;
      store: PlanStore;
      state: 'planned';
      scope: 'team';
      direction: PlanDirection;
      actions: readonly PlannedAction[];
    }>;

/** What a {@link SurfacePlanner} is handed */
export type PlanContext = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  /** Directory of the launch.config.ts that supplied `config`, when one was loaded. */
  configDirectory?: string | null;

  resolveAscApi(): Promise<AscSurfacesApi | null>;

  resolvePlayApi(packageName?: string): Promise<PlayCatalogApi | null>;
}>;

/** One config-as-code surface's planner. */
export type SurfacePlanner = Readonly<{
  id: string;
  store: PlanStore;

  plan(planContext: PlanContext): Promise<SurfacePlan>;
}>;
