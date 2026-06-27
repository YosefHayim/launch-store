import { defineConfig } from 'launch-store';

/**
 * Launch configuration. App facts (bundle id, version) are read from each app.json — this file holds
 * only Launch-specific settings. Provider names are resolved from Launch's registry; the v1 built-ins
 * are shown below as the defaults.
 */
export default defineConfig({
  appRoots: ['./examples'], // every app.json lives under here

  credentials: 'local', // macOS Keychain + ~/.launch (your own keys, cached locally)
  storage: 'local', // ~/.launch/artifacts (swap for s3/r2/supabase later)
  buildEngine: 'fastlane', // "fastlane" (local) · "remote-mac" (AWS EC2 Mac) · "eas" (Expo cloud)

  // No Mac? Build remotely. Run `launch` (the wizard) or `launch cloud doctor`.
  // aws: { region: "us-east-1" }, // for `launch build ios --remote aws`

  profiles: {
    production: {
      name: 'production',
      envFile: '.env', // dotenv loaded for this profile (validated against .env.example)
      sizeBudgetMB: 200, // soft-gate: confirm before uploading a build over this download size
    },
  },

  // ── App Store Connect config sections ──────────────────────────────────────────────────────
  // The single-config form of the *.config.json sidecars — each reconciled to App Store Connect by
  // its own command. Uncomment and fill in what your app uses (the standalone JSON files still work too).

  // Game Center achievements & leaderboards, keyed by iOS bundle id → `launch game-center`
  // gameCenter: {
  //   "com.acme.app": {
  //     achievements: [{ vendorIdentifier: "first_win", referenceName: "First Win", points: 10,
  //       name: "First Win", beforeEarnedDescription: "Win a game.", afterEarnedDescription: "You won!" }],
  //     leaderboards: [{ vendorIdentifier: "high_score", referenceName: "High Score", defaultFormatter: "INTEGER",
  //       submissionType: "BEST_SCORE", scoreSortType: "DESC", name: "High Score" }],
  //   },
  // },

  // App Clip card metadata, keyed by the parent app's bundle id → `launch app-clips`
  // appClips: {
  //   "com.acme.app": { clips: { "com.acme.app.Clip": { action: "OPEN",
  //     localizations: { "en-US": { subtitle: "Try it instantly" } } } } },
  // },

  // App Store release attributes (age rating, categories, price, review), keyed by bundle id → `launch release-config`
  // releaseAttributes: {
  //   "com.acme.app": {
  //     categories: { primary: "PRODUCTIVITY" },
  //     pricing: { customerPrice: 0 },
  //     reviewDetails: { contactFirstName: "Ada", contactLastName: "Lovelace", contactEmail: "ada@acme.com" },
  //   },
  // },

  // Team-level Apple Pay merchant ids & Wallet pass type ids → `launch wallet`
  // wallet: { merchantIds: [{ identifier: "merchant.com.acme.app", name: "Acme Pay" }] },

  // Team-level EU alternative-distribution domains (DMA) → `launch eu-distribution`
  // euDistribution: { domains: [{ domain: "downloads.acme.com", referenceName: "Acme Downloads" }] },
});
