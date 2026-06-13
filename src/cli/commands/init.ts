/**
 * `launch init` — scaffold Launch into an existing app or monorepo.
 *
 * Detects the app(s) in the current repo, then writes a commented `launch.config.ts` (and a starter
 * `.env.example` if missing) so a new user goes from `npm i -g launch-store` to a working config in one
 * step. It only writes config — it never touches credentials or the native project.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Command } from "commander";
import { cancel, confirm, intro, isCancel, note, outro } from "@clack/prompts";
import { loadConfig } from "../../core/config.js";
import type { AppDescriptor } from "../../core/types.js";

/** Derive a single `appRoots` subdir when every app lives under one (e.g. a `apps/` monorepo). */
function detectAppRoot(apps: AppDescriptor[], cwd: string): string | null {
  const segments = new Set<string>();
  for (const app of apps) {
    const rel = relative(cwd, app.dir);
    if (rel === "") return null; // an app sits at the repo root → scan the root
    const [first] = rel.split(/[/\\]/);
    if (first) segments.add(first);
  }
  const [only] = [...segments];
  return segments.size === 1 && only ? `./${only}` : null;
}

/** The commented config Launch writes, tailored with a detected `appRoots` when there is one. */
function configTemplate(appRoot: string | null): string {
  const appRootsLine = appRoot
    ? `  appRoots: ["${appRoot}"], // every app.json lives under here`
    : `  // appRoots: ["./apps"], // uncomment if your apps live in a subfolder`;
  return `import { defineConfig } from "launch-store";

/**
 * Launch configuration. App facts (bundle id, version) are read from each app.json — this file holds
 * only Launch-specific settings. Provider names are resolved from Launch's registry; the v1 built-ins
 * are shown below as the defaults.
 */
export default defineConfig({
${appRootsLine}

  credentials: "local", // macOS Keychain + ~/.launch (your own keys, cached locally)
  storage: "local", // ~/.launch/artifacts (swap for s3/r2/supabase later)
  buildEngine: "fastlane", // gym archives + exports the signed .ipa

  profiles: {
    production: {
      name: "production",
      envFile: ".env", // dotenv loaded for this profile (validated against .env.example)
      sizeBudgetMB: 200, // soft-gate: confirm before uploading a build over this download size
    },
  },
});
`;
}

const ENV_EXAMPLE_TEMPLATE = `# Committed template of the env keys your app expects. Copy to .env and fill real values.
# NOTE: there is no EXPO_PUBLIC_ prefix guard here — anything in .env can reach the app bundle.
# Keep backend secrets OUT of this file. Launch warns on secret-looking names as a safety net.
API_URL=
`;

/** Write a file unless it exists; returns whether it was written. */
function writeIfAbsent(path: string, contents: string): boolean {
  if (existsSync(path)) return false;
  writeFileSync(path, contents);
  return true;
}

/** Attach the `init` command to the program. */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("scaffold launch.config.ts (and .env.example) into the current repo")
    .action(async () => {
      intro("launch init");
      const cwd = process.cwd();
      const { apps } = await loadConfig(cwd);

      if (apps.length === 0) {
        note("No app.json found under this folder. Launch will still scaffold a config you can edit.", "Heads up");
      } else {
        const list = apps.map((app) => `• ${app.name}${app.bundleId ? `  (${app.bundleId})` : ""}`).join("\n");
        note(list, `Found ${apps.length} app${apps.length === 1 ? "" : "s"}`);
      }

      const configPath = join(cwd, "launch.config.ts");
      if (existsSync(configPath)) {
        const overwrite = await confirm({
          message: "launch.config.ts already exists. Overwrite it?",
          initialValue: false,
        });
        if (isCancel(overwrite) || !overwrite) {
          cancel("Left your launch.config.ts untouched.");
          process.exit(0);
        }
      }

      writeFileSync(configPath, configTemplate(detectAppRoot(apps, cwd)));
      const wroteEnv = writeIfAbsent(join(cwd, ".env.example"), ENV_EXAMPLE_TEMPLATE);

      const written = ["launch.config.ts", wroteEnv ? ".env.example" : null].filter(Boolean).join(", ");
      note(
        [
          `Wrote: ${written}`,
          "",
          "Next:",
          "  1. launch creds set-key   # import your App Store Connect API key",
          "  2. launch creds setup     # create/reuse your cert + provisioning profile",
          "  3. launch build ios --dry-run   # rehearse the whole flow, no changes",
        ].join("\n"),
        "Done",
      );
      outro("Launch is configured.");
    });
}
