/**
 * The shapes the local `launch dashboard` renders — one glanceable snapshot of the project's *local*
 * state (config + `~/.launch`), assembled by {@link import("../dashboard/state.js").gatherDashboardState}
 * and drawn by {@link import("../dashboard/render.js").renderDashboardHtml}.
 *
 * These are deliberately a flat, presentation-ready projection of the richer domain shapes in
 * `core/types.ts` (apps, accounts, artifacts, secrets, cloud host) rather than those shapes verbatim:
 * the page only needs a handful of display fields, and projecting here keeps two sensitive invariants
 * in one place — secret *values* never appear (only their non-secret coordinates), and optional domain
 * fields collapse to `T | null` so the embedded JSON serializes cleanly and the renderer never has to
 * distinguish "absent" from "null".
 */

import type { Platform } from './app.js';

/** One discovered app, reduced to the identity fields the dashboard shows. */
export interface DashboardApp {
  /** App handle (`launch build --app <name>`). */
  name: string;
  /** Marketing version from the app's Expo config, or null when unset. */
  version: string | null;
  /** iOS bundle identifier, or null for an Android-only app. */
  bundleId: string | null;
  /** Android application id, or null for an iOS-only app. */
  packageName: string | null;
}

/** The provider wiring + discovered apps/profiles from `launch.config.ts`. */
export interface DashboardProject {
  /** Resolved backend names — what `launch.config.ts` selected for each provider slot. */
  providers: { credentials: string; storage: string; buildEngine: string; submit: string };
  /** Declared build-profile names (e.g. `production`, `preview`). */
  profiles: string[];
  /** Every discovered app. */
  apps: DashboardApp[];
}

/** One onboarded Apple account, reduced to non-secret display fields. */
export interface DashboardAccount {
  /** Human label chosen at add-time. */
  label: string;
  /** App Store Connect Key ID (non-secret; the registry's primary key). */
  keyId: string;
  /** Apple Team ID, or null until resolved from Apple. */
  teamId: string | null;
  /** Number of apps this key can see (0 until resolved). */
  appCount: number;
  /** Whether this is the active account a build uses by default. */
  active: boolean;
}

/** One recent local build artifact, reduced to the fields the dashboard lists. */
export interface DashboardArtifact {
  app: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  /** ISO-8601 build time. */
  createdAt: string;
  /** Raw artifact size in MB (rounded to one decimal), or null when no size was recorded. */
  sizeMB: number | null;
  /** Whether artifact retention has removed the binary (the index row survives as history). */
  pruned: boolean;
}

/**
 * One build secret's non-secret coordinates. The value lives in the OS keychain and is **never** read
 * or rendered — only the env-var name and its scope appear, exactly what `launch secret list` shows.
 */
export interface DashboardSecret {
  app: string;
  /** Profile the secret is scoped to, or null for an app-wide secret. */
  profile: string | null;
  /** Env-var name injected at build time (e.g. `SENTRY_AUTH_TOKEN`). */
  name: string;
}

/** The live remote build host, when one is currently allocated. */
export interface DashboardCloudHost {
  /** Registry name of the compute host (e.g. `aws-ec2-mac`). */
  provider: string;
  /** AWS region, or null for a bring-your-own SSH host. */
  region: string | null;
  /** EC2 instance type, or null for a BYO host. */
  instanceType: string | null;
  /** EC2 instance id, or null for a BYO host. */
  instanceId: string | null;
  /** ISO-8601 instant the host was allocated (the billing clock). */
  allocatedAt: string;
}

/**
 * The complete snapshot the dashboard serves — everything readable from local state with no network or
 * App Store Connect call, so the page renders instantly and offline. Live store-side panels (review
 * status, Play tracks, drift) are intentionally out of this first cut: they need ASC auth and belong on
 * the confirmed `plan`/`reports` read path, not an always-on local page.
 */
export interface DashboardState {
  /** ISO-8601 instant this snapshot was gathered, for the "as of" line. */
  generatedAt: string;
  /** Absolute path to `~/.launch`, the local state home this view reads. */
  launchHome: string;
  /** Provider wiring, profiles, and discovered apps. */
  project: DashboardProject;
  /** Onboarded Apple accounts. */
  accounts: DashboardAccount[];
  /** The most-recent local build artifacts, newest first. */
  artifacts: DashboardArtifact[];
  /** Build-secret coordinates (names only — never values). */
  secrets: DashboardSecret[];
  /** The live remote build host, or null when none is allocated. */
  cloudHost: DashboardCloudHost | null;
}
