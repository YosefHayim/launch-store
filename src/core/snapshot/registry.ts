/**
 * The snapshot-source registry — the same "implement an interface + register it" seam the provider,
 * adopter, surface-planner, and readiness-probe registries use, scoped to the snapshot layer. The
 * orchestrator captures every {@link listSnapshotSources} entry and never names a concrete source, so
 * recording a new surface is a new source file plus one {@link registerSnapshotSource} line in
 * {@link registerBuiltinSources} — the orchestrator and the `snapshot` command are untouched.
 */

import type { SnapshotSource } from './types.js';
import { appleProductsSource } from './sources/appleProducts.js';
import { appleSubscriptionsSource } from './sources/appleSubscriptions.js';
import { appleListingSource } from './sources/appleListing.js';
import { appleCapabilitiesSource } from './sources/appleCapabilities.js';
import { playProductsSource } from './sources/playProducts.js';
import { playSubscriptionsSource } from './sources/playSubscriptions.js';

/** Registered sources, keyed by id so re-registering one replaces it (idempotent built-in wiring). */
const SOURCES = new Map<string, SnapshotSource>();

/** Register (or replace) a snapshot source by its id. */
export function registerSnapshotSource(source: SnapshotSource): void {
  SOURCES.set(source.id, source);
}

/** Every registered source, in registration order. */
export function listSnapshotSources(): SnapshotSource[] {
  return [...SOURCES.values()];
}

/**
 * Register the built-in sources. Idempotent: safe to call from a command entry and from tests without
 * duplicating. A snapshot captures the cross-store product catalog — App Store + Google Play one-time
 * products and subscriptions — plus the App Store per-locale listing copy and App ID capabilities; further
 * surfaces (screenshots) land here as follow-up source files.
 */
export function registerBuiltinSources(): void {
  registerSnapshotSource(appleProductsSource);
  registerSnapshotSource(appleSubscriptionsSource);
  registerSnapshotSource(appleListingSource);
  registerSnapshotSource(appleCapabilitiesSource);
  registerSnapshotSource(playProductsSource);
  registerSnapshotSource(playSubscriptionsSource);
}
