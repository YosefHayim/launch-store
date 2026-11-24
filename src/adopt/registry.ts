// Registers the adopters that copy App Store Connect state into local Launch config.

import type { Adopter } from '../types/adopt.ts';
import { capabilitiesAdopter } from './capabilities.ts';
import { certsAdopter } from './certificates.ts';
import { listingAdopter } from './app-store-listing.ts';
import { productsAdopter } from './products.ts';

/** Registered adopters keyed by domain; re-registering one replaces it. */
const ADOPTERS = new Map<string, Adopter>();

/** Register (or replace) an adopter by its domain key. */
export function registerAdopter(adopter: Adopter): void {
  ADOPTERS.set(adopter.domain, adopter);
}

/** Every registered adopter, in registration order. */
export function listAdopters(): Adopter[] {
  return [...ADOPTERS.values()];
}

/** Register the v1 built-in adopters */
export function registerBuiltinAdopters(): void {
  registerAdopter(productsAdopter);
  registerAdopter(capabilitiesAdopter);
  registerAdopter(certsAdopter);
  registerAdopter(listingAdopter);
}
