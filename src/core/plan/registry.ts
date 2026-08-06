import type { SurfacePlanner } from '../types/plan.js';
import { accessibilityPlanner } from './planners/accessibility.js';
import { appClipsPlanner } from './planners/appClips.js';
import { availabilityPlanner } from './planners/availability.js';
import { catalogPlanner } from './planners/catalog.js';
import { customPagesPlanner } from './planners/customPages.js';
import { euDistributionPlanner } from './planners/euDistribution.js';
import { experimentsPlanner } from './planners/experiments.js';
import { gameCenterPlanner } from './planners/gameCenter.js';
import { listingPlanner } from './planners/listing.js';
import { offersPlanner } from './planners/offers.js';
import { playProductsPlanner } from './planners/playProducts.js';
import { playSubscriptionsPlanner } from './planners/playSubscriptions.js';
import { releaseConfigPlanner } from './planners/releaseConfig.js';
import { screenshotsPlanner } from './planners/screenshots.js';
import { walletPlanner } from './planners/wallet.js';

/** Registered planners keyed by surface id; re-register replaces (idempotent wiring). */
const PLANNERS = new Map<string, SurfacePlanner>();

/** Built-in surfaces from ADR 0003 (catalog/listing/Play + v1.1 App Store breadth). */
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
export const registerSurfacePlanner = (planner: SurfacePlanner): void => {
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
