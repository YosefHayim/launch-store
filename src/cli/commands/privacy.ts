/**
 * `launch privacy scan` — a read-only sweep that reconciles an app's *actual* permission/data surface
 * against its *declared* privacy manifest, before App Review or Play does. It catches the opaque,
 * common rejection causes — an empty purpose string, a permission you access but never declared
 * collecting, a tracking flag that disagrees with itself — that drift as code and declarations diverge.
 *
 * It can't diff against the *published* App Privacy label or Play Data Safety form: both are UI-only
 * (see `core/privacyNutritionLabel.ts`), so this reconciles what's statically readable — native files
 * (`Info.plist`, `PrivacyInfo.xcprivacy`, `AndroidManifest.xml`) when a project is prebuilt, else the
 * resolved Expo config. All parsing/judgement is the pure `core/privacy/*`; this file does the I/O and
 * sets `process.exitCode` (0 clear · 2 blockers · 1 nothing-to-scan) so it gates a release script.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig, readResolvedConfig } from "../../core/config.js";
import { selectApps } from "../../core/syncJobs.js";
import { surfaceFromExpoConfig, surfaceFromNative } from "../../core/privacy/parse.js";
import { buildPrivacyReport, reconcilePrivacy, renderPrivacyReport } from "../../core/privacy/reconcile.js";
import type { PrivacyFinding, PrivacySurface } from "../../core/privacy/types.js";
import type { AppDescriptor } from "../../core/types.js";

/** CLI options for `launch privacy scan`. */
interface PrivacyScanOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link import("../../core/privacy/types.js").PrivacyReport}) for CI/agents. */
  json?: boolean;
}

/** Generated/heavy directories the file walk skips — they never hold the source-of-truth manifests. */
const SKIP_DIRS = new Set(["node_modules", "Pods", "build", "DerivedData", "dist"]);

/** Collect files whose basename satisfies `match`, walking `root` to a bounded depth and skipping build dirs. */
function findFiles(root: string, match: (name: string) => boolean, maxDepth = 6): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const path = join(dir, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) walk(path, depth + 1);
      else if (match(entry)) found.push(path);
    }
  };
  walk(root, 0);
  return found;
}

/** Read every path, skipping any that can't be read so a partial surface still scans. */
function readAll(paths: string[]): string[] {
  const contents: string[] = [];
  for (const path of paths) {
    try {
      contents.push(readFileSync(path, "utf8"));
    } catch {
      // unreadable file — better a partial surface than aborting the whole scan
    }
  }
  return contents;
}

/**
 * Assemble one app's privacy surface: native files when a prebuilt project exists, else the resolved
 * Expo config (managed workflow, before `expo prebuild` has generated native files).
 */
async function surfaceForApp(app: AppDescriptor): Promise<PrivacySurface> {
  const iosDir = join(app.dir, "ios");
  const androidDir = join(app.dir, "android");
  const infoPlists = readAll(findFiles(iosDir, (name) => name === "Info.plist"));
  const privacyManifests = readAll(findFiles(iosDir, (name) => name.endsWith(".xcprivacy")));
  const androidManifests = readAll(findFiles(androidDir, (name) => name === "AndroidManifest.xml"));

  if (infoPlists.length > 0 || privacyManifests.length > 0 || androidManifests.length > 0) {
    return surfaceFromNative({ infoPlists, privacyManifests, androidManifests });
  }
  return surfaceFromExpoConfig((await readResolvedConfig(app.dir)) ?? {});
}

/**
 * Run the scan: reconcile each selected app's surface, render (or emit JSON), and set the exit code per
 * the readiness contract. Exported so a test or a release script can drive it directly.
 */
export async function runPrivacyScan(input: PrivacyScanOptions): Promise<void> {
  const { apps } = await loadConfig();
  const selected = selectApps(apps, input.app);

  const findings: PrivacyFinding[] = [];
  const scanned: string[] = [];
  for (const app of selected) {
    findings.push(...reconcilePrivacy(app.name, await surfaceForApp(app)));
    scanned.push(app.name);
  }

  const report = buildPrivacyReport(findings, scanned);
  console.log(input.json === true ? JSON.stringify(report, null, 2) : renderPrivacyReport(report));
  process.exitCode = report.exitCode;
}

/** Attach the `privacy` command (with its `scan` subcommand) to the program. */
export function registerPrivacyCommand(program: Command): void {
  const privacy = program
    .command("privacy")
    .description("reconcile your permission/data surface against your privacy declarations");

  privacy
    .command("scan")
    .description(
      "check permissions/manifests against the privacy declarations; flags undeclared collection (read-only)",
    )
    .option("-a, --app <names>", "comma-separated app handles (default: all apps)")
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (options: PrivacyScanOptions) => {
      await runPrivacyScan(options);
    });
}
