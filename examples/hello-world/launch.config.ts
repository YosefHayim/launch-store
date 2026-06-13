import { defineConfig } from "launchcli";

/**
 * Example Launch config for a single app. App facts (bundle id, version) come from app.json — this
 * file only holds Launch settings. `launch init` generates one like this tailored to your repo.
 */
export default defineConfig({
  credentials: "local", // your own keys, cached in the macOS Keychain
  storage: "local", // build artifacts in ~/.launch/artifacts
  buildEngine: "fastlane",

  profiles: {
    production: {
      name: "production",
      envFile: ".env",
      sizeBudgetMB: 200,
    },
  },
});
