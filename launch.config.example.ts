/**
 * Example Launch configuration.
 *
 * Copy this to `launch.config.ts` at the root of your app (or monorepo). It holds ONLY Launch-specific
 * settings — app facts like bundle id and version are auto-discovered from each app's `app.json`,
 * so nothing is duplicated. Provider names (`storage`, `credentials`, `buildEngine`) are resolved
 * from Launch's registry; the defaults shown are the v1 built-ins.
 */

import { defineConfig } from "launch-store";

export default defineConfig({
  // Where to scan for apps. Omit to scan the repo root.
  // appRoots: ["./apps"],

  credentials: "local", // macOS Keychain + ~/.launch
  storage: "local", // ~/.launch/artifacts (swap for s3/r2/supabase later)
  buildEngine: "fastlane",

  profiles: {
    production: {
      name: "production",
      envFile: ".env.production",
      ssl: true,
      sizeBudgetMB: 200, // soft-gate: confirm before uploading a build whose download exceeds this
    },
    preview: {
      name: "preview",
      envFile: ".env.preview",
      sizeBudgetMB: 200,
    },
  },
});
