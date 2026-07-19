/**
 * Shared types and constants for the build pipeline.
 *
 * Kept free of runtime orchestration so phase modules can import shapes without circular deps.
 */

import type {
  AppDescriptor,
  Distribution,
  LaunchConfig,
  Platform,
  PlayTrack,
  RemoteTarget,
  ResolvedBuildContext,
  SizeReport,
  SubmitTarget,
} from '../types/index.js';
import type { Logger } from '../services/logger.js';
import type { BumpKind } from '../release/version.js';

/** Options for one `launch build` invocation. */
export interface BuildRunOptions {
  platform: Platform;
  /** App handle (`--app`); when omitted the pipeline picks the only app or prompts. */
  appName?: string | undefined;
  /** Profile name (`--profile`); defaults to `production`. */
  profileName: string;
  /** Expand each step into a teaching block (`--explain`). */
  explain: boolean;
  /** Upload after building (`--no-submit` disables). */
  submit: boolean;
  /** Where a submission lands (testing track vs production). */
  target: SubmitTarget;
  /** Android-only: Play track override (`--track`). Falls back to the profile, then `internal`. */
  track?: PlayTrack;
  /** Android-only: staged-rollout fraction override (`--rollout`), 0–1. Falls back to the profile, then 1. */
  rollout?: number;
  /** Rehearse the flow with no real changes (`--dry-run`). */
  dryRun: boolean;
  /**
   * Per-run soft size-budget override in MB (`--size-budget`, or the wizard's custom-budget prompt). When
   * set it wins over the profile's `sizeBudgetMB` for this build only — `launch.config.ts` is untouched.
   * See {@link resolveSizeBudgetMB}.
   */
  sizeBudgetMB?: number;
  /** Skip the interactive pre-upload confirmation (`--yes`); always implied in CI / non-TTY. */
  yes?: boolean;
  /** Force a from-scratch build (`--clean`); omitted/false lets the fingerprint decide. iOS-gated; Android cleans too. */
  forceClean?: boolean;
  /** Disable ccache for this build (`--no-ccache`), useful for monorepo extension targets with broken RN shim paths. */
  ccache?: boolean;
  /** Build on a remote Mac (AWS EC2 Mac / a Mac over SSH) instead of locally. iOS-only. */
  remote?: RemoteTarget;
  /** Apple account to build with (`--account`): a label or Key ID. Defaults to the active account. iOS-only. */
  account?: string;
  /** How to distribute (`--distribution`): `store` (default, TestFlight/Play) or `internal` (ad-hoc install link). */
  distribution?: Distribution;
  /** Inline env overrides from repeated `--env KEY=VAL`; the highest-precedence layer. */
  envOverrides?: Record<string, string>;
  /** Opt into `.env.local` (`--include-local`); off by default to avoid surprise local env. */
  includeLocal?: boolean;
  /** Print the resolved env provenance table (`--print-env`) and exit without building. */
  printEnv?: boolean;
  /**
   * iOS version-bump selector (`--bump`). A {@link BumpKind} applies that bump non-interactively (and wins
   * over a remembered pick); `"ask"` forces the prompt; omitted falls back to the remembered pick, then the
   * prompt. See {@link resolveBumpKind}.
   */
  bump?: BumpKind | 'ask';
}

/**
 * The shared front half of every build path: config + app + profile + validated env + a logger.
 *
 * Produced by {@link prepareBuild} and consumed by the local spine ({@link runLocalBuild}), the remote
 * pipeline (`core/remotePipeline.ts`), and the EAS handoff (`core/easPipeline.ts`) so all three select
 * the app, validate `.env`, and log the header identically — the divergence is only in HOW they build.
 */
export interface PreparedBuild {
  config: LaunchConfig;
  app: AppDescriptor;
  profile: ResolvedBuildContext['profile'];
  env: Record<string, string>;
  ctx: ResolvedBuildContext;
  log: Logger;
}

/** Placeholder API key used in `--dry-run`, so the flow runs without an imported credential. */
export const DRY_RUN_KEY = { keyId: 'DRYRUN', issuerId: 'DRYRUN', p8: '' };

/** The soft size budget (MB) applied when neither the run nor the profile sets one. */
export const DEFAULT_SIZE_BUDGET_MB = 200;

/**
 * The contract every build fork satisfies: take the shared {@link PreparedBuild} front half plus the run
 * options and drive the build (and optional submit) to completion. The three adapters — the local Mac
 * spine ({@link runLocalBuild}), the remote-Mac pipeline (`core/remotePipeline.ts`), and the EAS handoff
 * (`core/easPipeline.ts`) — are interchangeable behind this type; {@link resolveBuildTransport} picks
 * which one a run uses and {@link dispatchBuild} invokes it. Naming the contract is what turns fork
 * selection into a testable seam rather than an inline branch.
 */
export type BuildTransport = (prepared: PreparedBuild, options: BuildRunOptions) => Promise<void>;

/**
 * Which build fork a run resolves to, plus the data that fork needs. A discriminated union so the remote
 * {@link RemoteTarget} rides only on the `remote` variant (no optional-but-always-set field): `local`
 * builds on this machine, `remote` on a Mac elsewhere, `eas` in Expo's cloud.
 */
export type BuildTransportChoice =
  | { kind: 'local' }
  | { kind: 'remote'; remote: RemoteTarget }
  | { kind: 'eas' };

/**
 * How the marketing-version bump gets chosen for one run. `apply` carries the resolved {@link BumpKind}
 * and where it came from; `prompt` runs the interactive picker; `leave` keeps the app-config version as-is.
 */
export type BumpResolution =
  | { mode: 'apply'; kind: BumpKind; source: 'flag' | 'remembered' }
  | { mode: 'prompt' }
  | { mode: 'leave' };

/** What {@link BuildEngine.build} resolves to — named so the build-log wrapper can pass it through. */
export interface BuildOutput {
  artifactPath: string;
  sizeReport: SizeReport;
  cleanBuilt: boolean;
}

/** Inputs for the pre-upload checkpoint {@link confirmUpload}. */
export interface ConfirmUploadOptions {
  report: SizeReport;
  /** Soft size budget in MB; an over-budget worst-case download leads the prompt with a warning. */
  budgetMB: number;
  /** Human destination, e.g. `"TestFlight"`, `"App Store review"`, or `"Google Play (internal track)"`. */
  destination: string;
  app: AppDescriptor;
  /** App version string, e.g. `1.0.0`. */
  version: string;
  /** Build number (iOS) or versionCode (Android) about to be uploaded. */
  buildNumber: number;
  /**
   * The previous stored build for this app+platform, for the upload-time size delta. Omitted on the
   * first build (nothing to compare against), in which case no delta line or growth warning is shown.
   */
  previous?: { downloadBytes: number; buildNumber: number } | undefined;
  /** `--yes`: skip the prompt and proceed (also implied in CI / non-TTY). */
  yes: boolean;
  log: Logger;
}

/** Inputs for the end-of-run {@link renderReceipt} summary. */
export interface ReceiptOptions {
  app: AppDescriptor;
  version: string;
  buildNumber: number;
  report: SizeReport;
  /** Where it landed, from {@link receiptDestination}. */
  destination: string;
  /** Best-effort console deep link; omitted in dry-run / `--no-submit` / when unresolved. */
  link?: string | undefined;
  log: Logger;
}
