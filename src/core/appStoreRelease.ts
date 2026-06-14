/**
 * The App Store release state machine — what `launch release` / `launch status` / `launch rollout`
 * drive on the iOS side.
 *
 * This is the control plane for the part of shipping that the App Store Connect *website* still owns
 * after a binary is uploaded: create (or reuse) the App Store version, attach the build, answer export
 * compliance, set the release type (and a scheduled date), write the per-version release notes, choose
 * an immediate vs. phased rollout, and push it all into review via Apple's modern batched
 * `reviewSubmissions` flow. fastlane only ever uploaded the `.ipa`; everything here is native ASC API.
 *
 * Design (mirrors `core/ascSync.ts`):
 * - **Idempotent & resumable.** Every run re-reads the live state and converges. A re-run after a
 *   rejection edits the same editable version (the hotfix loop); a re-run after submission detects the
 *   in-flight version and no-ops. Apple permits only one editable version per platform at a time, so we
 *   reuse it rather than failing to create a second.
 * - **Plan, then apply.** A `dryRun` walk records what it WOULD do (still reading live state, never
 *   writing); the real walk performs it. Each step is isolated — a failure is captured on its action and
 *   the walk continues — so one bad step never aborts the rest.
 * - **Testable seam.** {@link AscReleaseApi} is the exact slice of {@link import("../apple/ascClient.js").AppStoreConnectClient}
 *   this needs, so the logic is unit-tested against a hand-rolled fake. The concrete client satisfies it structurally.
 *
 * Scope boundary: the listing copy (name, keywords, screenshots) stays with `launch metadata` (fastlane);
 * this only touches the per-version `whatsNew`. App-record creation stays manual — Apple exposes no API
 * to create an app record (see `apple/ascClient.ts`), so the command deep-links the developer to do it once.
 */

import type {
  AppStoreVersionLocalizationResource,
  AppStoreVersionResource,
  PhasedReleaseResource,
  ReviewSubmissionResource,
} from "../apple/ascClient.js";
import type { ReleaseType } from "./types.js";

/** The platform every release method targets. Launch's release flow is iOS-only (Android uses Play tracks). */
const PLATFORM = "IOS";

/** Placeholder id for a resource that would be created during a dry-run (its create closure never runs). */
const DRY_RUN_ID = "(dry-run)";

/**
 * Version states we can still edit — so we reuse one (the resume / post-rejection hotfix path) rather
 * than creating a second editable version, which Apple forbids.
 */
const EDITABLE_STATES = new Set<string>([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

/** Version states already at or past review — resubmitting is a no-op; the release is in flight. */
const IN_FLIGHT_STATES = new Set<string>([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_APP_STORE",
  "PENDING_APPLE_RELEASE",
  "READY_FOR_DISTRIBUTION",
]);

/** Rejection states the developer must address (surfaced by `launch status` with a Resolution Center link). */
const REJECTED_STATES = new Set<string>(["REJECTED", "METADATA_REJECTED", "DEVELOPER_REJECTED"]);

/**
 * The exact slice of {@link import("../apple/ascClient.js").AppStoreConnectClient} the release state
 * machine depends on. Declaring it here keeps the walk unit-testable with a fake and documents the
 * client's release surface in one place. The concrete client satisfies it structurally.
 */
export interface AscReleaseApi {
  listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]>;
  createAppStoreVersion(
    appId: string,
    input: { versionString: string; platform: string; releaseType: string; earliestReleaseDate?: string },
  ): Promise<AppStoreVersionResource>;
  updateAppStoreVersion(
    versionId: string,
    input: { versionString?: string; releaseType?: string; earliestReleaseDate?: string | null },
  ): Promise<void>;
  selectBuildForVersion(versionId: string, buildId: string): Promise<void>;
  setBuildUsesNonExemptEncryption(buildId: string, usesNonExemptEncryption: boolean): Promise<void>;
  listAppStoreVersionLocalizations(versionId: string): Promise<AppStoreVersionLocalizationResource[]>;
  updateVersionWhatsNew(localizationId: string, whatsNew: string): Promise<void>;
  getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null>;
  createPhasedRelease(versionId: string): Promise<PhasedReleaseResource>;
  updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void>;
  deletePhasedRelease(phasedReleaseId: string): Promise<void>;
  listReviewSubmissions(appId: string, platform: string): Promise<ReviewSubmissionResource[]>;
  createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource>;
  addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void>;
  submitReviewSubmission(submissionId: string): Promise<void>;
}

/** Where one release step ended up: planned (dry-run), or applied / skipped / failed after a real run. */
export type ReleaseActionStatus = "planned" | "applied" | "skipped" | "failed";

/** One step of the release walk — recorded for the plan and the post-run summary. */
export interface ReleaseAction {
  /** Human-readable line, e.g. `attach build to version 1.4.0`. */
  description: string;
  status: ReleaseActionStatus;
  /** Apple's error detail when {@link ReleaseAction.status} is `failed`. */
  error?: string;
  /** Why a step was skipped (e.g. `locale not on this version`). */
  note?: string;
}

/** One locale's release notes to write onto the version (sourced from `store.config.json`). */
export interface WhatsNewEntry {
  locale: string;
  text: string;
}

/** Everything {@link runAppStoreRelease} needs to take one build to App Store review. */
export interface ReleaseInput {
  /** Internal App Store Connect app id (already resolved; the command bails out if the record is missing). */
  appId: string;
  /** Marketing version to release, e.g. `1.4.0`. Must match the build's CFBundleShortVersionString. */
  versionString: string;
  /** The build resource to attach (a freshly-uploaded-and-processed build, or a promoted TestFlight one). */
  buildId: string;
  /** Export-compliance answer to stamp on the build (clears "Missing Compliance"). */
  usesNonExemptEncryption: boolean;
  /** How the approved build goes live. */
  releaseType: ReleaseType;
  /** ISO-8601 go-live instant; only used with `releaseType: "SCHEDULED"`. */
  earliestReleaseDate?: string;
  /** Opt into Apple's 7-day phased rollout (default is immediate). */
  phased: boolean;
  /** Per-locale release notes to set; empty leaves the version's notes untouched. */
  whatsNew: WhatsNewEntry[];
  /** Rehearse: read live state and record the plan, perform no writes. */
  dryRun: boolean;
}

/** The outcome of a release walk: the resolved version plus every step planned/performed, in order. */
export interface ReleaseReport {
  /** The version's resource id (`(dry-run)` when it would have been created in a dry-run). */
  versionId: string;
  versionString: string;
  /** Whether an existing editable version was reused (the resume / hotfix path) vs. a fresh one created. */
  reused: boolean;
  /** True when the version was already in review/flight and nothing was resubmitted. */
  alreadyInFlight: boolean;
  actions: ReleaseAction[];
}

/** Mutable per-run context threaded through the release walk. */
interface ReleaseContext {
  api: AscReleaseApi;
  actions: ReleaseAction[];
  dryRun: boolean;
}

/**
 * Record a step and, unless this is a dry-run, perform it. A thrown error is captured on the action
 * (status `failed`) rather than propagated, so the walk keeps going. Returns the terminal status plus
 * the run's value (e.g. a created resource), `undefined` on dry-run/failure — callers fall back to
 * {@link DRY_RUN_ID} for the id of a not-yet-created resource.
 */
async function act<T>(
  ctx: ReleaseContext,
  description: string,
  run: () => Promise<T>,
): Promise<{ status: ReleaseActionStatus; value?: T }> {
  const action: ReleaseAction = { description, status: "planned" };
  ctx.actions.push(action);
  if (ctx.dryRun) return { status: "planned" };
  try {
    const value = await run();
    action.status = "applied";
    return { status: "applied", value };
  } catch (error) {
    action.status = "failed";
    action.error = error instanceof Error ? error.message : String(error);
    return { status: "failed" };
  }
}

/** The `(scheduled @ <date>)` suffix for a step description, or empty for non-scheduled releases. */
function describeSchedule(input: ReleaseInput): string {
  return input.releaseType === "SCHEDULED" && input.earliestReleaseDate ? ` @ ${input.earliestReleaseDate}` : "";
}

/**
 * Take one build all the way to App Store review: resolve (create or reuse) the version, set its
 * attributes, stamp export compliance, attach the build, write release notes, choose the rollout, and
 * submit. Idempotent — see the module header. Throws only for a precondition the user must fix (the
 * version string is already live); every other step is captured per-action.
 */
export async function runAppStoreRelease(api: AscReleaseApi, input: ReleaseInput): Promise<ReleaseReport> {
  const ctx: ReleaseContext = { api, actions: [], dryRun: input.dryRun };
  const versions = await api.listAppStoreVersions(input.appId, PLATFORM);

  // Reusing a version string that's already released is a user error, not a recoverable step.
  if (versions.some((v) => v.appStoreState === "READY_FOR_SALE" && v.versionString === input.versionString)) {
    throw new Error(
      `Version ${input.versionString} is already released on the App Store. Bump to a higher version and re-run.`,
    );
  }

  // Idempotent: this exact version is already submitted / in review — nothing left to do.
  const inFlight = versions.find(
    (v) => v.versionString === input.versionString && IN_FLIGHT_STATES.has(v.appStoreState),
  );
  if (inFlight) {
    ctx.actions.push({
      description: `version ${input.versionString} already submitted (${inFlight.appStoreState})`,
      status: "skipped",
    });
    return {
      versionId: inFlight.id,
      versionString: input.versionString,
      reused: true,
      alreadyInFlight: true,
      actions: ctx.actions,
    };
  }

  const versionId = await resolveVersion(ctx, input, versions);
  const reused = versions.some((v) => v.id === versionId && EDITABLE_STATES.has(v.appStoreState));

  // Export compliance — idempotent, and covers a promoted build that never ran a local Launch build.
  await act(ctx, `set export compliance (usesNonExemptEncryption=${input.usesNonExemptEncryption})`, () =>
    api.setBuildUsesNonExemptEncryption(input.buildId, input.usesNonExemptEncryption),
  );

  await act(ctx, `attach build to version ${input.versionString}`, () =>
    api.selectBuildForVersion(versionId, input.buildId),
  );

  await reconcileWhatsNew(ctx, versionId, input.whatsNew);
  await reconcilePhasedRelease(ctx, versionId, input.phased);
  await submitForReview(ctx, input.appId, versionId, input.versionString);

  return { versionId, versionString: input.versionString, reused, alreadyInFlight: false, actions: ctx.actions };
}

/**
 * Resolve the version to release: reuse the single editable version Apple allows (renaming it to the
 * chosen string and refreshing its release type/date), or create a fresh one. Returns its id
 * ({@link DRY_RUN_ID} when a create was only planned).
 */
async function resolveVersion(
  ctx: ReleaseContext,
  input: ReleaseInput,
  versions: AppStoreVersionResource[],
): Promise<string> {
  const editable = versions.find((v) => EDITABLE_STATES.has(v.appStoreState));
  const schedule = input.releaseType === "SCHEDULED" ? (input.earliestReleaseDate ?? null) : null;

  if (editable) {
    await act(ctx, `update version → ${input.versionString} (${input.releaseType}${describeSchedule(input)})`, () =>
      ctx.api.updateAppStoreVersion(editable.id, {
        ...(editable.versionString !== input.versionString ? { versionString: input.versionString } : {}),
        releaseType: input.releaseType,
        earliestReleaseDate: schedule,
      }),
    );
    return editable.id;
  }

  const created = await act(
    ctx,
    `create version ${input.versionString} (${input.releaseType}${describeSchedule(input)})`,
    () =>
      ctx.api.createAppStoreVersion(input.appId, {
        versionString: input.versionString,
        platform: PLATFORM,
        releaseType: input.releaseType,
        ...(schedule ? { earliestReleaseDate: schedule } : {}),
      }),
  );
  return created.value?.id ?? DRY_RUN_ID;
}

/** Write the per-locale release notes, skipping locales the version doesn't carry (with a noted reason). */
async function reconcileWhatsNew(ctx: ReleaseContext, versionId: string, whatsNew: WhatsNewEntry[]): Promise<void> {
  if (whatsNew.length === 0) return;
  // A version that would only be created in a dry-run has no localizations to read yet — just plan the count.
  if (versionId === DRY_RUN_ID) {
    ctx.actions.push({ description: `set what's-new for ${whatsNew.length} locale(s)`, status: "planned" });
    return;
  }
  const localizations = await ctx.api.listAppStoreVersionLocalizations(versionId);
  const byLocale = new Map(localizations.map((localization) => [localization.locale, localization]));
  for (const { locale, text } of whatsNew) {
    const localization = byLocale.get(locale);
    if (!localization) {
      ctx.actions.push({
        description: `set what's-new [${locale}]`,
        status: "skipped",
        note: "locale not on this version",
      });
      continue;
    }
    await act(ctx, `set what's-new [${locale}]`, () => ctx.api.updateVersionWhatsNew(localization.id, text));
  }
}

/** Start a phased release when opted in, or cancel a stale one so the default immediate rollout stands. */
async function reconcilePhasedRelease(ctx: ReleaseContext, versionId: string, phased: boolean): Promise<void> {
  if (versionId === DRY_RUN_ID) {
    if (phased) ctx.actions.push({ description: "enable phased release (7-day gradual rollout)", status: "planned" });
    return;
  }
  const existing = await ctx.api.getPhasedRelease(versionId);
  if (phased && !existing) {
    await act(ctx, "enable phased release (7-day gradual rollout)", () => ctx.api.createPhasedRelease(versionId));
  } else if (!phased && existing) {
    await act(ctx, "disable phased release (immediate rollout)", () => ctx.api.deletePhasedRelease(existing.id));
  }
}

/** Create or reuse an open review submission, add the version, and submit it. Tolerant of a re-added item. */
async function submitForReview(
  ctx: ReleaseContext,
  appId: string,
  versionId: string,
  versionString: string,
): Promise<void> {
  const open = (await ctx.api.listReviewSubmissions(appId, PLATFORM)).find((s) => s.state === "READY_FOR_REVIEW");
  let submissionId: string;
  if (open) {
    submissionId = open.id;
  } else {
    const created = await act(ctx, "open review submission", () => ctx.api.createReviewSubmission(appId, PLATFORM));
    submissionId = created.value?.id ?? DRY_RUN_ID;
  }

  await act(ctx, `add version ${versionString} to review submission`, async () => {
    try {
      await ctx.api.addReviewSubmissionItem(submissionId, versionId);
    } catch (error) {
      // Idempotent resume: the item is already in the submission from a prior run — not a real failure.
      const message = error instanceof Error ? error.message : String(error);
      if (/already|duplicat|exist/i.test(message)) return;
      throw error;
    }
  });

  await act(ctx, "submit for App Store review", () => ctx.api.submitReviewSubmission(submissionId));
}

/** A snapshot of an app's current release state, for `launch status`. */
export interface ReleaseStatus {
  /** The version this status describes (the in-progress one if any, else the live one), or null when none. */
  versionString: string | null;
  /** Apple's lifecycle state, e.g. `WAITING_FOR_REVIEW`, `READY_FOR_SALE`, `REJECTED`. Null when no versions. */
  appStoreState: string | null;
  /** How the version goes live, when known. */
  releaseType?: string;
  /** The phased-release state when one is active, e.g. `ACTIVE` / `PAUSED` / `COMPLETE`. */
  phasedReleaseState?: string;
  /** True when the state is a rejection the developer must address (drives the Resolution Center link). */
  rejected: boolean;
}

/**
 * Read the app's current release status: prefer the version being worked on (editable or in-flight),
 * else the live version, else the newest — then fold in any phased-release state. Read-only.
 */
export async function readReleaseStatus(api: AscReleaseApi, appId: string): Promise<ReleaseStatus> {
  const versions = await api.listAppStoreVersions(appId, PLATFORM);
  const current =
    versions.find((v) => EDITABLE_STATES.has(v.appStoreState) || IN_FLIGHT_STATES.has(v.appStoreState)) ??
    versions.find((v) => v.appStoreState === "READY_FOR_SALE") ??
    versions[0];

  if (!current) return { versionString: null, appStoreState: null, rejected: false };

  const phased = await api.getPhasedRelease(current.id);
  return {
    versionString: current.versionString,
    appStoreState: current.appStoreState,
    rejected: REJECTED_STATES.has(current.appStoreState),
    ...(current.releaseType ? { releaseType: current.releaseType } : {}),
    ...(phased ? { phasedReleaseState: phased.phasedReleaseState } : {}),
  };
}

/** A phased-rollout control action for `launch rollout`. */
export type RolloutAction = "pause" | "resume" | "complete";

/** Map a rollout action to the `phasedReleaseState` Apple expects. `resume` re-activates a paused rollout. */
const ROLLOUT_STATE: Record<RolloutAction, string> = { pause: "PAUSE", resume: "ACTIVE", complete: "COMPLETE" };

/** The result of a rollout control action — the version steered and the state transition applied. */
export interface RolloutResult {
  versionString: string;
  from: string;
  to: string;
}

/**
 * Steer the in-progress phased release (pause / resume / complete). Finds the live-or-in-flight version
 * that has a phased release and PATCHes its state. Throws an actionable error when no phased release is
 * underway — phased rollout exists only after an approved update went live with `--phased`.
 */
export async function controlPhasedRelease(
  api: AscReleaseApi,
  appId: string,
  action: RolloutAction,
): Promise<RolloutResult> {
  const versions = await api.listAppStoreVersions(appId, PLATFORM);
  const candidates = versions.filter(
    (v) => v.appStoreState === "READY_FOR_SALE" || IN_FLIGHT_STATES.has(v.appStoreState),
  );
  for (const version of candidates) {
    const phased = await api.getPhasedRelease(version.id);
    if (!phased) continue;
    const to = ROLLOUT_STATE[action];
    await api.updatePhasedRelease(phased.id, to);
    return { versionString: version.versionString, from: phased.phasedReleaseState, to };
  }
  throw new Error(
    "No phased release in progress. A phased rollout exists only after an approved update goes live " +
      "with `launch release --phased`.",
  );
}
