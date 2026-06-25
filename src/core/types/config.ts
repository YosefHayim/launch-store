/**
 * The top-level {@link LaunchConfig} the user authors, the {@link StorageConfig} backend union, and the
 * {@link ResolvedBuildContext} the build→submit pipeline threads through every stage.
 */

import type { AndroidReleaseOptions, AppDescriptor, BuildProfile, Distribution, Platform } from "./app.js";
import type { AppProducts } from "./catalog.js";
import type { AwsConfig } from "./remote.js";
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
} from "./storeSurface.js";

/**
 * The fully-resolved configuration for one `launch` invocation.
 *
 * Produced by {@link loadConfig} from `launch.config.ts` plus auto-discovered apps. Names here
 * (`storage`, `credentials`, `buildEngine`) are looked up in the provider registry at runtime.
 */
export interface LaunchConfig {
  /** Build profiles keyed by name. */
  profiles: Record<string, BuildProfile>;
  /** Registered name of the credentials provider to use. Defaults to `local` (serves both platforms). */
  credentials: string;
  /** Registered name of the artifact storage provider to use. Defaults to `local`. */
  storage: string;
  /**
   * Registered name of the build engine. Carries the iOS default `fastlane` (or `eas` for the cloud
   * handoff); an Android build swaps that iOS baseline for its twin `gradle` unless overridden here.
   */
  buildEngine: string;
  /**
   * Registered name of the submitter. Carries the iOS default `app-store-connect` (or `eas`); an
   * Android build swaps that iOS baseline for its twin `google-play` unless overridden here.
   */
  submit: string;
  /** Glob roots to scan for apps. Defaults to the repo root. */
  appRoots?: string[];
  /**
   * Declarative App Store Connect product catalog, keyed by iOS bundle id. Drives `launch sync`, which
   * reconciles each app's subscriptions, in-app purchases, and pricing on App Store Connect to match
   * this. Absent for apps that sell nothing. See {@link AppProducts}.
   */
  products?: Record<string, AppProducts>;
  /** Build/submit completion notifications (webhook + shell hook). Absent = no notifications. See {@link NotifyConfig}. */
  notify?: NotifyConfig;
  /**
   * iOS public-release policy for `launch release` (release type, scheduled date, phased rollout,
   * export compliance, release notes). Absent = the safe defaults (go live after approval, all at
   * once). See {@link ReleaseConfig}.
   */
  release?: ReleaseConfig;
  /**
   * Game Center achievements & leaderboards, keyed by iOS bundle id. Drives `launch game-center`. The
   * single-config form of `gamecenter.config.json` (still accepted for back-compat). See {@link GameCenterConfig}.
   */
  gameCenter?: Record<string, GameCenterConfig>;
  /**
   * App Clip card metadata, keyed by the parent app's iOS bundle id. Drives `launch app-clips`. The
   * single-config form of `appclips.config.json` (still accepted for back-compat). See {@link AppClipsConfig}.
   */
  appClips?: Record<string, AppClipsConfig>;
  /**
   * App Store release attributes (age rating, categories, price, review details), keyed by iOS bundle id.
   * Drives `launch release-config`. The single-config form of `release.config.json` (still accepted for
   * back-compat). Distinct from {@link LaunchConfig.release} (the release *policy*). See {@link ReleaseAttributesConfig}.
   */
  releaseAttributes?: Record<string, ReleaseAttributesConfig>;
  /**
   * Team-level Apple Pay merchant ids & Wallet pass type ids. Drives `launch wallet`. The single-config
   * form of `wallet.config.json` (still accepted for back-compat). See {@link WalletConfig}.
   */
  wallet?: WalletConfig;
  /**
   * Team-level EU alternative-distribution domains (DMA). Drives `launch eu-distribution`. The
   * single-config form of `eu-distribution.config.json` (still accepted for back-compat). See {@link EuDistributionConfig}.
   */
  euDistribution?: EuDistributionConfig;
  /**
   * Optional non-default paths for the sidecar-only surfaces' `*.config.json` files (availability,
   * accessibility, experiments, custom pages). Lets `launch plan` / `launch drift` find a sidecar that
   * isn't at its default filename, since those surfaces have no typed field here. Omit to use defaults.
   * See {@link SurfaceConfigFiles}.
   */
  configFiles?: SurfaceConfigFiles;
  /** AWS EC2 Mac settings for remote (off-Mac) builds. Only needed when building via `--remote aws`. */
  aws?: AwsConfig;
  /**
   * Bucket/endpoint settings for a cloud {@link StorageProvider} (`s3` / `supabase`). Required when
   * `storage` names a cloud provider — it's where ad-hoc install links and OTA update manifests are
   * hosted. Secrets stay out: access keys resolve from env / the OS secret store, never from here.
   */
  storageConfig?: StorageConfig;
  /**
   * Where the `local` storage provider writes build binaries and raw objects (install plists, OTA
   * manifests). A relative path resolves against the project root (the `launch.config.ts` directory); a
   * leading `~/` expands to the home directory; an absolute path is used as-is. Omit to use the global
   * `~/.launch/artifacts` (the default — existing projects are unaffected). `launch init` and the no-args
   * wizard scaffold this as the in-repo `./.launch/artifacts` and add it to `.gitignore`, so build
   * binaries never get committed. Only the `local` provider observes it — cloud stores key off
   * {@link StorageConfig}. The history index stays under `~/.launch`, so build history and retention span
   * projects regardless of where the binaries land.
   */
  artifactDir?: string;
  /**
   * How many days a local build binary is kept before the artifact store auto-prunes it to reclaim disk
   * (the newest build per app+platform is always kept, so a promotable artifact never disappears). Runs
   * after each successful local build. Defaults to 30 when omitted; set to `0` to disable the automatic
   * sweep entirely (`launch builds prune` still works on demand). Only the `local` provider observes
   * this — cloud stores manage retention through their own bucket lifecycle rules.
   */
  artifactRetentionDays?: number;
  /**
   * Env var names that must NEVER be injected into a build — a hard denylist applied across every layer
   * (`.env`, `.env.<profile>`, keychain, profile `env:`, even an explicit `--env`). A matched name is
   * dropped outright, so it can't reach the build subprocess and therefore can't be baked into the shipped
   * app even by an `app.config.js` that forwards `process.env`.
   *
   * Each entry is either an exact, case-sensitive name or a `PREFIX*` wildcard: `OPENAI_*` drops every
   * name starting with `OPENAI_` (e.g. `OPENAI_API_KEY`, `OPENAI_ORG_ID`), so a whole family of backend
   * keys collapses to one line instead of being listed individually. Wildcards anchor at the START — there
   * is no tail/`*_KEY` form, by design, since that would also snag a publishable `EXPO_PUBLIC_..._KEY`.
   *
   * This is the home for *backend-only* values that sit in the app's `.env` for local tooling but must
   * never ship (e.g. `OPENAI_API_KEY`, a server-side `SENTRY_AUTH_TOKEN`). It is distinct from
   * `launch secret set`: a stored secret is still *injected* — the build needs it — it's just moved out
   * of plaintext; `envExclude` means "don't inject this at all". A name matched here is exempt from the
   * `.env.example` missing-key gate (even when no layer sets it). Omit (or `[]`) to exclude nothing.
   */
  envExclude?: string[];
  /**
   * How `launch mcp` exposes Launch to AI agents — chiefly which capability tiers it may offer. Absent =
   * least privilege (read-only tools). See {@link McpConfig}.
   */
  mcp?: McpConfig;
}

/**
 * Non-secret settings for a cloud {@link StorageProvider}. Launch writes static artifacts (install
 * plists, OTA manifests, JS bundles, IPAs/AABs) here and serves them from {@link StorageConfig.publicBaseUrl},
 * so the user owns the infra (no Launch-hosted server). Credentials are NEVER stored here — the S3
 * access key / Supabase service key resolve from env vars or the OS secret store at call time.
 */
export interface StorageConfig {
  /**
   * S3-compatible endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` (Cloudflare R2),
   * a Backblaze B2 / MinIO endpoint, etc. Omit for AWS S3 (the SDK derives it from the region).
   * Unused by the `supabase` provider.
   */
  endpoint?: string;
  /** Bucket name (S3-compatible) or storage bucket id (Supabase). */
  bucket: string;
  /** Region for an S3-compatible provider. Defaults to `auto` (correct for R2) when omitted; unused by Supabase. */
  region?: string;
  /**
   * Public base URL that maps to the bucket root — used to build install links and OTA manifest URLs.
   * e.g. an R2 custom domain `https://cdn.example.com`, or a Supabase public object URL prefix
   * `https://<project>.supabase.co/storage/v1/object/public/<bucket>`. No trailing slash required.
   */
  publicBaseUrl: string;
  /** Supabase project URL (`https://<project>.supabase.co`). Required by `supabase`, unused by `s3`. */
  supabaseUrl?: string;
}

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
