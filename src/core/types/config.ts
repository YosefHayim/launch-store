/**
 * The top-level {@link LaunchConfig} the user authors, the {@link StorageConfig} backend shape, and the
 * {@link ResolvedBuildContext} the build→submit pipeline threads through every stage.
 *
 * Runtime validation is owned by the Effect Schema boundary in `src/core/config/schema.ts`
 * (see [ADR 0013](../../../docs/adr/0013-effect-schema-config-ssot.md)). Domain field types live as
 * plain TypeScript interfaces beside this module; defaults for omitted provider names live here so
 * `defineConfig` and the schema cannot disagree.
 */

import type {
  AndroidReleaseOptions,
  AppDescriptor,
  BuildProfile,
  Distribution,
  Platform,
} from './app.js';
import type { AppProducts } from './catalog.js';
import type { AwsConfig } from './remote.js';
import type {
  AppClipsConfig,
  EuDistributionConfig,
  GameCenterConfig,
  McpConfig,
  NotifyConfig,
  ReleaseAttributesConfig,
  ReleaseConfig,
  SurfaceConfigFiles,
  WalletConfig,
} from './storeSurface.js';

/**
 * Provider defaults filled when the user omits them — the single source for both the Effect Schema's
 * defaults and `defineConfig` (which fills them without parsing, so it can preserve unknown top-level
 * keys for #197). Keeping them here means the two paths can't disagree on a default.
 */
export const DEFAULT_CREDENTIALS_PROVIDER = 'local';
export const DEFAULT_STORAGE_PROVIDER = 'local';
export const DEFAULT_BUILD_ENGINE = 'fastlane';
export const DEFAULT_SUBMITTER = 'app-store-connect';

/**
 * The multi-store form of {@link LaunchConfig.submit}: a per-platform list of registered `Submitter`
 * names a build for that {@link Platform} is uploaded to, in order.
 */
export type SubmitByPlatform = Partial<Record<Platform, string[]>>;

/**
 * Non-secret settings for a cloud {@link StorageProvider}.
 * Credentials are NEVER stored here — keys resolve from env or the OS secret store.
 */
export interface StorageConfig {
  /** S3-compatible endpoint. Omit for AWS S3. Unused by `supabase`. */
  endpoint?: string;
  /** Bucket name (S3-compatible) or storage bucket id (Supabase). */
  bucket: string;
  /** Region for an S3-compatible provider. Defaults to `auto` for R2. */
  region?: string;
  /** Public base URL that maps to the bucket root (install links, OTA manifests). */
  publicBaseUrl: string;
  /** Supabase project URL. Required by `supabase`, unused by `s3`. */
  supabaseUrl?: string;
}

/**
 * Fully-resolved configuration for one `launch` invocation (provider defaults filled).
 * Names here (`storage`, `credentials`, `buildEngine`) are looked up in the provider registry at runtime.
 */
export interface LaunchConfig {
  /** Build profiles keyed by name. */
  profiles: Record<string, BuildProfile>;
  /** Registered credentials provider name. Defaults to `local`. */
  credentials: string;
  /** Registered storage provider name. Defaults to `local`. */
  storage: string;
  /** Registered build engine name. Defaults to `fastlane`. */
  buildEngine: string;
  /**
   * Where built artifacts are submitted: a single submitter name, or a per-platform
   * {@link SubmitByPlatform} map. Defaults to `app-store-connect`.
   */
  submit: string | SubmitByPlatform;
  /** Glob roots to scan for apps. Defaults to the repo root. */
  appRoots?: string[];
  /** Declarative product catalog keyed by iOS bundle id. */
  products?: Record<string, AppProducts>;
  /** Build/submit completion notifications. */
  notify?: NotifyConfig;
  /** iOS public-release policy for `launch release`. */
  release?: ReleaseConfig;
  /** Game Center config keyed by iOS bundle id. */
  gameCenter?: Record<string, GameCenterConfig>;
  /** App Clip card metadata keyed by parent app iOS bundle id. */
  appClips?: Record<string, AppClipsConfig>;
  /** Release attributes keyed by iOS bundle id. */
  releaseAttributes?: Record<string, ReleaseAttributesConfig>;
  /** Team-level Apple Pay / Wallet ids. */
  wallet?: WalletConfig;
  /** Team-level EU alternative-distribution domains. */
  euDistribution?: EuDistributionConfig;
  /** Optional non-default paths for sidecar-only surfaces. */
  configFiles?: SurfaceConfigFiles;
  /** AWS EC2 Mac settings for remote builds. */
  aws?: AwsConfig;
  /** Bucket/endpoint settings for cloud storage providers. */
  storageConfig?: StorageConfig;
  /** Local artifact directory (local storage provider only). */
  artifactDir?: string;
  /** Days to keep local build binaries before auto-prune. */
  artifactRetentionDays?: number;
  /** Env var names that must never be injected into a build. */
  envExclude?: string[];
  /** MCP capability tiers. */
  mcp?: McpConfig;
}

/**
 * Input to {@link defineConfig}: the shape a user authors in `launch.config.ts`.
 * Provider names are optional (they default via {@link DEFAULT_CREDENTIALS_PROVIDER} etc.).
 */
export type LaunchConfigInput = Omit<
  LaunchConfig,
  'credentials' | 'storage' | 'buildEngine' | 'submit'
> & {
  credentials?: string;
  storage?: string;
  buildEngine?: string;
  submit?: string | SubmitByPlatform;
};

/**
 * Everything a single build needs, assembled before any work starts.
 *
 * This is the value threaded through the whole pipeline and into every provider, so a provider
 * never has to re-derive the app, profile, or environment.
 */
export interface ResolvedBuildContext {
  platform: Platform;
  app: AppDescriptor;
  profile: BuildProfile;
  /** Client-facing env vars (from the profile's `.env`) injected into the app at build time. */
  env: Record<string, string>;
  /** Whether to expand each step into a teaching block (`--explain`). */
  explain: boolean;
  /** Rehearse the flow: print every step and the exact commands/requests, make no real changes. */
  dryRun: boolean;
  /**
   * Force a from-scratch (clean) build, set from `launch build --clean`. When false (the default) the
   * build engine decides clean-vs-incremental from the build fingerprint (see `core/buildFingerprint.ts`).
   */
  forceClean: boolean;
  /** Whether ccache is allowed for this build. `false` comes from `launch build --no-ccache`. */
  ccache?: boolean;
  /** Resolved Android track + rollout. Present only for Android builds; the submitter reads it. */
  android?: AndroidReleaseOptions;
  /**
   * How this build is distributed (`store` default, or `internal` for an ad-hoc install link). Read by
   * the build engine to pick the export method (ad-hoc vs app-store / APK vs AAB) and by the pipeline
   * to choose the distribute-vs-submit tail. Absent is treated as `store`.
   */
  distribution?: Distribution;
  /**
   * Key ID of the Apple account resolved for this iOS run (from `--account`/`ASC_ACCOUNT`, the active
   * account, or the build-time picker). The `local` credentials provider loads this account's key and
   * signing assets. Absent on Android and on iOS dry-runs (which use the placeholder key).
   */
  account?: string;
}
