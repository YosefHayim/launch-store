/**
 * The top-level {@link LaunchConfig} the user authors, the {@link StorageConfig} backend union, and the
 * {@link ResolvedBuildContext} the build→submit pipeline threads through every stage.
 *
 * `LaunchConfig` is the config SSOT: a single zod schema ({@link LaunchConfigSchema}) whose inferred
 * *output* type is `LaunchConfig` (provider defaults filled) and whose *input* type is
 * {@link LaunchConfigInput} (providers optional) — see
 * [ADR 0008](../../../docs/adr/0008-adopt-zod-config-ssot.md). The schema also generates
 * `schema/launch.config.schema.json` and validates configs, so the three artifacts can't drift.
 */

import { z } from 'zod';
import { BuildProfileSchema, PLATFORMS } from './app.js';
import type {
  AndroidReleaseOptions,
  AppDescriptor,
  BuildProfile,
  Distribution,
  Platform,
} from './app.js';
import { AppProductsSchema } from './catalog.js';
import { AwsConfigSchema } from './remote.js';
import {
  AppClipsConfigSchema,
  EuDistributionConfigSchema,
  GameCenterConfigSchema,
  McpConfigSchema,
  NotifyConfigSchema,
  ReleaseAttributesConfigSchema,
  ReleaseConfigSchema,
  SurfaceConfigFilesSchema,
  WalletConfigSchema,
} from './storeSurface.js';

/**
 * Provider defaults filled when the user omits them — the single source for both the schema's
 * `.default(...)` (which documents them and fills them on `.parse`) and `defineConfig` (which fills them
 * without running the schema, so it can preserve unknown top-level keys for #197). Keeping them here
 * means the two paths can't disagree on a default.
 */
export const DEFAULT_CREDENTIALS_PROVIDER = 'local';
export const DEFAULT_STORAGE_PROVIDER = 'local';
export const DEFAULT_BUILD_ENGINE = 'fastlane';
export const DEFAULT_SUBMITTER = 'app-store-connect';

/**
 * The multi-store form of {@link LaunchConfig.submit}: a per-platform list of registered `Submitter`
 * names a build for that {@link Platform} is uploaded to, in order.
 *
 * This is what decouples the **build target** (the platform you compile) from the **store** (where you
 * submit). One Android `.aab` can reach Google Play *and* alternative stores from a single
 * `launch.config.ts`; an Apple platform normally lists just `app-store-connect`. Omit a platform to fall
 * back to its standard store (Play for Android, App Store Connect for the Apple platforms). Each name
 * must resolve to a registered submitter — `launch config validate` flags an unknown one.
 */
export const SubmitByPlatformSchema = z.partialRecord(z.enum(PLATFORMS), z.array(z.string()));
export type SubmitByPlatform = z.infer<typeof SubmitByPlatformSchema>;

/**
 * Non-secret settings for a cloud {@link StorageProvider} — see {@link StorageConfigSchema}. Launch
 * writes static artifacts here and serves them from {@link StorageConfig.publicBaseUrl}. Credentials are
 * NEVER stored here — the S3 access key / Supabase service key resolve from env or the OS secret store.
 */
export const StorageConfigSchema = z
  .strictObject({
    endpoint: z
      .string()
      .describe(
        'S3-compatible endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` (Cloudflare R2), a Backblaze B2 / MinIO endpoint, etc. Omit for AWS S3 (the SDK derives it from the region). Unused by the `supabase` provider.',
      )
      .optional(),
    bucket: z.string().describe('Bucket name (S3-compatible) or storage bucket id (Supabase).'),
    region: z
      .string()
      .describe(
        'Region for an S3-compatible provider. Defaults to `auto` (correct for R2) when omitted; unused by Supabase.',
      )
      .optional(),
    publicBaseUrl: z
      .string()
      .describe(
        'Public base URL that maps to the bucket root — used to build install links and OTA manifest URLs. e.g. an R2 custom domain `https://cdn.example.com`, or a Supabase public object URL prefix `https://<project>.supabase.co/storage/v1/object/public/<bucket>`. No trailing slash required.',
      ),
    supabaseUrl: z
      .string()
      .describe(
        'Supabase project URL (`https://<project>.supabase.co`). Required by `supabase`, unused by `s3`.',
      )
      .optional(),
  })
  .meta({
    id: 'StorageConfig',
    description:
      'Non-secret settings for a cloud {@link StorageProvider}. Launch writes static artifacts (install plists, OTA manifests, JS bundles, IPAs/AABs) here and serves them from {@link StorageConfig.publicBaseUrl}, so the user owns the infra (no Launch-hosted server). Credentials are NEVER stored here — the S3 access key / Supabase service key resolve from env vars or the OS secret store at call time.',
  });
export type StorageConfig = z.infer<typeof StorageConfigSchema>;

/**
 * The configuration for one `launch` invocation — see {@link LaunchConfigSchema}. Produced by
 * {@link loadConfig} from `launch.config.ts` plus auto-discovered apps. `LaunchConfig` is the *output*
 * shape (provider defaults filled); {@link LaunchConfigInput} is what the user authors.
 */
export const LaunchConfigSchema = z
  .strictObject({
    profiles: z.record(z.string(), BuildProfileSchema).describe('Build profiles keyed by name.'),
    credentials: z
      .string()
      .describe(
        'Registered name of the credentials provider to use. Defaults to `local` (serves both platforms).',
      )
      .default(DEFAULT_CREDENTIALS_PROVIDER),
    storage: z
      .string()
      .describe('Registered name of the artifact storage provider to use. Defaults to `local`.')
      .default(DEFAULT_STORAGE_PROVIDER),
    buildEngine: z
      .string()
      .describe(
        'Registered name of the build engine. Carries the iOS default `fastlane` (or `eas` for the cloud handoff); an Android build swaps that iOS baseline for its twin `gradle` unless overridden here.',
      )
      .default(DEFAULT_BUILD_ENGINE),
    submit: z
      .union([z.string(), SubmitByPlatformSchema])
      .describe(
        'Where built artifacts are submitted, in one of two forms: a single registered submitter name (the iOS default `app-store-connect`, which an Android build swaps for its twin `google-play`; or `eas`) — the original, unchanged shape; or a per-platform {@link SubmitByPlatform} map, to fan one build out to several stores from this one config (e.g. an Android `.aab` to `google-play` and `amazon-appstore`). The pipeline resolves this to a store list per platform (see `resolveSubmitters`), so the build target and the store are no longer welded 1:1. See `docs/adr/0006-platform-store-split.md`.',
      )
      .default(DEFAULT_SUBMITTER),
    appRoots: z
      .array(z.string())
      .describe('Glob roots to scan for apps. Defaults to the repo root.')
      .optional(),
    products: z
      .record(z.string(), AppProductsSchema)
      .describe(
        "Declarative App Store Connect product catalog, keyed by iOS bundle id. Drives `launch sync`, which reconciles each app's subscriptions, in-app purchases, and pricing on App Store Connect to match this. Absent for apps that sell nothing. See {@link AppProducts}.",
      )
      .optional(),
    notify: NotifyConfigSchema.describe(
      'Build/submit completion notifications (webhook + shell hook). Absent = no notifications. See {@link NotifyConfig}.',
    ).optional(),
    release: ReleaseConfigSchema.describe(
      'iOS public-release policy for `launch release` (release type, scheduled date, phased rollout, export compliance, release notes). Absent = the safe defaults (go live after approval, all at once). See {@link ReleaseConfig}.',
    ).optional(),
    gameCenter: z
      .record(z.string(), GameCenterConfigSchema)
      .describe(
        'Game Center achievements & leaderboards, keyed by iOS bundle id. Drives `launch game-center`. The single-config form of `gamecenter.config.json` (still accepted for back-compat). See {@link GameCenterConfig}.',
      )
      .optional(),
    appClips: z
      .record(z.string(), AppClipsConfigSchema)
      .describe(
        "App Clip card metadata, keyed by the parent app's iOS bundle id. Drives `launch app-clips`. The single-config form of `appclips.config.json` (still accepted for back-compat). See {@link AppClipsConfig}.",
      )
      .optional(),
    releaseAttributes: z
      .record(z.string(), ReleaseAttributesConfigSchema)
      .describe(
        'App Store release attributes (age rating, categories, price, review details), keyed by iOS bundle id. Drives `launch release-config`. The single-config form of `release.config.json` (still accepted for back-compat). Distinct from {@link LaunchConfig.release} (the release policy). See {@link ReleaseAttributesConfig}.',
      )
      .optional(),
    wallet: WalletConfigSchema.describe(
      'Team-level Apple Pay merchant ids & Wallet pass type ids. Drives `launch wallet`. The single-config form of `wallet.config.json` (still accepted for back-compat). See {@link WalletConfig}.',
    ).optional(),
    euDistribution: EuDistributionConfigSchema.describe(
      'Team-level EU alternative-distribution domains (DMA). Drives `launch eu-distribution`. The single-config form of `eu-distribution.config.json` (still accepted for back-compat). See {@link EuDistributionConfig}.',
    ).optional(),
    configFiles: SurfaceConfigFilesSchema.describe(
      "Optional non-default paths for the sidecar-only surfaces' `*.config.json` files (availability, accessibility, experiments, custom pages). Lets `launch plan` / `launch drift` find a sidecar that isn't at its default filename, since those surfaces have no typed field here. Omit to use defaults. See {@link SurfaceConfigFiles}.",
    ).optional(),
    aws: AwsConfigSchema.describe(
      'AWS EC2 Mac settings for remote (off-Mac) builds. Only needed when building via `--remote aws`.',
    ).optional(),
    storageConfig: StorageConfigSchema.describe(
      "Bucket/endpoint settings for a cloud {@link StorageProvider} (`s3` / `supabase`). Required when `storage` names a cloud provider — it's where ad-hoc install links and OTA update manifests are hosted. Secrets stay out: access keys resolve from env / the OS secret store, never from here.",
    ).optional(),
    artifactDir: z
      .string()
      .describe(
        'Where the `local` storage provider writes build binaries and raw objects (install plists, OTA manifests). A relative path resolves against the project root (the `launch.config.ts` directory); a leading `~/` expands to the home directory; an absolute path is used as-is. Omit to use the global `~/.launch/artifacts` (the default — existing projects are unaffected). `launch init` and the no-args wizard scaffold this as the in-repo `./.launch/artifacts` and add it to `.gitignore`, so build binaries never get committed. Only the `local` provider observes it — cloud stores key off {@link StorageConfig}. The history index stays under `~/.launch`, so build history and retention span projects regardless of where the binaries land.',
      )
      .optional(),
    artifactRetentionDays: z
      .number()
      .describe(
        'How many days a local build binary is kept before the artifact store auto-prunes it to reclaim disk (the newest build per app+platform is always kept, so a promotable artifact never disappears). Runs after each successful local build. Defaults to 30 when omitted; set to `0` to disable the automatic sweep entirely (`launch builds prune` still works on demand). Only the `local` provider observes this — cloud stores manage retention through their own bucket lifecycle rules.',
      )
      .optional(),
    envExclude: z
      .array(z.string())
      .describe(
        "Env var names that must NEVER be injected into a build — a hard denylist applied across every layer (`.env`, `.env.<profile>`, keychain, profile `env:`, even an explicit `--env`). A matched name is dropped outright, so it can't reach the build subprocess and therefore can't be baked into the shipped app even by an `app.config.js` that forwards `process.env`.\n\nEach entry is either an exact, case-sensitive name or a `PREFIX*` wildcard: `OPENAI_*` drops every name starting with `OPENAI_` (e.g. `OPENAI_API_KEY`, `OPENAI_ORG_ID`), so a whole family of backend keys collapses to one line instead of being listed individually. Wildcards anchor at the START — there is no tail/`*_KEY` form, by design, since that would also snag a publishable `EXPO_PUBLIC_..._KEY`.\n\nThis is the home for *backend-only* values that sit in the app's `.env` for local tooling but must never ship (e.g. `OPENAI_API_KEY`, a server-side `SENTRY_AUTH_TOKEN`). It is distinct from `launch secret set`: a stored secret is still *injected* — the build needs it — it's just moved out of plaintext; `envExclude` means \"don't inject this at all\". A name matched here is exempt from the `.env.example` missing-key gate (even when no layer sets it). Omit (or `[]`) to exclude nothing.",
      )
      .optional(),
    mcp: McpConfigSchema.describe(
      'How `launch mcp` exposes Launch to AI agents — chiefly which capability tiers it may offer. Absent = least privilege (read-only tools). See {@link McpConfig}.',
    ).optional(),
  })
  .describe(
    'The fully-resolved configuration for one `launch` invocation. Produced by {@link loadConfig} from `launch.config.ts` plus auto-discovered apps. Names here (`storage`, `credentials`, `buildEngine`) are looked up in the provider registry at runtime.',
  );

/**
 * The fully-resolved configuration for one `launch` invocation — the *output* of {@link LaunchConfigSchema}
 * (provider names filled in). Names here (`storage`, `credentials`, `buildEngine`) are looked up in the
 * provider registry at runtime.
 */
export type LaunchConfig = z.infer<typeof LaunchConfigSchema>;

/**
 * Input to {@link defineConfig}: the shape a user authors in `launch.config.ts` — the *input* of
 * {@link LaunchConfigSchema}, so `profiles` is required and the provider names are optional (they default
 * via the schema). Every provider default lives once in `DEFAULT_*` above.
 */
export type LaunchConfigInput = z.input<typeof LaunchConfigSchema>;

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
