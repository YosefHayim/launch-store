/**
 * Reconcile a build's **TestFlight release prep** — its per-locale "What to Test" notes and its **Beta
 * App Review submission** — from declared notes, using the App Store Connect API key alone. Typing the
 * notes and submitting for beta review on every external build is repeatable App Store Connect work that
 * EAS doesn't touch; Launch already uploads the build, this closes the loop.
 *
 * Per run:
 * 1. Resolve the target build: the one named by `buildVersion`, else the newest `VALID`, non-expired build.
 * 2. For each declared locale, **create** the "What to Test" note, or **update** it when the text differs.
 * 3. When `submitForReview` is set, **submit** the build for Beta App Review — idempotent: a build that
 *    already has a submission (waiting / in review / rejected / approved) is left alone, with its state
 *    reported. Re-submitting a rejected build is left to App Store Connect (Apple keeps one submission
 *    per build).
 *
 * Mirrors {@link reconcileAccessibility `core/accessibility.ts`} / {@link reconcileGameCenter
 * `core/gameCenter.ts`}: a read-only PLAN pass builds idempotent {@link PlannedAction}s, the command
 * prints them, then an APPLY pass performs them, each action isolated so one failure never aborts the rest.
 */

import { existsSync, readFileSync } from 'node:fs';
import type {
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BetaReviewState,
  BuildResource,
} from '../apple/ascClient.js';
import { plan, skip, type PlannedAction, type ReconcileContext } from './asc/storeSync.js';
import { errorMessage } from './errorMessage.js';

/** How many recent builds to scan when resolving the target build (newest first). */
const BUILD_SCAN_LIMIT = 50;

/** The `testflight.config.json` document — localized "What to Test" notes. */
export interface BetaReviewConfig {
  /** Locale → "What to Test" note (at least one). */
  whatToTest: Record<string, string>;
}

/**
 * The exact slice of {@link AppStoreConnectClient} the beta-review reconciler depends on. Declared here
 * (rather than the concrete client) so the diff logic is unit-testable with a hand-rolled fake, mirroring
 * {@link AscAccessibilityApi} in `accessibility.ts`.
 */
export interface AscBetaReviewApi {
  listBuilds(appId: string, limit?: number): Promise<BuildResource[]>;
  listBetaBuildLocalizations(buildId: string): Promise<BetaBuildLocalizationResource[]>;
  createBetaBuildLocalization(buildId: string, locale: string, whatsNew: string): Promise<void>;
  updateBetaBuildLocalization(localizationId: string, whatsNew: string): Promise<void>;
  getBetaAppReviewSubmission(buildId: string): Promise<BetaAppReviewSubmissionResource | null>;
  createBetaAppReviewSubmission(buildId: string): Promise<void>;
}

/** Inputs to reconcile one build's release prep. */
export interface BetaReviewReconcileInput {
  /** The App Store Connect app id (resolved upstream from the bundle id). */
  appId: string;
  /** Target a specific build by `CFBundleVersion`; default: the newest `VALID`, non-expired build. */
  buildVersion?: string;
  /** Locale → "What to Test" note to set on the build. */
  whatToTest: Record<string, string>;
  /** Whether to also submit the build for Beta App Review (required for external testers). */
  submitForReview: boolean;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** Human phrasing for a Beta App Review verdict, for the "already submitted" skip line. */
function describeState(state: BetaReviewState | undefined): string {
  switch (state) {
    case 'WAITING_FOR_REVIEW':
      return 'waiting for review';
    case 'IN_REVIEW':
      return 'in review';
    case 'REJECTED':
      return 'rejected';
    case 'APPROVED':
      return 'approved';
    default:
      return 'submitted';
  }
}

/**
 * Choose the build to operate on. An explicit `buildVersion` must exist and not be expired; otherwise the
 * newest `VALID`, non-expired build wins. Throws an actionable error when no eligible build is found.
 */
function selectBuild(builds: BuildResource[], buildVersion: string | undefined): BuildResource {
  if (buildVersion) {
    const match = builds.find((build) => build.version === buildVersion);
    if (!match) {
      throw new Error(
        `No build ${buildVersion} for this app. Upload it first, or omit --build to use the latest.`,
      );
    }
    if (match.expired) {
      throw new Error(
        `Build ${buildVersion} has expired (TestFlight's 90-day limit) and can't be submitted.`,
      );
    }
    return match;
  }
  const latest = builds.find((build) => build.processingState === 'VALID' && !build.expired);
  if (!latest) {
    throw new Error(
      'No VALID, non-expired build to release. Upload a build and wait for processing to finish.',
    );
  }
  return latest;
}

/**
 * Reconcile one build's "What to Test" notes and (optionally) its Beta App Review submission. Throws only
 * for a precondition the user must fix (no eligible build); per-action failures are captured so one never
 * aborts the rest. Returns the resolved build version so the command can name it in the summary.
 */
export async function reconcileBetaReview(
  api: AscBetaReviewApi,
  input: BetaReviewReconcileInput,
): Promise<{ buildVersion: string; actions: PlannedAction[] }> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };

  const build = selectBuild(
    await api.listBuilds(input.appId, BUILD_SCAN_LIMIT),
    input.buildVersion,
  );
  await reconcileNotes(ctx, api, build.id, input.whatToTest);
  if (input.submitForReview) await reconcileSubmission(ctx, api, build.id);

  return { buildVersion: build.version, actions: ctx.actions };
}

/** Create each declared locale's "What to Test" note, or update it when the text differs; skip when in sync. */
async function reconcileNotes(
  ctx: ReconcileContext,
  api: AscBetaReviewApi,
  buildId: string,
  whatToTest: Record<string, string>,
): Promise<void> {
  const existing = new Map(
    (await api.listBetaBuildLocalizations(buildId)).map((localization) => [
      localization.locale,
      localization,
    ]),
  );

  for (const [locale, text] of Object.entries(whatToTest)) {
    const current = existing.get(locale);
    if (current && (current.whatsNew ?? '') === text) continue; // already in sync

    const action = plan(
      ctx,
      current ? `update "What to Test" (${locale})` : `set "What to Test" (${locale})`,
    );
    if (ctx.dryRun) continue;
    try {
      if (current) await api.updateBetaBuildLocalization(current.id, text);
      else await api.createBetaBuildLocalization(buildId, locale, text);
      action.status = 'applied';
    } catch (error) {
      action.status = 'failed';
      action.error = errorMessage(error);
    }
  }
}

/** Submit the build for Beta App Review, unless it already has a submission (then skip, reporting its state). */
async function reconcileSubmission(
  ctx: ReconcileContext,
  api: AscBetaReviewApi,
  buildId: string,
): Promise<void> {
  const existing = await api.getBetaAppReviewSubmission(buildId);
  if (existing) {
    skip(
      ctx,
      `submit for Beta App Review: build already submitted (${describeState(existing.state)})`,
    );
    return;
  }

  const action = plan(ctx, 'submit for Beta App Review');
  if (ctx.dryRun) return;
  try {
    await api.createBetaAppReviewSubmission(buildId);
    action.status = 'applied';
  } catch (error) {
    action.status = 'failed';
    action.error = errorMessage(error);
  }
}

/** Narrow an unknown value to a plain object, or null. Arrays are rejected so a malformed section fails loudly. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parse and validate a raw `testflight.config.json` value into a typed {@link BetaReviewConfig}. Rejects a
 * non-object document, a missing/empty `whatToTest`, and a non-string note so a bad file fails loudly.
 */
export function parseBetaReviewConfig(raw: unknown): BetaReviewConfig {
  const record = asRecord(raw);
  if (!record) throw new Error('testflight.config.json must be a JSON object.');

  const whatToTest = asRecord(record['whatToTest']);
  if (!whatToTest) {
    throw new Error(
      'testflight.config.json: "whatToTest" must be an object mapping locale → notes.',
    );
  }

  const notes: Record<string, string> = {};
  for (const [locale, value] of Object.entries(whatToTest)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `testflight.config.json: whatToTest["${locale}"] must be a non-empty string.`,
      );
    }
    notes[locale] = value;
  }
  if (Object.keys(notes).length === 0) {
    throw new Error('testflight.config.json: "whatToTest" must declare at least one locale.');
  }
  return { whatToTest: notes };
}

/** Read and parse a `testflight.config.json` from disk. */
export function loadBetaReviewConfig(path: string): BetaReviewConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No TestFlight config at ${path}. Add a "whatToTest" map, or pass --whats-new <text>.`,
    );
  }
  return parseBetaReviewConfig(JSON.parse(readFileSync(path, 'utf8')));
}

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export function summarizeBetaReview(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
}
