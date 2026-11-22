import type { Adopter } from '../types/adopt.ts';
import { capabilitiesAdopter } from './capabilities.ts';
import { certsAdopter } from './certs.ts';
import { listingAdopter } from './listing.ts';
import { productsAdopter } from './products.ts';

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
