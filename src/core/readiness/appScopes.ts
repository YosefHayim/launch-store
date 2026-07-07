/**
 * Narrow the discovered apps to the ones a probe can read, carrying the now-guaranteed store identifier.
 *
 * `AppDescriptor.bundleId` / `.packageName` are optional (an app can be iOS-only or Android-only), so
 * probes need the platform-specific id present and typed as a `string`, not `string | undefined`. These
 * helpers do that narrowing once via `flatMap` — so probes stay free of repeated `if (!app.bundleId)`
 * guards and non-null assertions.
 */

import type { AppDescriptor } from '../types/index.js';

/** An app scoped to one store, with the relevant identifier guaranteed present. */
export interface ScopedApp {
  /** App handle as discovered. */
  name: string;
  /** The store identifier — iOS bundle id or Android package name, never undefined. */
  identifier: string;
}

/**
 * Select apps that declare an iOS bundle id, paired with that store identifier.
 *
 * @param apps - Discovered app descriptors from the loaded Launch config.
 * @returns App Store-scoped descriptors with a guaranteed identifier.
 */
export function iosApps(apps: AppDescriptor[]): ScopedApp[] {
  return apps.flatMap((app) =>
    app.bundleId ? [{ name: app.name, identifier: app.bundleId }] : [],
  );
}

/**
 * Select apps that declare an Android package name, paired with that store identifier.
 *
 * @param apps - Discovered app descriptors from the loaded Launch config.
 * @returns Google Play-scoped descriptors with a guaranteed identifier.
 */
export function androidApps(apps: AppDescriptor[]): ScopedApp[] {
  return apps.flatMap((app) =>
    app.packageName ? [{ name: app.name, identifier: app.packageName }] : [],
  );
}
