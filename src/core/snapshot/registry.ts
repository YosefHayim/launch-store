import type { SnapshotSource } from '../types/snapshot.js';
import { appleProductsSource } from './sources/appleProducts.js';
import { appleSubscriptionsSource } from './sources/appleSubscriptions.js';
import { appleListingSource } from './sources/appleListing.js';
import { appleCapabilitiesSource } from './sources/appleCapabilities.js';
import { playProductsSource } from './sources/playProducts.js';
import { playSubscriptionsSource } from './sources/playSubscriptions.js';
/** Registered sources, keyed by id so re-registering one replaces it (idempotent built-in wiring). */
const SOURCES = new Map<string, SnapshotSource>();
/** Register (or replace) a snapshot source by its id. */
export const registerSnapshotSource = (source: SnapshotSource): void => {
  SOURCES.set(source.id, source);
};
/** Every registered source, in registration order. */
export const listSnapshotSources = (): SnapshotSource[] => {
  return [...SOURCES.values()];
};
/**
 * Register the built-in sources. Idempotent: safe to call from a command entry and from tests without
 * duplicating. A snapshot captures the cross-store product catalog - App Store + Google Play one-time
 * products and subscriptions - plus the App Store per-locale listing copy and App ID capabilities; further
 * surfaces (screenshots) land here as follow-up source files.
 */
export const registerBuiltinSources = (): void => {
  registerSnapshotSource(appleProductsSource);
  registerSnapshotSource(appleSubscriptionsSource);
  registerSnapshotSource(appleListingSource);
  registerSnapshotSource(appleCapabilitiesSource);
  registerSnapshotSource(playProductsSource);
  registerSnapshotSource(playSubscriptionsSource);
};
