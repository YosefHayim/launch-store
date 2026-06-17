/**
 * Shared vocabulary for the readiness layer — the read-only "is this actually shippable?" checks that
 * back `launch store doctor` (account onboarding) and, as they land, `launch audit` (pre-submit blockers)
 * and `launch iap doctor` (in-app-purchase verification).
 *
 * Where `core/plan` *diffs* config against live state, readiness *grades* live state against the store's
 * submission prerequisites. The mechanism mirrors the {@link import("../plan/types.js").SurfacePlanner}
 * registry exactly: each check is one {@link ReadinessProbe}, registered by id and tagged with the
 * {@link ReadinessCategory categories} it belongs to; a command is a thin **selector** over those tags
 * (store doctor = `account`, iap doctor = `iap`, audit = every submit-blocking probe). Adding a check is a
 * new probe file + one `registerReadinessProbe()` line — the orchestrator never names a concrete probe.
 *
 * These types describe the readiness *mechanism*, not a config shape, so — like `core/plan/types.ts` —
 * they live here beside the feature rather than in `core/types.ts` (which owns config + provider shapes).
 */

import type { AppDescriptor, LaunchConfig } from "../types.js";

/** Which store a probe reads from — drives credential resolution and how the report is grouped. */
export type ReadinessStore = "appstore" | "play";

/**
 * The tag(s) a probe is filed under, so a command selects the slice it cares about without naming probes:
 * - `account` — store-account onboarding prerequisites (agreements, app record, track readiness).
 * - `iap` — in-app-purchase / subscription shippability.
 * - `listing` — store-listing completeness (copy, screenshots, URLs).
 * - `privacy` — privacy-declaration / permissions reconciliation.
 * - `signing` — distribution certificate / profile / Play signing health.
 * - `submit` — the cross-cutting "would this be rejected at submission?" selector behind `launch audit`. A
 *   probe carries `submit` *in addition to* its domain tag when its failure blocks a submission, so audit
 *   is one selector over every blocking check and grows automatically as the family adds blocking probes.
 * The union grows as the family lands; a probe may carry several tags when a check matters to more than
 * one command (e.g. "subscription group ready" is both `account` and `iap`; "app record exists" is both
 * `account` and `submit`).
 */
export type ReadinessCategory = "account" | "iap" | "listing" | "privacy" | "signing" | "submit";

/**
 * One app's finding for one probe. A probe maps an **expected** "not ready" condition (a missing app
 * record, no uploaded build) to a `blocker`/`warn` finding here; only an **unexpected** read failure is
 * allowed to throw, which the orchestrator records as an errored probe (see {@link ProbeOutcome}). So a
 * finding is always a successful read — never an infrastructure error in disguise.
 */
export interface AppReadiness {
  /** App handle as discovered (used for grouping and the `-a` selector). */
  app: string;
  /** The app's identifier on this store — iOS bundle id / Android package name. */
  identifier: string;
  /** `ok` shippable · `warn` advisory (recommended, not required) · `blocker` will cause rejection/failure. */
  status: "ok" | "warn" | "blocker";
  /** One-line plain-English summary of what was found, shown after the probe title. */
  detail: string;
  /** Optional actionable next step, shown dimmed under a `warn`/`blocker`. */
  hint?: string;
}

/**
 * What a probe returns. A discriminated union mirroring {@link import("../plan/types.js").SurfacePlan}:
 * - `omitted` — nothing in scope for this probe (e.g. no subscriptions declared); dropped from output.
 * - `skipped` — the store's credentials aren't configured, so the check couldn't run; benign (exit 0)
 *   but surfaced with a hint, since a doctor that can't reach an account should say so.
 * - `checked` — the probe ran; `apps` carries the per-app findings.
 */
export type ProbeResult =
  | { state: "omitted" }
  | { state: "skipped"; reason: string; hint?: string }
  | { state: "checked"; apps: AppReadiness[] };

/**
 * A {@link ProbeResult} plus the `errored` state the orchestrator synthesizes when a probe throws
 * unexpectedly (a real read failure, not a "not ready" finding). Kept distinct from `blocker` so the exit
 * code can separate "couldn't certify" (exit 1) from "certified: found blockers" (exit 2).
 */
export type ProbeOutcome = ProbeResult | { state: "errored"; error: string };

/**
 * One probe's resolved report, as rendered and serialized to `--json`. The orchestrator stamps the
 * probe's identity onto its {@link ProbeOutcome} so a probe never restates its own id/title/store.
 */
export interface ProbeReport {
  /** Stable probe key (shown in the report and usable for future per-probe scoping). */
  id: string;
  /** Human-readable probe title. */
  title: string;
  /** The store this probe read from. */
  store: ReadinessStore;
  /** What the probe found (or that it was skipped/omitted/errored). */
  outcome: ProbeOutcome;
}

/**
 * The read-only App Store Connect surface the readiness probes share — exactly the methods they call,
 * nothing more. `AppStoreConnectClient` satisfies this structurally (every method already exists on it),
 * so the resolver from `core/storeClients.ts` is assignable here with no cast. Grows by one method as
 * each new Apple probe lands.
 */
export interface AscReadinessApi {
  /** The app's App Store Connect id for a bundle id, or `null` when no app record exists. */
  getAppId(bundleId: string): Promise<string | null>;
  /**
   * Whether the account's required legal agreements (Developer Program License, Paid Applications,
   * banking/tax) are signed and in effect. `false` means one is missing/expired — a 403 blocker on every
   * upload. Throws only on an unexpected read failure (not the agreements 403).
   */
  checkRequiredAgreements(): Promise<boolean>;
  /** The app's auto-renewable subscription groups (only `id` is needed to assert presence / list members). */
  listSubscriptionGroups(appId: string): Promise<{ id: string }[]>;
  /** The registered Bundle ID (App ID) for an identifier, or `null` when it isn't registered yet. */
  findBundleId(identifier: string): Promise<{ id: string } | null>;
  /** The team's distribution certificates (only `id` + `expirationDate` are needed to grade validity). */
  listDistributionCertificates(): Promise<{ id: string; expirationDate?: string | undefined }[]>;
  /** The app's one-time in-app purchases (Apple `productId` + lifecycle `state`, to match config + grade readiness). */
  listInAppPurchases(appId: string): Promise<{ productId: string; state?: string | undefined }[]>;
  /** A subscription group's subscriptions (Apple `productId` + lifecycle `state`). */
  listSubscriptions(groupId: string): Promise<{ productId: string; state?: string | undefined }[]>;
}

/**
 * The read-only Google Play surface the readiness probes share — the Play counterpart to
 * {@link AscReadinessApi}. `GooglePlayClient` satisfies it structurally.
 */
export interface PlayReadinessApi {
  /** Throws when the app doesn't exist or the service account can't access it; resolves otherwise. */
  assertAppExists(packageName: string): Promise<void>;
  /** Highest uploaded bundle `versionCode`, or `0` when nothing has been uploaded yet. */
  getLatestVersionCode(packageName: string): Promise<number>;
  /** Every track on the app (only `track` is needed to assert a track's presence). */
  listTracks(packageName: string): Promise<{ track: string }[]>;
}

/**
 * What a {@link ReadinessProbe} is handed: the loaded config, the apps in scope (already narrowed by
 * `-a`), and the lazy, memoized store-client resolvers from `core/storeClients.ts`. A resolver returns
 * `null` when the account isn't configured, letting the probe emit a `skipped` result instead of throwing.
 */
export interface ReadinessContext {
  config: LaunchConfig;
  apps: AppDescriptor[];
  /** Resolve the read-only App Store Connect client, or `null` when no Apple account is active. */
  resolveAscApi(): Promise<AscReadinessApi | null>;
  /** Resolve the read-only Google Play client, or `null` when no Play service account is configured. */
  resolvePlayApi(): Promise<PlayReadinessApi | null>;
}

/**
 * One readiness check. {@link check} is **read-only**: it resolves live state and classifies it, never
 * writing. Registered like a provider/planner (see {@link import("./registry.js")}); the orchestrator
 * resolves every selected probe and never names a concrete one.
 */
export interface ReadinessProbe {
  /** Stable probe key shown in the report. */
  id: string;
  /** Human-readable title for the report line. */
  title: string;
  /** Which store this probe reads from. */
  store: ReadinessStore;
  /** The category tags this probe is filed under, used by a command to select it. */
  categories: readonly ReadinessCategory[];
  /** Read live state for the in-scope apps and classify it, performing no writes. */
  check(ctx: ReadinessContext): Promise<ProbeResult>;
}

/**
 * The aggregate result of a readiness run, structured so the command can render it and `--json` can
 * serialize it verbatim. `reports` excludes omitted probes; the counts drive both the summary line and
 * the exit code (see {@link import("./orchestrator.js").readinessExitCode}).
 */
export interface ReadinessOutcome {
  /** Every probe that produced output (omitted probes dropped). */
  reports: ProbeReport[];
  /** Per-app `ok` findings across all probes. */
  okCount: number;
  /** Per-app `warn` findings (advisory; do not affect the exit code). */
  warnCount: number;
  /** Per-app `blocker` findings — the "exit 2" signal. */
  blockerCount: number;
  /** Probes that threw while reading — the "exit 1" signal (takes precedence over blockers). */
  errorCount: number;
  /** Probes skipped for missing credentials (benign; surfaced with a hint). */
  skippedCount: number;
  /** The resolved process exit code per the readiness contract. */
  exitCode: number;
}
