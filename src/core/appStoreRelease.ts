/**
 * The App Store release state machine: drive an App Store **version → build attach → review → rollout**
 * lifecycle over the App Store Connect API, the sibling of `core/ascSync.ts`.
 *
 * Design (mirrors the sync reconciler):
 * - **Dependency-injected API.** {@link releaseApp} takes an {@link AscReleaseApi} — the exact slice of
 *   {@link AppStoreConnectClient} it needs — so the whole flow unit-tests against a hand-rolled fake
 *   with NO network, and the client's release surface is documented in one place.
 * - **Idempotent-resume.** The hard part of "submit + fix" is knowing what's legal given the version's
 *   current `appStoreState`. {@link nextReleaseAction} is the pure transition table; re-running a release
 *   reuses an editable version, no-ops when one is already submitted/approved, and errors clearly when
 *   the exact version is already live (you must bump).
 * - **Plan, then apply.** The same walk runs twice from the command: once with `dryRun` to produce the
 *   plan (read-only — it still GETs current state, but performs no writes), and once for real after the
 *   user confirms (`--dry-run` stops at the plan). Each write is isolated via {@link act}: a failure is
 *   captured on its action and the walk continues, so the run summary reports every failed step rather
 *   than aborting on the first — and the caller surfaces a non-zero exit. This mirrors `core/ascSync.ts`.
 *   The two genuine preconditions (no app record, the chosen build isn't `VALID`/expired, the version is
 *   already live) still throw, because there's no release to plan past them.
 *
 * Scope: this automates an UPDATE to an already-configured app — the realistic zero-portal case (Apple
 * carries age rating, screenshots, privacy, and review contact forward from the prior submission). A
 * brand-new app's first submission still needs those portal-only steps and the app record itself, which
 * Apple has no API to create — {@link appRecordMissingMessage} detects that and prints the checklist.
 */

import type { ReleaseType } from "./types.js";
import type { AppStoreVersionResource, BuildResource, ReviewSubmissionResource } from "../apple/ascClient.js";

/**
 * The exact slice of {@link AppStoreConnectClient} the release flow depends on. Declaring it here keeps
 * the state machine testable with a fake and documents the client's release surface in one place;
 * `AppStoreConnectClient` satisfies it structurally.
 */
export interface AscReleaseApi {
  getAppId(bundleId: string): Promise<string | null>;
  listBuilds(appId: string, limit?: number): Promise<BuildResource[]>;
  findBuildByVersion(appId: string, buildNumber: number): Promise<BuildResource | null>;
  setBuildUsesNonExemptEncryption(buildId: string, usesNonExemptEncryption: boolean): Promise<void>;
  listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]>;
  createAppStoreVersion(
    appId: string,
    input: { versionString: string; platform: string; releaseType?: string; earliestReleaseDate?: string },
  ): Promise<AppStoreVersionResource>;
  updateAppStoreVersion(
    versionId: string,
    input: { releaseType?: string; earliestReleaseDate?: string; versionString?: string },
  ): Promise<void>;
  selectBuildForVersion(versionId: string, buildId: string): Promise<void>;
  listAppStoreVersionLocalizations(versionId: string): Promise<{ id: string; locale: string; whatsNew?: string }[]>;
  createAppStoreVersionLocalization(versionId: string, input: { locale: string; whatsNew: string }): Promise<unknown>;
  updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void>;
  getPhasedRelease(versionId: string): Promise<{ id: string; phasedReleaseState: string } | null>;
  createPhasedRelease(versionId: string): Promise<unknown>;
  deletePhasedRelease(phasedReleaseId: string): Promise<void>;
  listReviewSubmissions(appId: string, platform: string): Promise<ReviewSubmissionResource[]>;
  createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource>;
  addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void>;
  submitReviewSubmission(submissionId: string): Promise<void>;
  getReviewSubmission(submissionId: string): Promise<ReviewSubmissionResource>;
  /** Fire the held developer release for an approved version (used by the release-train `--hold` gate). */
  createAppStoreVersionReleaseRequest(versionId: string): Promise<void>;
}

/** The Apple platform value an App Store version is filtered/created under. iOS is all v1 covers. */
export const IOS_PLATFORM = "IOS";

/**
 * What a version's `appStoreState` permits right now — the transition table at the heart of
 * idempotent-resume.
 * - `editable`: can attach a build, set notes, and submit (fresh, or a rejected version reopened).
 * - `submitted`: already in Apple's queue (or processing) — re-running is a no-op until it resolves.
 * - `pending-release`: approved, awaiting go-live (manual press or a schedule) — the submit flow is done.
 * - `live`: this exact version is already public — you must bump to release again.
 * - `blocked`: an unknown/removed state we won't mutate.
 */
export type ReleasePhase = "editable" | "submitted" | "pending-release" | "live" | "blocked";

/** Classify a version's `appStoreState` into the action the release flow may take. Pure. */
export function nextReleaseAction(appStoreState: string): ReleasePhase {
  switch (appStoreState) {
    case "PREPARE_FOR_SUBMISSION":
    case "DEVELOPER_REJECTED":
    case "REJECTED":
    case "METADATA_REJECTED":
    case "INVALID_BINARY":
      return "editable";
    case "WAITING_FOR_REVIEW":
    case "IN_REVIEW":
    case "WAITING_FOR_EXPORT_COMPLIANCE":
    case "PROCESSING_FOR_APP_STORE":
      return "submitted";
    case "PENDING_DEVELOPER_RELEASE":
    case "PENDING_APPLE_RELEASE":
      return "pending-release";
    case "READY_FOR_SALE":
    case "READY_FOR_DISTRIBUTION":
    case "REPLACED_WITH_NEW_VERSION":
    case "REMOVED_FROM_SALE":
    case "DEVELOPER_REMOVED_FROM_SALE":
      return "live";
    default:
      return "blocked";
  }
}

/** A terminal-or-transient read of where a submitted version stands, for `launch status` and the watch loop. */
export interface ReleaseVerdict {
  /** One-line human summary. */
  label: string;
  /** Coarse category for formatting + scripting. */
  state: "released" | "pending-release" | "in-review" | "preparing" | "rejected" | "unknown";
  /** Whether this is a settled state — `launch status --watch` stops polling once true. */
  done: boolean;
  /** Process exit code for CI: 0 ok/approved/released, 2 rejected, 3 still in progress, 1 unknown. */
  exitCode: number;
}

/** Map a version's `appStoreState` to a {@link ReleaseVerdict} (the `--watch` / exit-code contract). Pure. */
export function classifyVerdict(appStoreState: string): ReleaseVerdict {
  switch (appStoreState) {
    case "READY_FOR_SALE":
    case "READY_FOR_DISTRIBUTION":
      return { label: "Live on the App Store", state: "released", done: true, exitCode: 0 };
    case "PENDING_DEVELOPER_RELEASE":
      return {
        label: "Approved — awaiting your release (`launch status`, or the portal)",
        state: "pending-release",
        done: true,
        exitCode: 0,
      };
    case "PENDING_APPLE_RELEASE":
      return { label: "Approved — scheduled to go live", state: "pending-release", done: true, exitCode: 0 };
    case "IN_REVIEW":
      return { label: "In review", state: "in-review", done: false, exitCode: 3 };
    case "WAITING_FOR_REVIEW":
      return { label: "Waiting for review", state: "in-review", done: false, exitCode: 3 };
    case "PROCESSING_FOR_APP_STORE":
      return { label: "Processing for the App Store", state: "in-review", done: false, exitCode: 3 };
    case "WAITING_FOR_EXPORT_COMPLIANCE":
      return { label: "Waiting for export compliance", state: "preparing", done: false, exitCode: 3 };
    case "PREPARE_FOR_SUBMISSION":
      return { label: "Preparing for submission (not yet submitted)", state: "preparing", done: true, exitCode: 0 };
    case "REJECTED":
    case "METADATA_REJECTED":
    case "DEVELOPER_REJECTED":
    case "INVALID_BINARY":
      return {
        label: "Rejected — open Resolution Center in App Store Connect",
        state: "rejected",
        done: true,
        exitCode: 2,
      };
    default:
      return { label: appStoreState || "no App Store version yet", state: "unknown", done: true, exitCode: 1 };
  }
}

/** Everything {@link releaseApp} needs for one submission, resolved by the command from config + flags. */
export interface ReleaseInput {
  /** The app's iOS bundle id — resolves the ASC app record. */
  bundleId: string;
  /** Apple platform value, e.g. {@link IOS_PLATFORM}. */
  platform: string;
  /** Marketing version to release, e.g. `1.2.0`. */
  versionString: string;
  /** How the approved build goes live. */
  releaseType: ReleaseType;
  /** ISO-8601 go-live instant; only meaningful with a `SCHEDULED` release type. */
  earliestReleaseDate?: string;
  /** Opt into Apple's 7-day phased rollout (ignored on a first version). */
  phasedRelease: boolean;
  /** Export-compliance answer declared on the attached build. */
  usesNonExemptEncryption: boolean;
  /** Release notes per App Store locale; empty leaves the version's existing notes untouched. */
  whatsNew: Record<string, string>;
  /** The build to attach (its resource id + state), or null to keep the version's current build. */
  build: BuildResource | null;
  /** Rehearse only: read live state and record the plan, perform no writes. */
  dryRun: boolean;
}

/** Where one release step ended up: planned (dry-run), or applied / skipped / failed after a real run. */
export type ReleaseActionStatus = "planned" | "applied" | "skipped" | "failed";

/** One step of the release walk — recorded for the `--dry-run` plan and the post-run summary. */
export interface ReleaseAction {
  /** Human-readable line, e.g. `attach build 42`. */
  description: string;
  /** Lifecycle: `planned` in a dry-run; `applied` / `skipped` / `failed` after a real apply. */
  status: ReleaseActionStatus;
  /** Apple's error detail when {@link ReleaseAction.status} is `failed`. */
  error?: string;
  /** Why a step was skipped (e.g. `locale not on this version`). */
  note?: string;
}

/** The outcome of a release run: the version it acted on and the ordered steps it performed. */
export interface ReleaseReport {
  bundleId: string;
  versionId: string;
  versionString: string;
  /** Apple state after the run: `WAITING_FOR_REVIEW` once submitted, else the reused version's state. */
  appStoreState: string;
  /** Whether this run submitted the version for review. */
  submitted: boolean;
  /** Whether the run was a no-op because the version was already submitted/approved. */
  alreadyInReview: boolean;
  actions: ReleaseAction[];
}

/** The actionable message when an app has no ASC record (which Apple has no API to create). */
export function appRecordMissingMessage(bundleId: string, command = "launch release ios"): string {
  return (
    `No App Store Connect app record for ${bundleId}. Apple has no API to create one — create the app ` +
    `once at https://appstoreconnect.com/apps. A brand-new app also needs its screenshots, age rating, ` +
    `privacy details, and signed Paid/Free Apps agreement set there once. Then re-run \`${command}\`.`
  );
}

/** Placeholder id for a version that would only be created in a dry-run (its create closure never runs). */
const DRY_RUN_ID = "(dry-run)";

/** Mutable per-run context threaded through the release walk. */
interface ReleaseContext {
  api: AscReleaseApi;
  actions: ReleaseAction[];
  dryRun: boolean;
}

/**
 * Record a step and, unless this is a dry-run, perform it. A thrown error is captured on the action
 * (status `failed`) rather than propagated, so the walk keeps going and the summary reports every
 * failure. Returns the terminal status plus the run's value (e.g. a created resource), `undefined` on a
 * dry-run or failure — callers fall back to {@link DRY_RUN_ID} for the id of a not-yet-created version.
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

/**
 * Drive one App Store version to "submitted for review", idempotently. Resolves (reuses, retargets, or
 * creates) the editable version, attaches the chosen build, declares export compliance, writes release
 * notes, sets the release type / phased rollout, then submits via Apple's review-submission model. With
 * `input.dryRun` it records what each step WOULD do and performs no writes. Throws only on a precondition
 * the user must fix (no app record, the build isn't `VALID`/expired, the version is already live); every
 * other step is captured per-action (see {@link act}), so one failure never aborts the rest.
 */
export async function releaseApp(api: AscReleaseApi, input: ReleaseInput): Promise<ReleaseReport> {
  const ctx: ReleaseContext = { api, actions: [], dryRun: input.dryRun };

  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw new Error(appRecordMissingMessage(input.bundleId));

  // The chosen build's state is a user-fix precondition — surface it before walking (even in a dry-run),
  // and narrow `build` to a const so the step closures capture it without a non-null assertion.
  const build = input.build;
  if (build) {
    if (build.processingState !== "VALID") {
      throw new Error(
        `Build ${build.version} is ${build.processingState || "still processing"} on App Store Connect — ` +
          `wait for it to finish (\`launch status\`), then re-run.`,
      );
    }
    if (build.expired) {
      throw new Error(`Build ${build.version} has expired on App Store Connect — upload a fresh build first.`);
    }
  }

  const resolved = await resolveVersion(ctx, appId, input);
  if (resolved.idempotentState) {
    ctx.actions.push({
      description: `version ${resolved.versionString} already ${resolved.idempotentState} — nothing to submit`,
      status: "skipped",
    });
    return {
      bundleId: input.bundleId,
      versionId: resolved.versionId,
      versionString: resolved.versionString,
      appStoreState: resolved.idempotentState,
      submitted: false,
      alreadyInReview: true,
      actions: ctx.actions,
    };
  }
  const versionId = resolved.versionId;

  // A real (non-dry) run whose version create failed has no id to build on — its failure is already
  // recorded, so stop rather than hammer Apple with the placeholder id on every downstream step.
  if (!ctx.dryRun && versionId === DRY_RUN_ID) {
    return {
      bundleId: input.bundleId,
      versionId,
      versionString: input.versionString,
      appStoreState: "PREPARE_FOR_SUBMISSION",
      submitted: false,
      alreadyInReview: false,
      actions: ctx.actions,
    };
  }

  if (build) {
    await act(ctx, `attach build ${build.version}`, () => api.selectBuildForVersion(versionId, build.id));
    await act(ctx, `declare export compliance (usesNonExemptEncryption=${String(input.usesNonExemptEncryption)})`, () =>
      api.setBuildUsesNonExemptEncryption(build.id, input.usesNonExemptEncryption),
    );
  }

  await applyReleaseNotes(ctx, versionId, input.whatsNew);

  await act(
    ctx,
    `set release type ${input.releaseType}${input.earliestReleaseDate ? ` @ ${input.earliestReleaseDate}` : ""}`,
    () =>
      api.updateAppStoreVersion(versionId, {
        releaseType: input.releaseType,
        ...(input.earliestReleaseDate ? { earliestReleaseDate: input.earliestReleaseDate } : {}),
      }),
  );

  await applyPhasedRelease(ctx, versionId, input.phasedRelease);
  await submitForReview(ctx, appId, versionId, input.platform);

  return {
    bundleId: input.bundleId,
    versionId,
    versionString: resolved.versionString,
    appStoreState: "WAITING_FOR_REVIEW",
    submitted: !input.dryRun,
    alreadyInReview: false,
    actions: ctx.actions,
  };
}

/**
 * Resolve the version to act on: reuse the one already at this version string (no-op if it's already
 * submitted/approved, error if it's already live), else retarget the open editable version, else create
 * a fresh one. Returns its id ({@link DRY_RUN_ID} when a create was only planned or failed) plus an
 * `idempotentState` set when the caller should stop (already submitted/approved).
 */
async function resolveVersion(
  ctx: ReleaseContext,
  appId: string,
  input: ReleaseInput,
): Promise<{ versionId: string; versionString: string; idempotentState?: string }> {
  const versions = await ctx.api.listAppStoreVersions(appId, input.platform);

  const sameString = versions.find((version) => version.versionString === input.versionString);
  if (sameString) {
    const phase = nextReleaseAction(sameString.appStoreState);
    if (phase === "live") {
      throw new Error(
        `Version ${input.versionString} is already on the App Store (${sameString.appStoreState}). ` +
          `Bump the version in app.json, build, then release again.`,
      );
    }
    if (phase === "submitted" || phase === "pending-release") {
      return {
        versionId: sameString.id,
        versionString: sameString.versionString,
        idempotentState: sameString.appStoreState,
      };
    }
    return { versionId: sameString.id, versionString: sameString.versionString };
  }

  const editable = versions.find((version) => nextReleaseAction(version.appStoreState) === "editable");
  if (editable) {
    await act(ctx, `retarget open version to ${input.versionString}`, () =>
      ctx.api.updateAppStoreVersion(editable.id, { versionString: input.versionString }),
    );
    return { versionId: editable.id, versionString: input.versionString };
  }

  const created = await act(ctx, `create App Store version ${input.versionString}`, () =>
    ctx.api.createAppStoreVersion(appId, {
      versionString: input.versionString,
      platform: input.platform,
      releaseType: input.releaseType,
      ...(input.earliestReleaseDate ? { earliestReleaseDate: input.earliestReleaseDate } : {}),
    }),
  );
  return { versionId: created.value?.id ?? DRY_RUN_ID, versionString: input.versionString };
}

/** Write each locale's release notes, creating the localization or updating its `whatsNew`. */
async function applyReleaseNotes(
  ctx: ReleaseContext,
  versionId: string,
  whatsNew: Record<string, string>,
): Promise<void> {
  const locales = Object.entries(whatsNew);
  if (locales.length === 0) return;
  // A version that would only be created in a dry-run has no localizations to read yet — just plan the count.
  if (versionId === DRY_RUN_ID) {
    ctx.actions.push({ description: `set release notes for ${locales.length} locale(s)`, status: "planned" });
    return;
  }
  const existing = await ctx.api.listAppStoreVersionLocalizations(versionId);
  for (const [locale, text] of locales) {
    const match = existing.find((localization) => localization.locale === locale);
    if (match)
      await act(ctx, `set release notes [${locale}]`, () => ctx.api.updateAppStoreVersionLocalization(match.id, text));
    else
      await act(ctx, `set release notes [${locale}]`, () =>
        ctx.api.createAppStoreVersionLocalization(versionId, { locale, whatsNew: text }),
      );
  }
}

/** Bring the version's phased-release schedule in line with the requested opt-in (create or remove it). */
async function applyPhasedRelease(ctx: ReleaseContext, versionId: string, wantPhased: boolean): Promise<void> {
  if (versionId === DRY_RUN_ID) {
    if (wantPhased) ctx.actions.push({ description: "enable phased release", status: "planned" });
    return;
  }
  const existing = await ctx.api.getPhasedRelease(versionId);
  if (wantPhased && !existing) {
    await act(ctx, "enable phased release", () => ctx.api.createPhasedRelease(versionId));
  } else if (!wantPhased && existing) {
    await act(ctx, "disable phased release (immediate 100% rollout)", () => ctx.api.deletePhasedRelease(existing.id));
  }
}

/** Reuse an addable (`READY_FOR_REVIEW`) review submission or open one, add the version, and submit it. */
async function submitForReview(ctx: ReleaseContext, appId: string, versionId: string, platform: string): Promise<void> {
  const open = (await ctx.api.listReviewSubmissions(appId, platform)).find(
    (submission) => submission.state === "READY_FOR_REVIEW",
  );
  let submissionId: string;
  if (open) {
    submissionId = open.id;
  } else {
    const created = await act(ctx, "open review submission", () => ctx.api.createReviewSubmission(appId, platform));
    submissionId = created.value?.id ?? DRY_RUN_ID;
  }

  await act(ctx, "add version to review submission", async () => {
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

/** A live read of where an app's current release stands — backs `launch status` and the watch loop. */
export interface ReleaseStatus {
  bundleId: string;
  versionString: string | null;
  appStoreState: string | null;
  buildNumber: string | null;
  buildProcessingState: string | null;
  phasedReleaseState: string | null;
  verdict: ReleaseVerdict;
}

/**
 * Read the app's most relevant version (an in-flight one over a live one) plus its build processing and
 * phased-release state, and classify a verdict. Throws when the app record is missing.
 */
export async function readReleaseStatus(
  api: AscReleaseApi,
  bundleId: string,
  platform: string,
): Promise<ReleaseStatus> {
  const appId = await api.getAppId(bundleId);
  if (!appId) throw new Error(appRecordMissingMessage(bundleId, "launch status"));

  const versions = await api.listAppStoreVersions(appId, platform);
  const version = pickCurrentVersion(versions);
  if (!version) {
    return {
      bundleId,
      versionString: null,
      appStoreState: null,
      buildNumber: null,
      buildProcessingState: null,
      phasedReleaseState: null,
      verdict: classifyVerdict(""),
    };
  }

  const [phased, builds] = await Promise.all([api.getPhasedRelease(version.id), api.listBuilds(appId, 1)]);
  const latestBuild = builds[0] ?? null;
  return {
    bundleId,
    versionString: version.versionString,
    appStoreState: version.appStoreState,
    buildNumber: latestBuild?.version ?? null,
    buildProcessingState: latestBuild?.processingState ?? null,
    phasedReleaseState: phased?.phasedReleaseState ?? null,
    verdict: classifyVerdict(version.appStoreState),
  };
}

/** The version a developer cares about now: an in-flight one (editable/submitted/pending) over the live one. */
export function pickCurrentVersion(versions: AppStoreVersionResource[]): AppStoreVersionResource | null {
  const inFlight = versions.find((version) => nextReleaseAction(version.appStoreState) !== "live");
  return inFlight ?? versions[0] ?? null;
}

/** Options for {@link waitForValidBuild}: an injectable sleep keeps the poll loop unit-testable. */
export interface WaitOptions {
  /** Sleep this many ms between polls. Defaults to 30s. */
  intervalMs?: number;
  /** Give up after this long. Defaults to 30 min (Apple's processing usually lands well under it). */
  timeoutMs?: number;
  /** Delay primitive (injected in tests). Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Progress callback for each poll (e.g. log a dot). */
  onTick?: (state: string) => void;
}

/**
 * Poll a freshly uploaded build until it finishes processing to `VALID`. Throws on `INVALID` (with
 * Apple's state) or when the timeout elapses. The chosen build (with its resource id) is returned so
 * the caller can hand it to {@link releaseApp}.
 */
export async function waitForValidBuild(
  api: AscReleaseApi,
  appId: string,
  buildNumber: number,
  options: WaitOptions = {},
): Promise<BuildResource> {
  const intervalMs = options.intervalMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let waited = 0;
  for (;;) {
    const build = await api.findBuildByVersion(appId, buildNumber);
    const state = build?.processingState ?? "PROCESSING";
    options.onTick?.(state);
    if (build && state === "VALID") return build;
    if (state === "INVALID") {
      throw new Error(
        `Build ${buildNumber} failed App Store Connect processing (INVALID) — check the email Apple sent.`,
      );
    }
    if (waited >= timeoutMs) {
      throw new Error(
        `Build ${buildNumber} is still ${state} after ${Math.round(timeoutMs / 60_000)} min. ` +
          `Re-run \`launch release ios --build ${buildNumber}\` once \`launch status\` shows it VALID.`,
      );
    }
    await sleep(intervalMs);
    waited += intervalMs;
  }
}
