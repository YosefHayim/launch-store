import type { SnapshotSource } from '../types/snapshot.ts';
import { appleProductsSource } from './sources/apple-products.ts';
import { appleSubscriptionsSource } from './sources/apple-subscriptions.ts';
import { appleListingSource } from './sources/apple-listing.ts';
import { appleCapabilitiesSource } from './sources/apple-capabilities.ts';
import { playProductsSource } from './sources/play-products.ts';
import { playSubscriptionsSource } from './sources/play-subscriptions.ts';
/** Registered sources, keyed by id so re-registering one replaces it (idempotent built-in wiring). */
const SOURCES = new Map<string, SnapshotSource>();

/** Register (or replace) a snapshot source by its id. */
function registerSnapshotSource(source: SnapshotSource): void {
  SOURCES.set(source.id, source);
}

/** Every registered source, in registration order. */
export function listSnapshotSources(): SnapshotSource[] {
  return [...SOURCES.values()];
}

/** Register the built-in sources. */
export function registerBuiltinSources(): void {
  registerSnapshotSource(appleProductsSource);
  registerSnapshotSource(appleSubscriptionsSource);
  registerSnapshotSource(appleListingSource);
  registerSnapshotSource(appleCapabilitiesSource);
  registerSnapshotSource(playProductsSource);
  registerSnapshotSource(playSubscriptionsSource);
}
