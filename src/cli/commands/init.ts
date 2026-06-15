/**
 * `launch init` — scaffold Launch into an existing app or monorepo.
 *
 * Detects the app(s) in the current repo, then writes a commented `launch.config.ts` (and a starter
 * `.env.example` if missing) so a new user goes from `npm i -g launch-store` to a working config in one
 * step. It only writes config — it never touches credentials or the native project.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { cancel, confirm, intro, isCancel, note, outro } from "@clack/prompts";
import { loadConfig } from "../../core/config.js";
import { ENV_EXAMPLE_TEMPLATE, configTemplate, detectAppRoot } from "../../core/configScaffold.js";

/** Write a file unless it exists; returns whether it was written. */
function writeIfAbsent(path: string, contents: string): boolean {
  if (existsSync(path)) return false;
  writeFileSync(path, contents);
  return true;
}

/**
 * Scaffold `launch.config.ts` (and `.env.example` when absent) into `cwd`. The body of `launch init`,
 * extracted so the no-args wizard's guided setup can run the same scaffold inline. Confirms before
 * overwriting an existing config. Intro/outro framing is left to the caller so it nests cleanly inside
 * the wizard's own framing.
 */
export async function runInit(cwd: string): Promise<void> {
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
}

/** Attach the `init` command to the program. */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("scaffold launch.config.ts (and .env.example) into the current repo")
    .action(async () => {
      intro("launch init");
      await runInit(process.cwd());
      outro("Launch is configured.");
    });
}
