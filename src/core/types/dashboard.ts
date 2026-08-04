import type { Platform } from './app.js';
/** One discovered app, reduced to the identity fields the dashboard shows. */
export type DashboardApp = {
  name: string;
  version: string | null;
  bundleId: string | null;
  packageName: string | null;
};
/** The provider wiring + discovered apps/profiles from `launch.config.ts`. */
export type DashboardProject = {
  providers: {
    credentials: string;
    storage: string;
    buildEngine: string;
    submit: string;
  };
  profiles: string[];
  apps: DashboardApp[];
};
/** One onboarded Apple account, reduced to non-secret display fields. */
export type DashboardAccount = {
  label: string;
  keyId: string;
  teamId: string | null;
  appCount: number;
  active: boolean;
};
/** One recent local build artifact, reduced to the fields the dashboard lists. */
export type DashboardArtifact = {
  app: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  createdAt: string;
  sizeMB: number | null;
  pruned: boolean;
};
/**
 * One build secret's non-secret coordinates. The value lives in the OS keychain and is **never** read
 * or rendered - only the env-var name and its scope appear, exactly what `launch secret list` shows.
 */
export type DashboardSecret = {
  app: string;
  profile: string | null;
  name: string;
};
/** The live remote build host, when one is currently allocated. */
export type DashboardCloudHost = {
  provider: string;
  region: string | null;
  instanceType: string | null;
  instanceId: string | null;
  allocatedAt: string;
};
/**
 * The complete snapshot the dashboard serves - everything readable from local state with no network or
 * App Store Connect call, so the page renders instantly and offline. Live store-side panels (review
 * status, Play tracks, drift) are intentionally out of this first cut: they need ASC auth and belong on
 * the confirmed `plan`/`reports` read path, not an always-on local page.
 */
export type DashboardState = {
  generatedAt: string;
  launchHome: string;
  project: DashboardProject;
  accounts: DashboardAccount[];
  artifacts: DashboardArtifact[];
  secrets: DashboardSecret[];
  cloudHost: DashboardCloudHost | null;
};
