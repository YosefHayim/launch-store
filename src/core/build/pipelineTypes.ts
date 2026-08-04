import type {
  AppDescriptor,
  Distribution,
  Platform,
  PlayTrack,
  SubmitTarget,
} from '../types/app.js';
import type { SizeReport } from '../types/artifacts.js';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.js';
import type { RemoteTarget } from '../types/remote.js';
import type { Logger } from '../services/logger.js';
import type { BumpKind } from '../release/version.js';
import type { Effect } from 'effect';
/** Options for one `launch build` invocation. */
export type BuildRunOptions = {
  platform: Platform;
  appName?: string | undefined;
  profileName: string;
  explain: boolean;
  submit: boolean;
  target: SubmitTarget;
  track?: PlayTrack;
  rollout?: number;
  dryRun: boolean;
  sizeBudgetMB?: number;
  yes?: boolean;
  forceClean?: boolean;
  ccache?: boolean;
  remote?: RemoteTarget;
  account?: string;
  distribution?: Distribution;
  envOverrides?: Record<string, string>;
  includeLocal?: boolean;
  printEnv?: boolean;
  bump?: BumpKind | 'ask';
};
/**
 * The shared front half of every build path: config + app + profile + validated env + a logger.
 *
 * Produced by {@link prepareBuild} and consumed by the local spine ({@link runLocalBuild}), the remote
 * pipeline (`core/remotePipeline.ts`), and the EAS handoff (`core/easPipeline.ts`) so all three select
 * the app, validate `.env`, and log the header identically - the divergence is only in HOW they build.
 */
export type PreparedBuild = {
  config: LaunchConfig;
  app: AppDescriptor;
  profile: ResolvedBuildContext['profile'];
  env: Record<string, string>;
  buildContext: ResolvedBuildContext;
  log: Logger;
};
/** Placeholder API key used in `--dry-run`, so the flow runs without an imported credential. */
export const DRY_RUN_KEY = { keyId: 'DRYRUN', issuerId: 'DRYRUN', p8: '' };
/** The soft size budget (MB) applied when neither the run nor the profile sets one. */
export const DEFAULT_SIZE_BUDGET_MB = 200;
/**
 * The contract every build fork satisfies: take the shared {@link PreparedBuild} front half plus the run
 * options and drive the build (and optional submit) to completion. The three adapters - the local Mac
 * spine ({@link runLocalBuild}), the remote-Mac pipeline (`core/remotePipeline.ts`), and the EAS handoff
 * (`core/easPipeline.ts`) - are interchangeable behind this type; {@link resolveBuildTransport} picks
 * which one a run uses and {@link dispatchBuild} invokes it. Naming the contract is what turns fork
 * selection into a testable seam rather than an inline branch.
 */
export type BuildTransport<Requirements> = (
  prepared: PreparedBuild,
  options: BuildRunOptions,
) => Effect.Effect<void, unknown, Requirements>;
/**
 * Which build fork a run resolves to, plus the data that fork needs. A discriminated union so the remote
 * {@link RemoteTarget} rides only on the `remote` variant (no optional-but-always-set field): `local`
 * builds on this machine, `remote` on a Mac elsewhere, `eas` in Expo's cloud.
 */
export type BuildTransportChoice =
  | {
      kind: 'local';
    }
  | {
      kind: 'remote';
      remote: RemoteTarget;
    }
  | {
      kind: 'eas';
    };
/**
 * How the marketing-version bump gets chosen for one run. `apply` carries the resolved {@link BumpKind}
 * and where it came from; `prompt` runs the interactive picker; `leave` keeps the app-config version as-is.
 */
export type BumpResolution =
  | {
      mode: 'apply';
      kind: BumpKind;
      source: 'flag' | 'remembered';
    }
  | {
      mode: 'prompt';
    }
  | {
      mode: 'leave';
    };
/** What {@link BuildEngine.build} resolves to - named so the build-log wrapper can pass it through. */
export type BuildOutput = {
  artifactPath: string;
  sizeReport: SizeReport;
  cleanBuilt: boolean;
};
/** Inputs for the pre-upload checkpoint {@link confirmUpload}. */
export type ConfirmUploadOptions = {
  report: SizeReport;
  budgetMB: number;
  destination: string;
  app: AppDescriptor;
  version: string;
  buildNumber: number;
  previous?:
    | {
        downloadBytes: number;
        buildNumber: number;
      }
    | undefined;
  yes: boolean;
  log: Logger;
};
/** Inputs for the end-of-run {@link renderReceipt} summary. */
export type ReceiptOptions = {
  app: AppDescriptor;
  version: string;
  buildNumber: number;
  report: SizeReport;
  destination: string;
  link?: string | undefined;
  log: Logger;
};
