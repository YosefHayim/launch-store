import type { SurfacePlanner } from '../types/plan.ts';
import { accessibilityPlanner } from './planners/accessibility.ts';
import { appClipsPlanner } from './planners/app-clips.ts';
import { availabilityPlanner } from './planners/availability.ts';
import { catalogPlanner } from './planners/catalog.ts';
import { customPagesPlanner } from './planners/custom-pages.ts';
import { euDistributionPlanner } from './planners/eu-distribution.ts';
import { experimentsPlanner } from './planners/experiments.ts';
import { gameCenterPlanner } from './planners/game-center.ts';
import { listingPlanner } from './planners/listing.ts';
import { offersPlanner } from './planners/offers.ts';
import { playProductsPlanner } from './planners/play-products.ts';
import { playSubscriptionsPlanner } from './planners/play-subscriptions.ts';
import { releaseConfigPlanner } from './planners/release-config.ts';
import { screenshotsPlanner } from './planners/screenshots.ts';
import { walletPlanner } from './planners/wallet.ts';

/** Registered planners keyed by surface id; re-register replaces (idempotent wiring). */
const PLANNERS = new Map<string, SurfacePlanner>();

/** Register (or replace) a surface planner by its id. */
function registerSurfacePlanner(planner: SurfacePlanner): void {
  PLANNERS.set(planner.id, planner);
}

/** Every registered planner in registration order. */
export function listSurfacePlanners(): SurfacePlanner[] {
  return [...PLANNERS.values()];
}

/** Register built-in planners. Idempotent for command entry and tests. */
export function registerBuiltinPlanners(): void {
  for (const planner of [
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
  ]) {
    registerSurfacePlanner(planner);
  }
}
