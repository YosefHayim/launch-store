/**
 * The text of the `launch.config.ts` (and `.env.example`) Launch scaffolds — the single source of the
 * config template, shared by `launch init` (writes it blank) and `launch adopt` (writes it pre-filled
 * with products imported from App Store Connect). Kept in `core` so both the init command and the adopt
 * pull reference one template rather than each carrying its own copy that could drift.
 */

import { relative } from 'node:path';
import type { AppDescriptor } from './types.js';

/** Derive a single `appRoots` subdir when every discovered app lives under one (e.g. an `apps/` monorepo). */
export function detectAppRoot(apps: AppDescriptor[], cwd: string): string | null {
  const segments = new Set<string>();
  for (const app of apps) {
    const rel = relative(cwd, app.dir);
    if (rel === '') return null; // an app sits at the repo root → scan the root
    const [first] = rel.split(/[/\\]/);
    if (first) segments.add(first);
  }
  const [only] = [...segments];
  return segments.size === 1 && only ? `./${only}` : null;
}

/**
 * The in-repo artifact directory `launch init` and the no-args wizard scaffold by default — a `.launch`
 * folder in the project, mirroring the global `~/.launch`. Auto-added to `.gitignore` so build binaries
 * never get committed. Users can point `artifactDir` elsewhere (or omit it for the global default).
 */
export const DEFAULT_IN_REPO_ARTIFACT_DIR = './.launch/artifacts';

/** The single `production` profile `launch init` / `launch adopt` scaffold when none is supplied. */
const DEFAULT_PROFILES_BLOCK = `  profiles: {
    production: {
      name: "production",
      envFile: ".env", // dotenv loaded for this profile (validated against .env.example)
      sizeBudgetMB: 200, // soft-gate: confirm before uploading a build over this download size
    },
  },`;

/**
 * The commented config Launch writes, tailored with a detected `appRoots` when there is one. `extraSections`
 * is injected verbatim just before the closing `});` — `launch adopt` passes a populated `products:` block
 * there; `launch init` passes nothing and gets the blank starter. `profilesSection`, when given, replaces
 * the default single-`production` profiles block — `launch migrate` passes the profiles it mapped from
 * `eas.json` there so the migrated config carries the user's real build profiles. `artifactDir`, when
 * given, emits an explicit `artifactDir:` line (e.g. the in-repo {@link DEFAULT_IN_REPO_ARTIFACT_DIR});
 * omit it to leave the config on the global `~/.launch/artifacts` default.
 */
export function configTemplate(
  appRoot: string | null,
  extraSections?: string,
  profilesSection?: string,
  artifactDir?: string,
): string {
  const appRootsLine = appRoot
    ? `  appRoots: ["${appRoot}"], // every app.json lives under here`
    : `  // appRoots: ["./apps"], // uncomment if your apps live in a subfolder`;
  const injected = extraSections ? `\n${extraSections}\n` : '';
  const profilesBlock = profilesSection ?? DEFAULT_PROFILES_BLOCK;
  const artifactDirLine = artifactDir
    ? `\n  artifactDir: ${JSON.stringify(artifactDir)}, // where local build binaries land (auto-added to .gitignore)`
    : '';
  return `import { defineConfig } from "launch-store";

/**
 * Launch configuration. App facts (bundle id, version) are read from each app.json — this file holds
 * only Launch-specific settings. Provider names are resolved from Launch's registry; the v1 built-ins
 * are shown below as the defaults.
 */
export default defineConfig({
${appRootsLine}

  credentials: "local", // macOS Keychain + ~/.launch (your own keys, cached locally)
  storage: "local", // ~/.launch/artifacts (swap for s3/r2/supabase later)${artifactDirLine}
  // artifactRetentionDays: 30, // auto-prune local build binaries older than this (0 = keep forever; newest per app is always kept)
  buildEngine: "fastlane", // "fastlane" (local) · "remote-mac" (AWS EC2 Mac) · "eas" (Expo cloud)

  // No Mac? Build remotely. Run \`launch\` (the wizard) or \`launch cloud doctor\`.
  // aws: { region: "us-east-1" }, // for \`launch build ios --remote aws\`

${profilesBlock}

  // ── App Store Connect config sections ──────────────────────────────────────────────────────
  // The single-config form of the *.config.json sidecars — each reconciled to App Store Connect by
  // its own command. Uncomment and fill in what your app uses (the standalone JSON files still work too).

  // Game Center achievements & leaderboards, keyed by iOS bundle id → \`launch game-center\`
  // gameCenter: {
  //   "com.acme.app": {
  //     achievements: [{ vendorIdentifier: "first_win", referenceName: "First Win", points: 10,
  //       name: "First Win", beforeEarnedDescription: "Win a game.", afterEarnedDescription: "You won!" }],
  //     leaderboards: [{ vendorIdentifier: "high_score", referenceName: "High Score", defaultFormatter: "INTEGER",
  //       submissionType: "BEST_SCORE", scoreSortType: "DESC", name: "High Score" }],
  //   },
  // },

  // App Clip card metadata, keyed by the parent app's bundle id → \`launch app-clips\`
  // appClips: {
  //   "com.acme.app": { clips: { "com.acme.app.Clip": { action: "OPEN",
  //     localizations: { "en-US": { subtitle: "Try it instantly" } } } } },
  // },

  // App Store release attributes (age rating, categories, price, review), keyed by bundle id → \`launch release-config\`
  // releaseAttributes: {
  //   "com.acme.app": {
  //     categories: { primary: "PRODUCTIVITY" },
  //     pricing: { customerPrice: 0 },
  //     reviewDetails: { contactFirstName: "Ada", contactLastName: "Lovelace", contactEmail: "ada@acme.com" },
  //   },
  // },

  // Team-level Apple Pay merchant ids & Wallet pass type ids → \`launch wallet\`
  // wallet: { merchantIds: [{ identifier: "merchant.com.acme.app", name: "Acme Pay" }] },

  // Team-level EU alternative-distribution domains (DMA) → \`launch eu-distribution\`
  // euDistribution: { domains: [{ domain: "downloads.acme.com", referenceName: "Acme Downloads" }] },
${injected}});
`;
}

/** Committed template of the env keys an app expects. Copied to `.env` and filled with real values. */
export const ENV_EXAMPLE_TEMPLATE = `# Committed template of the env keys your app expects. Copy to .env and fill real values.
# NOTE: there is no EXPO_PUBLIC_ prefix guard here — anything in .env can reach the app bundle.
# Keep backend secrets OUT of this file. Launch warns on secret-looking names as a safety net.
API_URL=
`;
