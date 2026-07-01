/**
 * The `launch adopt` engine: detect adoptable apps, collect every registered adopter's planned writes,
 * and (after the command confirms) apply them to local config. The pull counterpart of `core/ascSync.ts`
 * — where that reconciler pushes config up to App Store Connect, this reads the account down into config.
 *
 * Kept UI-free, like `ascSync.ts`: the command (`cli/commands/adopt.ts`) renders the plan, confirms, and
 * supplies the metadata-pull delegate; this module only detects, plans (read-only), and writes files.
 * Detection is stateless — every run reads the live account and the current files, so re-running just
 * proposes the remaining delta (no markers, no state file). Failures are isolated per adopter and per
 * listing pull so one domain's error never discards the rest, mirroring the reconciler's per-action isolation.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAppEntitlements } from '../config.js';
import {
  aggregateProductPieces,
  buildAdoptedConfig,
  renderEntitlementsBlock,
  serializeProductsSection,
} from './configWriter.js';
import type {
  Adopter,
  AdoptCatalogApi,
  AdoptTarget,
  AppDescriptor,
  AppProducts,
  EntitlementValue,
  PlannedWrite,
  ProductPiece,
} from '../types.js';

/** One discovered app that can't be adopted, with the human reason it was skipped. */
export interface SkippedApp {
  app: AppDescriptor;
  reason: string;
}

/** One app resolved to a live App Store Connect record, with a one-line signal for the plan header. */
export interface DetectedApp {
  target: AdoptTarget;
  /** Human confirmation signal, e.g. `v2.1 live · 12 build(s)`. */
  signal: string;
}

/** The result of resolving discovered apps against App Store Connect: what's adoptable, what was skipped. */
export interface Detection {
  detected: DetectedApp[];
  skipped: SkippedApp[];
}

/** Per-run constants threaded onto every {@link AdoptTarget} during detection. */
export interface DetectContext {
  /** Active Apple account Key ID. */
  keyId: string;
  /** Working directory holding `launch.config.ts`. */
  cwd: string;
  /** Whether `launch.config.ts` already exists (fresh-write vs print-the-block on apply). */
  hasLaunchConfig: boolean;
}

/** One adopter that threw while reading — surfaced in the plan rather than silently dropped. */
export interface AdopterError {
  domain: string;
  message: string;
}

/** One app's full plan: the app it's for, every planned write, and any adopter that failed to read. */
export interface TargetPlan {
  detected: DetectedApp;
  writes: PlannedWrite[];
  errors: AdopterError[];
}

/** Render the version/build signal that confirms an app is worth adopting. */
function describeSignal(version: string | null, builds: number): string {
  const parts: string[] = [];
  if (version) parts.push(`v${version} live`);
  if (builds > 0) parts.push(`${builds} build${builds === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : 'registered, no builds yet';
}

/**
 * Resolve each discovered app against App Store Connect: an app with an iOS bundle id whose record
 * exists is adoptable (with a version/build signal); the rest are skipped with a reason. Detection
 * tolerates a flaky signal read (it falls back to a neutral signal) but never invents a record.
 */
export async function detectTargets(
  asc: AdoptCatalogApi,
  apps: AppDescriptor[],
  ctx: DetectContext,
): Promise<Detection> {
  const detected: DetectedApp[] = [];
  const skipped: SkippedApp[] = [];

  await Promise.all(
    apps.map(async (app) => {
      if (!app.bundleId) {
        skipped.push({ app, reason: 'no iOS bundle id' });
        return;
      }
      const appId = await asc.getAppId(app.bundleId);
      if (!appId) {
        skipped.push({
          app,
          reason: 'no App Store Connect record (create the app once in App Store Connect)',
        });
        return;
      }
      const [version, builds] = await Promise.all([
        asc.getLatestMarketingVersion(app.bundleId).catch(() => null),
        asc.getLatestBuildNumber(app.bundleId).catch(() => 0),
      ]);
      detected.push({
        target: {
          app,
          appId,
          bundleId: app.bundleId,
          keyId: ctx.keyId,
          cwd: ctx.cwd,
          hasLaunchConfig: ctx.hasLaunchConfig,
        },
        signal: describeSignal(version, builds),
      });
    }),
  );

  detected.sort((a, b) => a.target.bundleId.localeCompare(b.target.bundleId));
  skipped.sort((a, b) => a.app.name.localeCompare(b.app.name));
  return { detected, skipped };
}

/**
 * Run every adopter against each detected app, in registry order (so the plan is deterministic), and
 * collect the writes. An adopter that throws is captured on {@link TargetPlan.errors} and skipped — its
 * failure never aborts the other domains or the other apps.
 */
export async function planTargets(
  asc: AdoptCatalogApi,
  detection: Detection,
  adopters: Adopter[],
): Promise<TargetPlan[]> {
  return Promise.all(
    detection.detected.map(async (detected) => {
      const writes: PlannedWrite[] = [];
      const errors: AdopterError[] = [];
      for (const adopter of adopters) {
        try {
          writes.push(...(await adopter.read(asc, detected.target)));
        } catch (error) {
          errors.push({
            domain: adopter.domain,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { detected, writes, errors };
    }),
  );
}

/** Inputs the command supplies to apply a confirmed plan to disk. */
export interface ApplyContext {
  cwd: string;
  hasLaunchConfig: boolean;
  /** Detected `appRoots` for a fresh config write, or null to leave the template's commented hint. */
  appRoot: string | null;
  /** Delegate that runs `launch metadata pull` for one app (injected so `core` stays free of fastlane/cli). */
  pullListing: (bundleId: string, configPath: string) => Promise<void>;
}

/** What `applyAdopt` did — structured so the command can render it and the developer knows exactly what changed. */
export interface AdoptApplyResult {
  /** Path of a freshly-written `launch.config.ts`, when the repo had none. */
  configWritten?: string;
  /** The `products` block to paste, when a `launch.config.ts` already existed (never spliced). */
  configBlock?: string;
  /** Static `app.json` files patched, with the entitlement keys added to each. */
  appJsonPatched: { app: string; configPath: string; added: string[] }[];
  /** Dynamic `app.config.{js,ts}` files that can't be patched — the entitlements block to paste. */
  appJsonBlocks: { app: string; configPath: string; block: string }[];
  /** App names whose listing copy was pulled into `store.config.json`. */
  listingsPulled: string[];
  /** Listing pulls that failed (e.g. fastlane unavailable), captured rather than thrown. */
  listingErrors: { app: string; message: string }[];
}

/** Collect the launch.config product pieces across all apps into one bundle-id-keyed catalog. */
function collectProducts(plans: TargetPlan[]): Record<string, AppProducts> {
  const productsByBundleId: Record<string, AppProducts> = {};
  for (const plan of plans) {
    const pieces: ProductPiece[] = [];
    for (const write of plan.writes) {
      if (write.change.home === 'launch.config') pieces.push(write.change.piece);
    }
    if (pieces.length > 0)
      productsByBundleId[plan.detected.target.bundleId] = aggregateProductPieces(pieces);
  }
  return productsByBundleId;
}

/**
 * Apply a confirmed plan to local config: write (or print) the `products` block, patch (or print) each
 * app's `app.json` entitlements, and pull each app's listing copy via the injected delegate. Never
 * splices a hand-edited file — a present `launch.config.ts` and a dynamic `app.config.js` get a
 * paste-ready block instead of a blind rewrite. Returns exactly what changed for the command to render.
 */
export async function applyAdopt(
  plans: TargetPlan[],
  ctx: ApplyContext,
): Promise<AdoptApplyResult> {
  const result: AdoptApplyResult = {
    appJsonPatched: [],
    appJsonBlocks: [],
    listingsPulled: [],
    listingErrors: [],
  };

  const productsByBundleId = collectProducts(plans);
  if (Object.keys(productsByBundleId).length > 0) {
    if (ctx.hasLaunchConfig) {
      result.configBlock = serializeProductsSection(productsByBundleId);
    } else {
      const path = join(ctx.cwd, 'launch.config.ts');
      writeFileSync(path, buildAdoptedConfig(ctx.appRoot, productsByBundleId));
      result.configWritten = path;
    }
  }

  for (const plan of plans) {
    const app = plan.detected.target.app;
    const entitlements: Record<string, EntitlementValue> = {};
    for (const write of plan.writes) {
      if (write.change.home === 'app.json') entitlements[write.change.key] = write.change.value;
    }
    if (Object.keys(entitlements).length === 0) continue;
    if (app.configPath.endsWith('.json')) {
      const added = writeAppEntitlements(app, entitlements);
      if (added.length > 0)
        result.appJsonPatched.push({ app: app.name, configPath: app.configPath, added });
    } else {
      result.appJsonBlocks.push({
        app: app.name,
        configPath: app.configPath,
        block: renderEntitlementsBlock(entitlements),
      });
    }
  }

  for (const plan of plans) {
    for (const write of plan.writes) {
      if (write.change.home !== 'store.config') continue;
      try {
        await ctx.pullListing(write.change.bundleId, write.change.configPath);
        result.listingsPulled.push(write.change.appName);
      } catch (error) {
        result.listingErrors.push({
          app: write.change.appName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}
