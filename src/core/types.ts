/**
 * Domain-types barrel. Every exported shape lives in a ./types/*.ts module, split by concern; this
 * file re-exports them all so `import type { … } from "../core/types.js"` is the one import surface
 * across the codebase. Add or edit a shape in the matching ./types/*.ts module, not here. Runtime
 * values (const/enum/fn) are logic, not shapes — they stay in a feature file and are imported from
 * there directly, never through this type-only barrel.
 *
 * Core vocabulary: app · catalog (IAP/subscriptions) · storeSurface (sidecar config) ·
 * config (LaunchConfig + ResolvedBuildContext) · credentials · artifacts · providers (the five
 * provider interfaces) · remote (off-Mac builds) · vitals (Play Android vitals).
 *
 * Per-feature vocabulary (the read/plan/adopt family): adopt · agents · commandDocs · dashboard ·
 * doctor · insights · listing · mcp · migrate · plan · privacy · readiness · releaseTrain · snapshot.
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

export type * from './types/adopt.js';
export type * from './types/agents.js';
export type * from './types/commandDocs.js';
export type * from './types/dashboard.js';
export type * from './types/doctor.js';
export type * from './types/insights.js';
export type * from './types/listing.js';
export type * from './types/mcp.js';
export type * from './types/migrate.js';
export type * from './types/plan.js';
export type * from './types/privacy.js';
export type * from './types/readiness.js';
export type * from './types/releaseTrain.js';
export type * from './types/snapshot.js';
