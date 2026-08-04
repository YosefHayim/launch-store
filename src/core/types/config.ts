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
 * Provider defaults filled when the user omits them - the single source for both the Effect Schema's
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
 * Credentials are NEVER stored here - keys resolve from env or the OS secret store.
 */
export type StorageConfig = {
  endpoint?: string;
  bucket: string;
  region?: string;
  publicBaseUrl: string;
  supabaseUrl?: string;
};
/**
 * Fully-resolved configuration for one `launch` invocation (provider defaults filled).
 * Names here (`storage`, `credentials`, `buildEngine`) are looked up in the provider registry at runtime.
 */
export type LaunchConfig = {
  profiles: Record<string, BuildProfile>;
  credentials: string;
  storage: string;
  buildEngine: string;
  submit: string | SubmitByPlatform;
  appRoots?: string[];
  products?: Record<string, AppProducts>;
  notify?: NotifyConfig;
  release?: ReleaseConfig;
  gameCenter?: Record<string, GameCenterConfig>;
  appClips?: Record<string, AppClipsConfig>;
  releaseAttributes?: Record<string, ReleaseAttributesConfig>;
  wallet?: WalletConfig;
  euDistribution?: EuDistributionConfig;
  configFiles?: SurfaceConfigFiles;
  aws?: AwsConfig;
  storageConfig?: StorageConfig;
  artifactDir?: string;
  artifactRetentionDays?: number;
  envExclude?: string[];
  mcp?: McpConfig;
};
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
export type ResolvedBuildContext = {
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
};
