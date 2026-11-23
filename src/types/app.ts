// Holds the app, platform, profile, and Google Play track shapes the rest of Launch shares.

export const PLATFORMS = ['ios', 'android', 'tvos', 'macos', 'visionos'] as const;

/** Target build platform - one of {@link PLATFORMS}. */
export type Platform = (typeof PLATFORMS)[number];

/** How a build is distributed. */
export type Distribution = 'store' | 'internal';
/** A Google Play release track. */
export const playTracks = ['internal', 'closed', 'open', 'production'] as const;

/** A Google Play release track - one of {@link playTracks}. */
export type PlayTrack = (typeof playTracks)[number];

/** Which web console page `launch-store open` deep-links to. */
export type OpenTarget =
  | 'asc'
  | 'play'
  | 'testflight'
  | 'listing'
  | 'reviews'
  | 'agreements'
  | 'app-record';

/** One localized Play "What's new" line carried on {@link AndroidReleaseOptions} so the Google */
export type AndroidReleaseNote = {
  language: string;
  text: string;
};

/** Resolved Android release settings for one invocation */
export type AndroidReleaseOptions = {
  track: PlayTrack;
  rollout: number;
  releaseNotes?: readonly AndroidReleaseNote[];
};

/** Which kind of TestFlight beta feedback a {@link BetaFeedback} carries */
export type BetaFeedbackKind = 'crash' | 'screenshot';

/** One TestFlight screenshot attachment on a {@link BetaFeedback} */
type BetaFeedbackScreenshot = {
  url: string;
  width?: number;
  height?: number;
};

/** One piece of TestFlight beta feedback */
export type BetaFeedback = {
  id: string;
  kind: BetaFeedbackKind;
  createdDate?: string;
  comment?: string;
  email?: string;
  deviceModel?: string;
  osVersion?: string;
  buildVersion?: string;
  screenshots?: BetaFeedbackScreenshot[];
};

/** One app discovered in the surrounding monorepo. */
export type AppDescriptor = {
  name: string;
  dir: string;
  configPath: string;
  bundleId?: string;
  packageName?: string;
  version?: string;
  iosEntitlements?: Record<string, unknown>;
  iosExtensions?: string[];
  androidVersionCode?: number;
  usesNonExemptEncryption?: boolean;
};

/** One named set of build settings in `profiles`, such as `production` or `preview`. */
export type BuildProfile = {
  /** The name you pass to `--profile`. */
  name: string;
  /** Dotenv file loaded for this profile, relative to the app folder. */
  envFile?: string;
  /** Extra environment variables for this profile. */
  env?: Record<string, string>;
  /** Accepted on the profile. */
  ssl?: boolean;
  /** Largest download size, in megabytes, you want to ship without being asked. */
  sizeBudgetMB?: number;
  /** Google Play track used by `launch-store build android` when you do not pass `--track`. */
  track?: PlayTrack;
  /** Share of users on the Play track who receive this release, from just above 0 up to 1. */
  rollout?: number;
};
