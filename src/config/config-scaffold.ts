// Writes the starter Launch config and environment example for a newly detected app folder.

import { relative } from 'node:path';
import type { AppDescriptor } from '../types/app.ts';

/** Derive a single `appRoots` subdir when every discovered app lives under one (e.g. an `apps/` monorepo). */
export function detectAppRoot(
  apps: readonly AppDescriptor[],
  workingDirectory: string,
): string | null {
  const topLevelSegments = new Set<string>();

  for (const app of apps) {
    const relativeAppPath = relative(workingDirectory, app.dir);

    const isAtRoot = relativeAppPath == '';

    if (isAtRoot) {
      return null;
    }

    const firstSegment = relativeAppPath.split(/[/\\]/)[0];

    if (firstSegment == null) {
      continue;
    }

    const isEmptySegment = firstSegment.length == 0;

    if (isEmptySegment) {
      continue;
    }

    topLevelSegments.add(firstSegment);
  }

  const hasOneSegment = topLevelSegments.size == 1;

  if (hasOneSegment == false) {
    return null;
  }

  const onlySegment = [...topLevelSegments][0];

  if (onlySegment == null) {
    return null;
  }

  return `./${onlySegment}`;
}
/** The in-repo artifact directory `launch-store init` scaffolds by default */
export const DEFAULT_IN_REPO_ARTIFACT_DIR = './.launch/artifacts';

/** The commented config Launch writes, tailored with a detected `appRoots` when there is one. */
export function configTemplate(
  appRoot: string | null,
  extraSections?: string,
  profilesSection?: string,
  artifactDir?: string,
): string {
  let appRootsLine = `  // appRoots: ["./apps"], // uncomment if your apps live in a subfolder`;

  if (appRoot != null) {
    appRootsLine = `  appRoots: ["${appRoot}"], // every app.json lives under here`;
  }

  let injected = '';

  if (extraSections != null && extraSections.length > 0) {
    injected = `\n${extraSections}\n`;
  }

  let profilesBlock = profilesSection;

  if (profilesBlock == null)
    profilesBlock = `  profiles: {
    production: {
      name: "production",
      envFile: ".env", // dotenv loaded for this profile (validated against .env.example)
      sizeBudgetMB: 200, // soft-gate: confirm before uploading a build over this download size
    },
  },`;

  let artifactDirLine = '';

  if (artifactDir != null && artifactDir.length > 0) {
    artifactDirLine = `\n  artifactDir: ${JSON.stringify(artifactDir)}, // where local build binaries land (auto-added to .gitignore)`;
  }

  return `import { defineConfig } from "launch-store";

/** Launch configuration. */
export default defineConfig({
${appRootsLine}

  credentials: "local", // macOS Keychain + ~/.launch (your own keys, cached locally)
  storage: "local", // ~/.launch/artifacts${artifactDirLine}
  // artifactRetentionDays: 30, // auto-prune local build binaries older than this (0 = keep forever; newest per app is always kept)
  buildEngine: "xcode", // "xcode" (local) - "remote-mac" (needs --remote user@host) - "eas" (Expo cloud)

  // No Mac? Build on one you can SSH to: launch-store build ios --remote user@host

${profilesBlock}

  // App Store Connect sections live in this file, keyed by iOS bundle id.
  // Uncomment and fill in what your app uses.

  // Game Center achievements & leaderboards, keyed by iOS bundle id -> \`launch-store game-center\`
  // gameCenter: {
  //   "com.acme.app": {
  //     achievements: [{ vendorIdentifier: "first_win", referenceName: "First Win", points: 10,
  //       name: "First Win", beforeEarnedDescription: "Win a game.", afterEarnedDescription: "You won!" }],
  //     leaderboards: [{ vendorIdentifier: "high_score", referenceName: "High Score", defaultFormatter: "INTEGER",
  //       submissionType: "BEST_SCORE", scoreSortType: "DESC", name: "High Score" }],
  //   },
  // },

  // App Clip card metadata, keyed by the parent app's bundle id -> \`launch-store app-clips\`
  // appClips: {
  //   "com.acme.app": { clips: { "com.acme.app.Clip": { action: "OPEN",
  //     localizations: { "en-US": { subtitle: "Try it instantly" } } } } },
  // },

  // App Store release attributes (age rating, categories, price, review), keyed by bundle id -> \`launch-store release-config\`
  // releaseAttributes: {
  //   "com.acme.app": {
  //     categories: { primary: "PRODUCTIVITY" },
  //     pricing: { customerPrice: 0 },
  //     reviewDetails: { contactFirstName: "Ada", contactLastName: "Lovelace", contactEmail: "ada@acme.com" },
  //   },
  // },

  // Team-level Apple Pay merchant ids & Wallet pass type ids -> \`launch-store wallet\`
  // wallet: { merchantIds: [{ identifier: "merchant.com.acme.app", name: "Acme Pay" }] },

  // Team-level EU alternative-distribution domains (DMA) -> \`launch-store eu-distribution\`
  // euDistribution: { domains: [{ domain: "downloads.acme.com", referenceName: "Acme Downloads" }] },
${injected}});
`;
}
/** Committed template of the env keys an app expects. Copied to `.env` and filled with real values. */
export const ENV_EXAMPLE_TEMPLATE = `# Committed template of the env keys your app expects. Copy to .env and fill real values.
# NOTE: there is no EXPO_PUBLIC_ prefix guard here - anything in .env can reach the app bundle.
# Keep backend secrets OUT of this file. Launch warns on secret-looking names as a safety net.
API_URL=
`;
