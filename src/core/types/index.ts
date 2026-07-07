/**
 * Domain-types barrel. Every exported shape lives in a sibling `*.ts` module, split by concern.
 * Add or edit a shape in the matching sibling module, not here. Runtime values (const/enum/fn)
 * are logic, not shapes; they stay in a feature file and are imported from there directly.
 *
 * Core vocabulary: app · catalog (IAP/subscriptions) · storeSurface (sidecar config) ·
 * config (LaunchConfig + ResolvedBuildContext) · credentials · artifacts · providers (the five
 * provider interfaces) · remote (off-Mac builds) · vitals (Play Android vitals).
 *
 * Per-feature vocabulary (the read/plan/adopt family): adopt · agents · commandDocs · dashboard ·
 * doctor · insights · listing · mcp · migrate · plan · privacy · readiness · releaseTrain · snapshot.
 */

export type * from './app.js';
export type * from './catalog.js';
export type * from './storeSurface.js';
export type * from './config.js';
export type * from './credentials.js';
export type * from './artifacts.js';
export type * from './providers.js';
export type * from './remote.js';
export type * from './vitals.js';

export type * from './adopt.js';
export type * from './agents.js';
export type * from './commandDocs.js';
export type * from './dashboard.js';
export type * from './doctor.js';
export type * from './insights.js';
export type * from './listing.js';
export type * from './mcp.js';
export type * from './migrate.js';
export type * from './plan.js';
export type * from './privacy.js';
export type * from './readiness.js';
export type * from './releaseTrain.js';
export type * from './snapshot.js';
