/**
 * `launch open [target]` — deep-link the current app's relevant web console page in the browser.
 *
 * The connective tissue between Launch's read-only diagnostics (`audit`, `status`, `iap doctor`, `store
 * doctor`) and the irreducible UI steps that fix them: those checks tell you *what's* wrong, `launch open`
 * jumps you to the *page* where you fix it. Thin commander wiring only — it parses the target/flags,
 * reuses the shared app selector and ASC app-id reader, then asks `core/consoleLinks.ts` for the URL and
 * the cross-platform opener. All URL templates live in core (the single source of truth); none here.
 */

import type { Command } from "commander";
import type { AppDescriptor, OpenTarget, Platform } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { selectApps } from "../../core/syncJobs.js";
import { createAscClientResolver } from "../../core/storeClients.js";
import { buildConsoleUrl, openUrl } from "../../core/consoleLinks.js";

/** The accepted `[target]` values, in the order help lists them; the default is the first. */
const OPEN_TARGETS: readonly OpenTarget[] = [
  "asc",
  "play",
  "testflight",
  "listing",
  "reviews",
  "agreements",
  "app-record",
] as const;

/** CLI options for `launch open`. */
interface OpenOptions {
  /** Which store's console to open: `ios` (App Store Connect) or `android` (Play Console). */
  platform?: string;
  /** App handle to open; defaults to the first discovered app for the platform. */
  app?: string;
}

/** Validate the optional `[target]`, defaulting to `asc`, and rejecting anything off the known list. */
export function parseOpenTarget(value: string | undefined): OpenTarget {
  if (value === undefined) return "asc";
  const target = OPEN_TARGETS.find((known) => known === value);
  if (!target) throw new Error(`Unknown target "${value}". Use one of: ${OPEN_TARGETS.join(", ")}.`);
  return target;
}

/**
 * Resolve the platform for an open: the explicit `--platform` flag wins (validated to `ios`/`android`);
 * a `play` target implies `android`; otherwise iOS is the default, matching the rest of the CLI.
 */
export function resolveOpenPlatform(target: OpenTarget, flag: string | undefined): Platform {
  if (flag !== undefined) {
    if (flag !== "ios" && flag !== "android") throw new Error(`Unknown --platform "${flag}". Use "ios" or "android".`);
    return flag;
  }
  return target === "play" ? "android" : "ios";
}

/**
 * Pick the one app to open from the discovered apps for a platform. Honors `--app`, else takes the first
 * app that has the platform's id (a bundle id for iOS, a package name for Android). Throws a pointed error
 * when nothing qualifies so the user knows to add the id rather than landing on an empty console.
 */
export function selectOpenApp(apps: AppDescriptor[], platform: Platform, selector: string | undefined): AppDescriptor {
  const hasId = (app: AppDescriptor): boolean =>
    platform === "ios" ? Boolean(app.bundleId) : Boolean(app.packageName);
  const candidates = selectApps(apps, selector).filter(hasId);
  const app = candidates[0];
  if (!app) {
    const idLabel = platform === "ios" ? "ios.bundleIdentifier" : "android.package";
    throw new Error(
      `No ${platform} app found${selector ? ` matching "${selector}"` : ""}. Add an ${idLabel} in app.json.`,
    );
  }
  return app;
}

/** Attach the top-level `open` command to the program. */
export function registerOpenCommand(program: Command): void {
  program
    .command("open")
    .description("deep-link the app's App Store Connect / Play Console page in your browser")
    .argument("[target]", `what to open: ${OPEN_TARGETS.join(" | ")} (default: asc)`)
    .option("--platform <platform>", "ios (App Store Connect) or android (Play Console)")
    .option("-a, --app <name>", "app handle to open (default: the first app for the platform)")
    .action(async (target: string | undefined, options: OpenOptions) => {
      const open = parseOpenTarget(target);
      const platform = resolveOpenPlatform(open, options.platform);
      const { apps } = await loadConfig();
      const app = selectOpenApp(apps, platform, options.app);

      // Apple deep links key off the App Store Connect app id; resolve it for iOS (best-effort — a
      // missing id falls back to the apps list). Android URLs are id-free, so skip the network call.
      let appId: string | undefined;
      if (platform === "ios" && app.bundleId) {
        const asc = await createAscClientResolver()();
        appId = (await asc?.getAppId(app.bundleId).catch(() => null)) ?? undefined;
      }

      const url = buildConsoleUrl(open, platform, appId);
      console.log(`Opening ${url}`);
      await openUrl(url);
    });
}
