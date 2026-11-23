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
  NotifyConfig,
  ReleaseAttributesConfig,
  ReleaseConfig,
  SurfaceConfigFiles,
  WalletConfig,
} from './store-surface.ts';
/** Provider defaults filled when the user omits them */
export const DEFAULT_CREDENTIALS_PROVIDER = 'local';
export const DEFAULT_STORAGE_PROVIDER = 'local';
export const DEFAULT_BUILD_ENGINE = 'xcode';
export const DEFAULT_SUBMITTER = 'app-store-connect';
/** The multi-store form of {@link LaunchConfig.submit} */
type SubmitByPlatform = Partial<Record<Platform, string[]>>;
/** Bucket settings for `storage: "s3"` or `storage: "supabase"`. */
export type StorageConfig = {
  /** Address of an S3-compatible store that is not AWS. */
  readonly endpoint?: string;
  /** Bucket that holds the files. */
  readonly bucket: string;
  /** Region for an S3-compatible bucket. */
  readonly region?: string;
  /** Public web address of the bucket root, with no secret in it. */
  readonly publicBaseUrl: string;
  /** Supabase project address, such as `https://<project>.supabase.co`. */
  readonly supabaseUrl?: string;
};
/** The object you pass to `defineConfig` in launch.config.ts. */
export type LaunchConfigInput = {
  /** Named build settings, keyed by the name you pass to `--profile`. */
  readonly profiles: Record<string, BuildProfile>;
  /** Where signing keys and the App Store Connect API key are stored. */
  readonly credentials?: string;
  /** Where finished builds and over-the-air update files are kept. */
  readonly storage?: string;
  /** Who compiles the native app. */
  readonly buildEngine?: string;
  /** Who receives a finished binary. */
  readonly submit?: string | SubmitByPlatform;
  /** Folders Launch searches for app.json or app.config.ts, relative to this file. */
  readonly appRoots?: readonly string[];
  /** In-app purchases and subscriptions, keyed by the iOS bundle id (`com.acme.app`). */
  readonly products?: Record<string, AppProducts>;
  /** Where Launch posts after a build, a submit, a review verdict, or a rollout change. */
  readonly notify?: NotifyConfig;
  /** How an approved iOS version reaches the public App Store */
  readonly release?: ReleaseConfig;
  /** Game Center achievements and leaderboards, keyed by the iOS bundle id. */
  readonly gameCenter?: Record<string, GameCenterConfig>;
  /** App Clip cards, keyed by the parent app's bundle id. */
  readonly appClips?: Record<string, AppClipsConfig>;
  /** Age rating, categories, price, and the App Review contact, keyed by the iOS bundle id. */
  readonly releaseAttributes?: Record<string, ReleaseAttributesConfig>;
  /** Apple Pay merchant ids and Wallet pass type ids for the whole team, not for one app. */
  readonly wallet?: WalletConfig;
  /** Domains allowed to distribute the app in the EU under the DMA, for the whole team. */
  readonly euDistribution?: EuDistributionConfig;
  /** Paths to the JSON files for store surfaces that are not written inline here. */
  readonly configFiles?: SurfaceConfigFiles;
  /** AWS settings for an EC2 Mac */
  readonly aws?: AwsConfig;
  /** Bucket address for `storage: "s3"` or `storage: "supabase"`. */
  readonly storageConfig?: StorageConfig;
  /** Folder where `storage: "local"` writes build binaries. */
  readonly artifactDir?: string;
  /** How many days a local build binary is kept. */
  readonly artifactRetentionDays?: number;
  /** Environment variable names that must never be copied into a build or a log. */
  readonly envExclude?: readonly string[];
  /** When to run `expo prebuild` and regenerate the ios/ or android/ folder. */
  readonly prebuild?: PrebuildMode;
};

/** When a build runs `expo prebuild --clean`: only for a missing native dir, or on every build. */
const prebuildModes = ['missing', 'always'] as const;
export type PrebuildMode = (typeof prebuildModes)[number];
/** The settings for one `launch-store` run */
export type LaunchConfig = LaunchConfigInput & {
  readonly credentials: string;
  readonly storage: string;
  readonly buildEngine: string;
  readonly submit: string | SubmitByPlatform;
};

/** Everything a single build needs, assembled before any work starts. */
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
