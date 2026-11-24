// The options, prepared context, and upload receipt for one build run.

import type { AppDescriptor, Distribution, Platform, PlayTrack } from './app.ts';
import type { SizeReport } from './artifacts.ts';
import type { LaunchConfig, ResolvedBuildContext } from './config.ts';
import type { MutableDeep } from './mutable.ts';
import type { RemoteTarget } from './remote.ts';
import type { Logger } from '../services/platform/logger.ts';
import type { BumpKind } from '../release/version.ts';

/** Options for one `launch-store build` invocation. */
export type BuildRunOptions = {
  platform: Platform;
  appName?: string | undefined;
  profileName: string;
  explain: boolean;
  submit: boolean;
  track?: PlayTrack;
  rollout?: number;
  /** Android only - path to a JSON file mapping language codes to release-note text. */
  notesPath?: string;
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
  bump?: BumpKind | 'ask';
};

/** The shared front half of every build path: config + app + profile + validated env + a logger. */
export type PreparedBuild = {
  config: LaunchConfig;
  app: MutableDeep<AppDescriptor>;
  profile: ResolvedBuildContext['profile'];
  env: Record<string, string>;
  buildContext: MutableDeep<ResolvedBuildContext>;
  log: Logger;
};

/** The contract every build fork satisfies */
/** Which build fork a run resolves to, plus the data that fork needs. */
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

/** How the marketing-version bump gets chosen for one run. */
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
