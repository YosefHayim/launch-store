// Holds the planned diff of launch.config.ts against App Store Connect and Google Play.

import type { AppDescriptor } from './app.ts';
import type { LaunchConfig } from './config.ts';
import type { AscCatalogApi } from '@/apple/store/app-store-sync.js';
import type { PlannedAction } from './reconcile.ts';
import type { AscReleaseApi } from '../release/release-attributes.ts';
import type { AscGameCenterApi } from '@/apple/store/game-center.js';
import type { AscAppClipsApi } from '@/apple/store/app-clips.js';
import type { AscAvailabilityApi } from '@/apple/store/availability.js';
import type { AscAccessibilityApi } from '@/apple/store/accessibility.js';
import type { AscExperimentsApi } from '../release/version-experiments.ts';
import type { AscCustomPagesApi } from '@/apple/store/custom-product-pages.js';
import type { AscWalletApi } from '@/apple/store/wallet-ids.js';
import type { AscEuDistributionApi } from '@/apple/store/eu-distribution.js';
import type { AscOffersApi } from '@/apple/store/offers.js';
import type { PreviewsApi, ScreenshotsApi } from '@/apple/store/app-store-screenshots.js';
import type { PlayProductsApi } from '@/google/store/play-products.js';
import type { PlaySubscriptionsApi } from '@/google/store/play-subscriptions.js';

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
