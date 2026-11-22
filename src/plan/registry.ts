import type { SurfacePlanner } from '../types/plan.ts';
import { accessibilityPlanner } from './planners/accessibility.ts';
import { appClipsPlanner } from './planners/appClips.ts';
import { availabilityPlanner } from './planners/availability.ts';
import { catalogPlanner } from './planners/catalog.ts';
import { customPagesPlanner } from './planners/customPages.ts';
import { euDistributionPlanner } from './planners/euDistribution.ts';
import { experimentsPlanner } from './planners/experiments.ts';
import { gameCenterPlanner } from './planners/gameCenter.ts';
import { listingPlanner } from './planners/listing.ts';
import { offersPlanner } from './planners/offers.ts';
import { playProductsPlanner } from './planners/playProducts.ts';
import { playSubscriptionsPlanner } from './planners/playSubscriptions.ts';
import { releaseConfigPlanner } from './planners/releaseConfig.ts';
import { screenshotsPlanner } from './planners/screenshots.ts';
import { walletPlanner } from './planners/wallet.ts';

/** Registered planners keyed by surface id; re-register replaces (idempotent wiring). */
const PLANNERS = new Map<string, SurfacePlanner>();

/** Built-in surfaces (catalog/listing/Play + v1.1 App Store breadth). */
const BUILTIN_PLANNERS: readonly SurfacePlanner[] = [
  catalogPlanner,
  listingPlanner,
  playProductsPlanner,
  playSubscriptionsPlanner,
  releaseConfigPlanner,
  gameCenterPlanner,
  appClipsPlanner,
  availabilityPlanner,
  accessibilityPlanner,
  experimentsPlanner,
  customPagesPlanner,
  walletPlanner,
  euDistributionPlanner,
  offersPlanner,
  screenshotsPlanner,
];

/** Register (or replace) a surface planner by its id. */
const registerSurfacePlanner = (planner: SurfacePlanner): void => {
  PLANNERS.set(planner.id, planner);
};

/** Every registered planner in registration order. */
export const listSurfacePlanners = (): SurfacePlanner[] => [...PLANNERS.values()];

/** Register built-in planners. Idempotent for command entry and tests. */
export const registerBuiltinPlanners = (): void => {
  for (const planner of BUILTIN_PLANNERS) {
    registerSurfacePlanner(planner);
  }
};
