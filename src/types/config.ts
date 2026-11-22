import type {
  AndroidReleaseOptions,
  AppDescriptor,
  BuildProfile,
  Distribution,
  Platform,
} from './app.ts';
import type { AppProducts } from './catalog.ts';
import type { AwsConfig } from './remote.ts';
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
} from './store-surface.ts';
/**
 * Provider defaults filled when the user omits them - the single source for both the Effect Schema's
 * defaults and `defineConfig` (which fills them without parsing, so it can preserve unknown top-level
 * keys for #197). Keeping them here means the two paths can't disagree on a default.
 */
export const DEFAULT_CREDENTIALS_PROVIDER = 'local';
export const DEFAULT_STORAGE_PROVIDER = 'local';
export const DEFAULT_BUILD_ENGINE = 'xcode';
export const DEFAULT_SUBMITTER = 'app-store-connect';
/**
 * The multi-store form of {@link LaunchConfig.submit}: a per-platform list of registered `Submitter`
 * names a build for that {@link Platform} is uploaded to, in order.
 */
type SubmitByPlatform = Partial<Record<Platform, string[]>>;
/**
 * Bucket settings for `storage: "s3"` or `storage: "supabase"`.
 * Keys and passwords do not go here. They stay in the environment or the OS keychain.
 */
export type StorageConfig = {
  /**
   * Address of an S3-compatible store that is not AWS.
   * Cloudflare R2 looks like `https://<account>.r2.cloudflarestorage.com`.
   * Leave this out for real AWS S3. Supabase does not use it.
   */
  readonly endpoint?: string;
  /**
   * Bucket that holds the files.
   * For S3 and R2 this is the bucket name. For Supabase it is the storage bucket id.
   */
  readonly bucket: string;
  /**
   * Region for an S3-compatible bucket.
   * Leave this out for Cloudflare R2, which uses `auto`. Supabase does not use it.
   */
  readonly region?: string;
  /**
   * Public web address of the bucket root, with no secret in it.
   * Install links and over-the-air update addresses are built from this.
   * An R2 custom domain looks like `https://updates.example.com`.
   * A trailing slash is optional.
   */
  readonly publicBaseUrl: string;
  /**
   * Supabase project address, such as `https://<project>.supabase.co`.
   * Required when `storage` is `supabase`. S3 does not use it.
   */
  readonly supabaseUrl?: string;
};
/**
 * The object you pass to `defineConfig` in launch.config.ts.
 * The four provider names are optional here. `defineConfig` fills them in.
 */
export type LaunchConfigInput = {
  /**
   * Named build settings, keyed by the name you pass to `--profile`.
   * `production` is the usual key. App facts such as the bundle id stay in each app's app.json.
   */
  readonly profiles: Record<string, BuildProfile>;
  /**
   * Where signing keys and the App Store Connect API key are stored.
   * `local` keeps them in the macOS Keychain and under ~/.launch. That is the only built-in store,
   * and it is what `defineConfig` fills in when the file leaves this out.
   * Never put a key or a password in this file.
   */
  readonly credentials?: string;
  /**
   * Where finished builds and over-the-air update files are kept.
   * `local` (the default) writes them under ~/.launch/artifacts, or under `artifactDir` when you set one.
   * `s3` is any S3-compatible bucket, including Cloudflare R2, and needs `storageConfig`.
   * `supabase` is a Supabase Storage bucket and also needs `storageConfig`.
   * `launch update` needs `s3` or `supabase`, because a phone has to download the update over the web.
   */
  readonly storage?: string;
  /**
   * Who compiles the native app.
   * `xcode` builds Apple apps on this Mac. That is the default.
   * `remote-mac` builds Apple apps on another Mac (`launch cloud`, or `launch build ios --remote`).
   * `eas` hands the compile to Expo. That is the migrate path, not the usual one.
   * An Android build uses Gradle even when this says `xcode`, `remote-mac`, or `eas`.
   */
  readonly buildEngine?: string;
  /**
   * Who receives a finished binary.
   * One name covers every platform. `app-store-connect` is the Apple default, and an Android build
   * swaps that default for `google-play`. `eas` hands the upload to Expo.
   * A per-platform object gives each platform its own list, in upload order,
   * for example `{ android: ["google-play"] }`. A platform you leave out uses its usual store.
   * `launch build` on iOS still leaves the signed archive on disk. `launch release` is the public ship.
   */
  readonly submit?: string | SubmitByPlatform;
  /**
   * Folders Launch searches for app.json or app.config.ts, relative to this file.
   * `launch init` fills this in when every app lives under one folder, such as `./apps`.
   * Leave it out to search from the folder that holds launch.config.ts.
   */
  readonly appRoots?: readonly string[];
  /**
   * In-app purchases and subscriptions, keyed by the iOS bundle id (`com.acme.app`).
   * One entry is one app. `launch sync` writes the App Store side.
   * A `play` block inside a product is what `launch play-products` and `launch play-subscriptions` write.
   * Leave this out for an app that sells nothing.
   */
  readonly products?: Record<string, AppProducts>;
  /**
   * Where Launch posts after a build, a submit, a review verdict, or a rollout change.
   * Leave it out and nothing is posted.
   */
  readonly notify?: NotifyConfig;
  /**
   * How an approved iOS version reaches the public App Store: immediately, by hand, or on a date.
   * This does not set the age rating, the category, or the review contact. Those live in `releaseAttributes`.
   * Leave it out and the app goes live as soon as Apple approves it, all at once.
   */
  readonly release?: ReleaseConfig;
  /**
   * Game Center achievements and leaderboards, keyed by the iOS bundle id.
   * `launch game-center` creates anything listed here that the store does not have yet.
   */
  readonly gameCenter?: Record<string, GameCenterConfig>;
  /**
   * App Clip cards, keyed by the parent app's bundle id.
   * The clip itself is created by an Xcode build. `launch app-clips` only fills in the card.
   */
  readonly appClips?: Record<string, AppClipsConfig>;
  /**
   * Age rating, categories, price, and the App Review contact, keyed by the iOS bundle id.
   * `launch release-config` writes them. This is separate from `release`, which only decides when a version goes live.
   */
  readonly releaseAttributes?: Record<string, ReleaseAttributesConfig>;
  /**
   * Apple Pay merchant ids and Wallet pass type ids for the whole team, not for one app.
   * `launch wallet` registers them.
   */
  readonly wallet?: WalletConfig;
  /**
   * Domains allowed to distribute the app in the EU under the DMA, for the whole team.
   * `launch eu-distribution` registers them.
   */
  readonly euDistribution?: EuDistributionConfig;
  /**
   * Paths to the JSON files for store surfaces that are not written inline here.
   * Leave a path out to use the default file name next to launch.config.ts.
   */
  readonly configFiles?: SurfaceConfigFiles;
  /**
   * AWS settings for an EC2 Mac, used by `launch cloud` and `launch build ios --remote aws`.
   * No AWS secret belongs here. The AWS SDK reads credentials from its usual chain.
   */
  readonly aws?: AwsConfig;
  /**
   * Bucket address for `storage: "s3"` or `storage: "supabase"`.
   * Required for those two. Ignored when storage is `local`.
   */
  readonly storageConfig?: StorageConfig;
  /**
   * Folder where `storage: "local"` writes build binaries.
   * A relative path starts at the folder that holds launch.config.ts. `~/` is your home folder.
   * Leave it out to use ~/.launch/artifacts. Cloud storage ignores this and uses `storageConfig`.
   */
  readonly artifactDir?: string;
  /**
   * How many days a local build binary is kept.
   * The newest build of each app and platform is always kept. The default is 30.
   * `0` keeps everything. `launch builds prune` can still delete on demand.
   * Cloud buckets ignore this and use their own lifecycle rules.
   */
  readonly artifactRetentionDays?: number;
  /**
   * Environment variable names that must never be copied into a build or a log.
   * Each entry is an exact name, or a prefix ending in `*`, such as `OPENAI_*`.
   * The star only works at the end. A matched name is dropped from dotenv files, the keychain,
   * the profile `env` block, and even an explicit `--env` flag, so it cannot be baked into the app.
   * This is different from `launch secret set`: a stored secret is still injected, because the build needs it.
   * A name listed here is also skipped when Launch checks that `.env.example` is filled in.
   */
  readonly envExclude?: readonly string[];
  /**
   * When to run `expo prebuild` and regenerate the ios/ or android/ folder.
   * `missing` (the default) generates that folder only when it is not there yet.
   * `always` regenerates it on every build, so a plugin change in app.json cannot ship from a stale native project.
   * tvOS, macOS, and visionOS keep the native project you committed.
   */
  readonly prebuild?: PrebuildMode;
  /**
   * What `launch mcp` is allowed to do for an AI agent.
   * Leave it out and the agent can only read.
   */
  readonly mcp?: McpConfig;
};

/** When a build runs `expo prebuild --clean`: only for a missing native dir, or on every build. */
const prebuildModes = ['missing', 'always'] as const;
export type PrebuildMode = (typeof prebuildModes)[number];
/**
 * The settings for one `launch` run, after `defineConfig` has filled the provider defaults.
 */
export type LaunchConfig = LaunchConfigInput & {
  readonly credentials: string;
  readonly storage: string;
  readonly buildEngine: string;
  readonly submit: string | SubmitByPlatform;
};

/**
 * Everything a single build needs, assembled before any work starts.
 *
 * This is the value threaded through the whole pipeline and into every provider, so a provider
 * never has to re-derive the app, profile, or environment.
 */
export type ResolvedBuildContext = Readonly<{
  platform: Platform;
  app: AppDescriptor;
  profile: BuildProfile;
  env: Record<string, string>;
  explain: boolean;
  dryRun: boolean;
  forceClean: boolean;
  ccache?: boolean;
  android?: AndroidReleaseOptions;
  distribution?: Distribution;
  account?: string;
}>;
