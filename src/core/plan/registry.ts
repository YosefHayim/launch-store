import type { SurfacePlanner } from '../types/plan.js';
import { catalogPlanner } from './planners/catalog.js';
import { listingPlanner } from './planners/listing.js';
import { playProductsPlanner } from './planners/playProducts.js';
import { playSubscriptionsPlanner } from './planners/playSubscriptions.js';
import { releaseConfigPlanner } from './planners/releaseConfig.js';
import { gameCenterPlanner } from './planners/gameCenter.js';
import { appClipsPlanner } from './planners/appClips.js';
import { availabilityPlanner } from './planners/availability.js';
import { accessibilityPlanner } from './planners/accessibility.js';
import { experimentsPlanner } from './planners/experiments.js';
import { customPagesPlanner } from './planners/customPages.js';
import { walletPlanner } from './planners/wallet.js';
import { euDistributionPlanner } from './planners/euDistribution.js';
import { offersPlanner } from './planners/offers.js';
import { screenshotsPlanner } from './planners/screenshots.js';
/** Registered planners, keyed by surface id so re-registering one replaces it (idempotent built-in wiring). */
const PLANNERS = new Map<string, SurfacePlanner>();
/** Register (or replace) a surface planner by its id. */
export const registerSurfacePlanner = (planner: SurfacePlanner): void => {
  PLANNERS.set(planner.id, planner);
};
/** Every registered planner, in registration order - the orchestrator's full work list. */
export const listSurfacePlanners = (): SurfacePlanner[] => {
  return [...PLANNERS.values()];
};
/**
 * Register the built-in planners. Idempotent: safe to call from the command entry and from tests without
 * duplicating - the cross-store v1 surfaces (catalog, listing, Play products & subscriptions) plus the
 * v1.1 breadth App Store surfaces (release-config, game-center, app-clips, ...) all wire in here (see
 * `docs/adr/0003-plan-drift.md`).
 */
export const registerBuiltinPlanners = (): void => {
  registerSurfacePlanner(catalogPlanner);
  registerSurfacePlanner(listingPlanner);
  registerSurfacePlanner(playProductsPlanner);
  registerSurfacePlanner(playSubscriptionsPlanner);
  registerSurfacePlanner(releaseConfigPlanner);
  registerSurfacePlanner(gameCenterPlanner);
  registerSurfacePlanner(appClipsPlanner);
  registerSurfacePlanner(availabilityPlanner);
  registerSurfacePlanner(accessibilityPlanner);
  registerSurfacePlanner(experimentsPlanner);
  registerSurfacePlanner(customPagesPlanner);
  registerSurfacePlanner(walletPlanner);
  registerSurfacePlanner(euDistributionPlanner);
  registerSurfacePlanner(offersPlanner);
  registerSurfacePlanner(screenshotsPlanner);
};
