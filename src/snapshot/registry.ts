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
/**
 * Register the built-in sources. Idempotent: safe to call from a command entry and from tests without
 * duplicating. A snapshot captures the cross-store product catalog - App Store + Google Play one-time
 * products and subscriptions - plus the App Store per-locale listing copy and App ID capabilities; further
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
