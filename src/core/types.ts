/**
 * Domain-types barrel. The shapes themselves live in ./types/*.ts, split by concern; this file
 * re-exports them so `import type { … } from "../core/types.js"` is unchanged across the codebase.
 * Add or edit a shape in the matching ./types/*.ts module, not here.
 *
 * Modules: app (base vocabulary) · catalog (IAP/subscriptions) · storeSurface (sidecar config) ·
 * config (LaunchConfig + ResolvedBuildContext) · credentials · artifacts · providers (the five
 * provider interfaces) · remote (off-Mac builds) · vitals (Play Android vitals).
 */

export type * from './types/app.js';
export type * from './types/catalog.js';
export type * from './types/storeSurface.js';
export type * from './types/config.js';
export type * from './types/credentials.js';
export type * from './types/artifacts.js';
export type * from './types/providers.js';
export type * from './types/remote.js';
export type * from './types/vitals.js';
