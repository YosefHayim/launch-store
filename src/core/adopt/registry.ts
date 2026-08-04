import type { Adopter } from '../types/adopt.js';
import { productsAdopter } from './products.js';
import { capabilitiesAdopter } from './capabilities.js';
import { certsAdopter } from './certs.js';
import { listingAdopter } from './listing.js';
import type { ProfileEntitlementRequirements } from './profileEntitlements.js';
import type { LaunchPathsService } from '../services/paths.js';

export type AdopterRequirements = ProfileEntitlementRequirements | LaunchPathsService;
/** Registered adopters, keyed by domain so re-registering one replaces it (idempotent built-in wiring). */
const ADOPTERS = new Map<string, Adopter<AdopterRequirements>>();
/** Register (or replace) an adopter by its domain key. */
export const registerAdopter = (adopter: Adopter<AdopterRequirements>): void => {
  ADOPTERS.set(adopter.domain, adopter);
};
/** Every registered adopter, in registration order - the orchestrator's full work list. */
export const listAdopters = (): Adopter<AdopterRequirements>[] => {
  return [...ADOPTERS.values()];
};
/**
 * Register the v1 built-in adopters, smallest-blast-radius first (products -> capabilities -> certs ->
 * listing). Idempotent: safe to call from each command entry and from tests without duplicating.
 */
export const registerBuiltinAdopters = (): void => {
  registerAdopter(productsAdopter);
  registerAdopter(capabilitiesAdopter);
  registerAdopter(certsAdopter);
  registerAdopter(listingAdopter);
};
