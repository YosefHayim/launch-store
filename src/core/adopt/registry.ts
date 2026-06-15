/**
 * The adopter registry — the same "implement an interface + register it" seam the provider registry
 * uses (`src/providers/index.ts`), scoped to `launch adopt`. The orchestrator walks {@link listAdopters}
 * and never names a concrete domain, so adding `gameCenter` / `appClips` / `wallet` later is a new file
 * plus one {@link registerAdopter} line in {@link registerBuiltinAdopters} — the orchestrator is untouched.
 */

import type { Adopter } from "./types.js";
import { productsAdopter } from "./products.js";
import { capabilitiesAdopter } from "./capabilities.js";
import { certsAdopter } from "./certs.js";
import { listingAdopter } from "./listing.js";

/** Registered adopters, keyed by domain so re-registering one replaces it (idempotent built-in wiring). */
const ADOPTERS = new Map<string, Adopter>();

/** Register (or replace) an adopter by its domain key. */
export function registerAdopter(adopter: Adopter): void {
  ADOPTERS.set(adopter.domain, adopter);
}

/** Every registered adopter, in registration order — the orchestrator's full work list. */
export function listAdopters(): Adopter[] {
  return [...ADOPTERS.values()];
}

/**
 * Register the v1 built-in adopters, smallest-blast-radius first (products → capabilities → certs →
 * listing). Idempotent: safe to call from each command entry and from tests without duplicating.
 */
export function registerBuiltinAdopters(): void {
  registerAdopter(productsAdopter);
  registerAdopter(capabilitiesAdopter);
  registerAdopter(certsAdopter);
  registerAdopter(listingAdopter);
}
