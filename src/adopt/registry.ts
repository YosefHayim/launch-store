import type { Adopter } from '../types/adopt.js';
import { capabilitiesAdopter } from './capabilities.js';
import { certsAdopter } from './certs.js';
import { listingAdopter } from './listing.js';
import { productsAdopter } from './products.js';

/** Registered adopters keyed by domain; re-registering one replaces it. */
const ADOPTERS = new Map<string, Adopter>();

/** Register (or replace) an adopter by its domain key. */
export const registerAdopter = (adopter: Adopter): void => {
  ADOPTERS.set(adopter.domain, adopter);
};

/** Every registered adopter, in registration order. */
export const listAdopters = (): Adopter[] => [...ADOPTERS.values()];

/**
 * Register the v1 built-in adopters, smallest-blast-radius first
 * (products -> capabilities -> certs -> listing). Idempotent.
 */
export const registerBuiltinAdopters = (): void => {
  registerAdopter(productsAdopter);
  registerAdopter(capabilitiesAdopter);
  registerAdopter(certsAdopter);
  registerAdopter(listingAdopter);
};
