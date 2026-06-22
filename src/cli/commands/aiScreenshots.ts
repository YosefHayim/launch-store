/**
 * `launch ai screenshots` — turn the real screenshots you already captured into store-ready ones with the
 * genshot backend, then promote them into the app's `screenshots/` tree for `launch sync` to upload.
 *
 * The safety rail is the same plan→confirm→apply shape the rest of Launch uses, with two extra guards
 * specific to generated imagery:
 *
 *  1. **Enhance, never fabricate.** genshot only *enhances real screenshots* the user passes in (import-only
 *     for v1) — App Store Review 2.3.3 rejects screenshots that don't depict the actual app, so generating
 *     from a prompt alone is out of scope.
 *  2. **Hard-gate the dimensions.** Whatever genshot returns is measured and validated against the store's
 *     exact pixel rules ({@link checkScreenshotFile}) *before* anything is staged — a backend that returned
 *     an off-spec image is caught locally rather than rejected by the store on upload.
 *
 * The genshot backend is a *paid hosted* service and a separate binary: it owns auth, the REST round-trip,
 * polling, and the (locale × device) fan-out. This client owns the local half — discover the real
 * screenshots, invoke genshot, hard-gate, stage, let the user eyeball the results, and on confirmation
 * promote them into `<appDir>/screenshots/<locale>/<DISPLAY_TYPE>/`. The backend is reached through the
 * injectable {@link ScreenshotEnhancer} seam (shelling out to the `genshot` CLI by default), so this
 * command is fully testable without the binary and stays decoupled from genshot's wire protocol.
 */

import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { Command } from "commander";
import { aiGroup, confirmWrite } from "./ai.js";
import { run } from "../../core/exec.js";
import { openUrl } from "../../core/consoleLinks.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { createLogger } from "../../core/logger.js";
import { discoverScreenshotsAt, SCREENSHOTS_DIRNAME, type LocalScreenshot } from "../../core/screenshotAssets.js";
import {
  checkScreenshotFile,
  DEFAULT_APPLE_DISPLAY_TYPES,
  DEFAULT_PLAY_FORM_FACTORS,
} from "../../core/screenshotSpecs.js";
import type { Platform } from "../../core/types.js";

/** Default name of the genshot CLI on the PATH; overridable per-invocation with `--genshot-bin`. */
const GENSHOT_BIN = "genshot";

/**
 * Whether a child-process failure is "the executable wasn't found" — the `ENOENT` spawn error Node raises
 * when a binary isn't on the PATH. Used to turn a missing `genshot` into an actionable install hint without
 * a PATH preflight (a `which`-style check is unreliable on Windows; letting the spawn fail is portable).
 */
function isMissingBinaryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Options for `launch ai screenshots`. */
export interface AiScreenshotsInput {
  /** App handle; auto-selected when the repo has a single app. */
  app?: string;
  /** A short description of the app to steer the enhancement (passed through to genshot). */
  brief?: string;
  /** Comma-separated locales; defaults to the locales present in the source screenshots, else `en-US`. */
  locale?: string;
  /** Which store(s) to generate for: `ios`, `android`, or `all` (default). */
  platform?: string;
  /** Directory of real source screenshots to enhance; defaults to `<appDir>/screenshots`. */
  in?: string;
  /** Comma-separated captions, one per shot; omit to let genshot auto-write them. */
  captions?: string;
  /** Comma-separated target slots (Apple display types / Play form factors); defaults to the modern base set. */
  deviceTypes?: string;
  /** Where to promote the approved screenshots; defaults to `<appDir>/screenshots`. */
  out?: string;
  /** Path to the genshot CLI, overriding the `genshot` on PATH. */
  genshotBin?: string;
  /** Enhance and preview only, promoting nothing. */
  dryRun?: boolean;
  /** Skip the confirmation prompt (for CI). */
  yes?: boolean;
}

/**
 * One screenshot genshot produced in the staging dir, ready to be hard-gated and promoted. `target` is the
 * slot the file belongs to — an Apple `screenshotDisplayType` for iOS or a Play form factor for Android —
 * which (with `locale`) determines the `<locale>/<target>/` folder it lands in.
 */
export interface EnhancedShot {
  /** Absolute path to the produced file in the staging dir. */
  path: string;
  /** Store locale the shot belongs to (the first-level folder), e.g. `en-US`. */
  locale: string;
  /** Apple display type (iOS) or Play form factor (Android) — the second-level folder. */
  target: string;
}

/**
 * A request to the genshot backend to enhance real screenshots into store-ready ones for a single platform.
 * The backend expands the `locales × targets` matrix itself and writes the results under `outDir`.
 */
export interface EnhanceRequest {
  /** The store to generate for — fixes which dimension rules the output must satisfy. */
  platform: Platform;
  /** Free-text steer for the enhancement, when the user supplied `--brief`. */
  brief?: string;
  /** Locales to produce a set for. */
  locales: string[];
  /** Target slots to produce (Apple display types or Play form factors). */
  targets: string[];
  /** Captions to burn in, one per shot; absent means genshot writes its own. */
  captions?: string[];
  /** Absolute paths to the real screenshots to enhance. */
  sources: string[];
  /** Staging directory the backend must write its `<locale>/<target>/<file>` output into. */
  outDir: string;
}

/**
 * The genshot seam: enhance real screenshots into store-ready ones. Injectable so the command is testable
 * without the genshot binary; the default implementation ({@link createGenshotEnhancer}) shells out to the
 * `genshot` CLI exactly like the fastlane / eas / bundletool integrations.
 */
export interface ScreenshotEnhancer {
  /** Display name of the backend, for log lines. */
  name: string;
  /** Produce the enhanced screenshots for one platform, returning each file with its locale + target. */
  enhance(request: EnhanceRequest): Promise<EnhancedShot[]>;
}

/**
 * The default genshot seam: shells out to the `genshot` CLI, then walks the staging dir it wrote and
 * returns the produced files. genshot owns auth, the REST round-trip, polling, and the matrix fan-out; this
 * client only invokes it and discovers its output (reusing {@link discoverScreenshots}'s `<locale>/<target>/`
 * walk, which the genshot output mirrors).
 *
 * NOTE: the `genshot enhance` argument contract below is PROVISIONAL — the genshot binary is not yet
 * released; these flags are the intended shape and will be reconciled against the real CLI when it ships.
 */
function createGenshotEnhancer(binPath: string | undefined): ScreenshotEnhancer {
  const bin = binPath ?? GENSHOT_BIN;
  return {
    name: "genshot",
    async enhance(request: EnhanceRequest): Promise<EnhancedShot[]> {
      mkdirSync(request.outDir, { recursive: true });
      const args = [
        "enhance",
        "--platform",
        request.platform,
        "--out",
        request.outDir,
        "--locales",
        request.locales.join(","),
        "--targets",
        request.targets.join(","),
      ];
      if (request.brief) args.push("--brief", request.brief);
      if (request.captions) args.push("--captions", request.captions.join(","));
      args.push(...request.sources);
      try {
        await run(bin, args);
      } catch (error) {
        if (isMissingBinaryError(error)) {
          throw new Error(
            "genshot CLI not found. Install the genshot screenshot backend (a paid hosted service) and sign in, " +
              "or point at a local build with --genshot-bin <path>.",
          );
        }
        throw error;
      }
      return discoverScreenshotsAt(request.outDir).map((shot) => ({
        path: shot.path,
        locale: shot.locale,
        target: shot.displayType,
      }));
    },
  };
}

/** Resolve `--platform` into the stores it targets; defaults to both. */
function parsePlatforms(platform: string | undefined): Platform[] {
  switch (platform ?? "all") {
    case "ios":
      return ["ios"];
    case "android":
      return ["android"];
    case "all":
      return ["ios", "android"];
    default:
      throw new Error(`Unknown platform "${platform}". Use ios, android, or all.`);
  }
}

/** Locales to generate: an explicit `--locale` CSV, else the locales the source screenshots already use, else `en-US`. */
function resolveLocales(csv: string | undefined, sources: LocalScreenshot[]): string[] {
  if (csv !== undefined) {
    const locales = csv
      .split(",")
      .map((locale) => locale.trim())
      .filter(Boolean);
    if (locales.length === 0) throw new Error("--locale was empty. Pass locales like --locale en-US,fr-FR.");
    return locales;
  }
  const present = [...new Set(sources.map((shot) => shot.locale))];
  return present.length > 0 ? present : ["en-US"];
}

/** Target slots to generate for a platform: an explicit `--device-types` CSV, else the platform's default base set. */
function resolveTargets(platform: Platform, csv: string | undefined): string[] {
  if (csv !== undefined) {
    const targets = csv
      .split(",")
      .map((target) => target.trim())
      .filter(Boolean);
    if (targets.length === 0)
      throw new Error("--device-types was empty. Pass slots like --device-types APP_IPHONE_67.");
    return targets;
  }
  return platform === "ios" ? [...DEFAULT_APPLE_DISPLAY_TYPES] : [...DEFAULT_PLAY_FORM_FACTORS];
}

/** Parse the optional `--captions` CSV; `undefined` (omitted) signals genshot to auto-write captions. */
function parseCaptions(csv: string | undefined): string[] | undefined {
  if (csv === undefined) return undefined;
  return csv
    .split(",")
    .map((caption) => caption.trim())
    .filter(Boolean);
}

/**
 * Hard-gate genshot's output: measure every produced file and reject the whole batch if any is unreadable
 * or off-spec for its store. Throwing here (rather than warning) is deliberate — an off-spec generated
 * screenshot is a backend defect, and promoting it would only defer the rejection to the store at upload.
 */
function hardGate(platform: Platform, shots: EnhancedShot[]): void {
  for (const shot of shots) {
    const check = checkScreenshotFile(platform, shot.target, shot.path);
    if (!check.measured) {
      throw new Error(`genshot produced an unreadable ${platform} file (${basename(shot.path)}) for ${shot.target}.`);
    }
    if (!check.verdict.ok) {
      throw new Error(
        `genshot returned an off-spec ${platform} screenshot for ${shot.target}: ${check.verdict.reason}`,
      );
    }
  }
}

/** Copy one approved shot into `<outDir>/<locale>/<target>/`, preserving its file name. */
function promoteShot(outDir: string, shot: EnhancedShot): void {
  const dest = join(outDir, shot.locale, shot.target);
  mkdirSync(dest, { recursive: true });
  copyFileSync(shot.path, join(dest, basename(shot.path)));
}

/**
 * The core of `launch ai screenshots` for an already-resolved app directory: discover the real source
 * screenshots, run them through the genshot seam per platform, hard-gate the results, let the user preview
 * the staged files, and on confirmation promote them into `outDir`. Split from {@link runAiScreenshots} (which
 * only adds app discovery) so it's unit-testable with a fake enhancer and no global config.
 *
 * Returns the shots that were promoted — empty on a dry run or a declined confirmation.
 */
export async function generateScreenshots(
  appDir: string,
  input: AiScreenshotsInput,
  enhancer: ScreenshotEnhancer,
): Promise<EnhancedShot[]> {
  const log = createLogger(false);
  const platforms = parsePlatforms(input.platform);
  const sourcesDir = input.in ?? join(appDir, SCREENSHOTS_DIRNAME);
  const outDir = input.out ?? join(appDir, SCREENSHOTS_DIRNAME);

  const sources = discoverScreenshotsAt(sourcesDir);
  if (sources.length === 0) {
    throw new Error(
      `No source screenshots under ${sourcesDir}. Capture real screens into screenshots/<locale>/<DISPLAY_TYPE>/ first — ` +
        "`launch ai screenshots` enhances real screenshots (import-only for v1), it doesn't fabricate them.",
    );
  }

  const locales = resolveLocales(input.locale, sources);
  const captions = parseCaptions(input.captions);
  const sourcePaths = sources.map((shot) => shot.path);
  const staging = mkdtempSync(join(tmpdir(), "launch-genshot-"));

  const enhanced: EnhancedShot[] = [];
  for (const platform of platforms) {
    const targets = resolveTargets(platform, input.deviceTypes);
    log.info(`Enhancing ${sources.length} screenshot(s) → ${platform} (${targets.join(", ")}) with ${enhancer.name}…`);
    const request: EnhanceRequest = {
      platform,
      locales,
      targets,
      sources: sourcePaths,
      outDir: join(staging, platform),
      ...(input.brief !== undefined ? { brief: input.brief } : {}),
      ...(captions !== undefined ? { captions } : {}),
    };
    const shots = await enhancer.enhance(request);
    hardGate(platform, shots);
    enhanced.push(...shots);
  }

  log.info(`genshot produced ${enhanced.length} store-ready screenshot(s):`);
  for (const shot of enhanced) log.info(`  ${shot.locale}/${shot.target} — ${basename(shot.path)}`);

  if (input.dryRun) {
    log.info("Dry run — nothing promoted. Drop --dry-run to stage and promote.");
    return [];
  }

  // Reveal the staged files in the OS file viewer so the user can eyeball them before promoting. Only when
  // we're about to prompt interactively; best-effort, since a headless box has no opener.
  if (!input.yes && process.stdout.isTTY) {
    await openUrl(staging).catch(() => undefined);
  }
  if (!(await confirmWrite(`Promote ${enhanced.length} screenshot(s) into ${outDir}?`, input.yes))) return [];

  for (const shot of enhanced) promoteShot(outDir, shot);
  log.step("ai screenshots", `promoted ${enhanced.length} screenshot(s) → ${outDir}`);
  log.info("Review with `launch plan screenshots`, then upload with `launch sync`.");
  return enhanced;
}

/**
 * Resolve the app, then enhance and promote its screenshots. The enhancer is injectable so tests drive it
 * without the genshot binary; in normal use it defaults to the `genshot`-CLI-backed one.
 */
export async function runAiScreenshots(input: AiScreenshotsInput, enhancer?: ScreenshotEnhancer): Promise<void> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, input.app);
  await generateScreenshots(app.dir, input, enhancer ?? createGenshotEnhancer(input.genshotBin));
}

/** Attach the `ai screenshots` subcommand to the shared `ai` group. */
export function registerAiScreenshotsCommand(program: Command): void {
  const ai = aiGroup(program);

  ai.command("screenshots")
    .description(
      "enhance your real screenshots into store-ready ones with genshot (review with `launch plan screenshots`)",
    )
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--brief <text>", "a short description of the app to steer the enhancement")
    .option("--locale <list>", "comma-separated locales (default: the locales of your source screenshots, else en-US)")
    .option("--platform <p>", "ios, android, or all (default)", "all")
    .option("--in <dir>", "directory of real source screenshots to enhance (default: <app>/screenshots)")
    .option("--captions <list>", "comma-separated captions, one per shot (omit to let genshot write them)")
    .option("--device-types <list>", "comma-separated target slots (default: the modern iPhone/iPad + Play phone set)")
    .option("--out <dir>", "where to promote approved screenshots (default: <app>/screenshots)")
    .option("--genshot-bin <path>", "path to the genshot CLI (default: genshot on PATH)")
    .option("--dry-run", "enhance and preview, but promote nothing", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (options: AiScreenshotsInput) => {
      await runAiScreenshots(options);
    });
}
