/**
 * The core of `launch open`: store-console URL templates, the cross-platform opener, and the
 * orchestration that turns a target + flags into the page to open.
 *
 * `launch open` deep-links a developer from a read-only finding ("agreement unsigned", "missing
 * screenshots") straight to the irreducible UI step that fixes it. Every console URL template lives
 * here — never inlined at a call site — so the App Store Connect / Play Console paths have one home to
 * audit and update when Apple or Google move a page. {@link buildConsoleUrl} is the pure URL resolver;
 * {@link resolveOpenUrl} is the I/O orchestrator the CLI calls (parse target → resolve platform →
 * select the app → look up the App Store Connect id → build the URL); {@link openUrl} launches it
 * through the OS browser via `core/exec.ts` (`shell: false`, arg array — never a shell string). The
 * `src/cli/commands/open.ts` command is intentionally pure commander wiring over these — no domain
 * logic lives there.
 *
 * Apple supports stable per-app deep links keyed by the App Store Connect app id, so an iOS target lands
 * on the exact app page when the id resolves and on the console home otherwise. Google Play's per-app
 * URLs additionally need the developer-account id (which Launch doesn't hold), so Android targets land on
 * the Play Console home — the same behavior `launch doctor` and the build receipt already use.
 */

import type { AppDescriptor, OpenTarget, Platform } from "./types.js";
import { isApplePlatform, parsePlatform } from "./platform.js";
import { run } from "./exec.js";
import { hostOs } from "./os.js";
import { loadConfig } from "./config.js";
import { selectApps } from "./syncJobs.js";
import { createAscClientResolver } from "./storeClients.js";

/** The accepted `[target]` values for `launch open`, in the order help lists them; the default is the first. */
export const OPEN_TARGETS: readonly OpenTarget[] = [
  "asc",
  "play",
  "testflight",
  "listing",
  "reviews",
  "agreements",
  "app-record",
] as const;

/**
 * Flags accepted by `launch open`, forwarded verbatim from commander to {@link resolveOpenUrl}.
 * Both are optional; the resolver applies the same platform/app defaults as the rest of the CLI.
 */
export interface OpenUrlOptions {
  /** Which store's console to open: `ios` (App Store Connect) or `android` (Play Console). */
  platform?: string;
  /** App handle to open; defaults to the first discovered app that has the platform's id. */
  app?: string;
}

/** App Store Connect web origin — Apple's per-app pages hang off `/apps/{id}`. */
const ASC_ORIGIN = "https://appstoreconnect.apple.com";
/** Google Play Console home. Per-app Play URLs need the developer-account id Launch doesn't have. */
const PLAY_CONSOLE_URL = "https://play.google.com/console";

/**
 * The App Store Connect URL for a target, given the resolved app id (or `undefined` when it couldn't be
 * resolved — e.g. the app record doesn't exist yet). Account-level targets (`agreements`) ignore the id;
 * app-level targets fall back to the apps list when the id is unknown so the link is still useful.
 */
function ascUrl(target: OpenTarget, appId: string | undefined): string {
  if (target === "agreements") return `${ASC_ORIGIN}/agreements/`;
  if (!appId) return `${ASC_ORIGIN}/apps`;
  const appBase = `${ASC_ORIGIN}/apps/${appId}`;
  switch (target) {
    case "testflight":
      return `${appBase}/testflight/ios`;
    case "listing":
      return `${appBase}/appstore`;
    case "reviews":
      return `${appBase}/ratings-and-reviews/ios`;
    case "asc":
    case "play":
    case "app-record":
      return appBase;
  }
}

/**
 * Resolve a console URL for `launch open`. The `agreements` target is account-level (no platform
 * branch); every other target picks the App Store Connect page for iOS and the Play Console for Android.
 *
 * @param target the requested page (see {@link OpenTarget}).
 * @param platform which store's console to open. `play` always means Android; otherwise this decides.
 * @param appId the resolved App Store Connect app id, when known — only used for iOS deep links.
 */
export function buildConsoleUrl(target: OpenTarget, platform: Platform, appId: string | undefined): string {
  if (target === "play") return PLAY_CONSOLE_URL;
  if (platform === "android") return PLAY_CONSOLE_URL;
  return ascUrl(target, appId);
}

/** Validate the optional `[target]`, defaulting to `asc`, and rejecting anything off the known list. */
export function parseOpenTarget(value: string | undefined): OpenTarget {
  if (value === undefined) return "asc";
  const target = OPEN_TARGETS.find((known) => known === value);
  if (!target) throw new Error(`Unknown target "${value}". Use one of: ${OPEN_TARGETS.join(", ")}.`);
  return target;
}

/**
 * Resolve the platform for an open: the explicit `--platform` flag wins; a `play` target implies
 * `android`; otherwise iOS is the default, matching the rest of the CLI. The web console is family-level —
 * every Apple platform shares one App Store Connect app page — so the Apple platforms collapse to `ios`.
 */
export function resolveOpenPlatform(target: OpenTarget, flag: string | undefined): Platform {
  if (flag !== undefined) return isApplePlatform(parsePlatform(flag)) ? "ios" : "android";
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
  const app = selectApps(apps, selector).find(hasId);
  if (!app) {
    const idLabel = platform === "ios" ? "ios.bundleIdentifier" : "android.package";
    throw new Error(
      `No ${platform} app found${selector ? ` matching "${selector}"` : ""}. Add an ${idLabel} in app.json.`,
    );
  }
  return app;
}

/**
 * The full `launch open` resolution, from raw CLI input to the URL to launch — the single core
 * operation the command wires to. Parses the target, resolves the platform and the target app, and for
 * iOS best-effort resolves the App Store Connect app id (a missing id falls back to the apps list, never
 * throws). Android URLs are id-free, so the network call is skipped.
 */
export async function resolveOpenUrl(rawTarget: string | undefined, options: OpenUrlOptions): Promise<string> {
  const target = parseOpenTarget(rawTarget);
  const platform = resolveOpenPlatform(target, options.platform);
  const { apps } = await loadConfig();
  const app = selectOpenApp(apps, platform, options.app);

  let appId: string | undefined;
  if (platform === "ios" && app.bundleId) {
    const asc = await createAscClientResolver()();
    appId = (await asc?.getAppId(app.bundleId).catch(() => null)) ?? undefined;
  }

  return buildConsoleUrl(target, platform, appId);
}

/**
 * The host's shell-free URL opener: `open` on macOS, `xdg-open` on Linux, `start` on Windows. Routed
 * through {@link run} (`shell: false`, explicit arg array), mirroring `cli/commands/builds.ts`'s log
 * opener. The Windows `start` is a `cmd` builtin, not an executable, so it's invoked as
 * `cmd /c start "" <url>` — the empty `""` is `start`'s title argument, which keeps a URL with spaces
 * from being mistaken for the window title.
 */
export function openUrl(url: string): Promise<void> {
  switch (hostOs()) {
    case "macos":
      return run("open", [url]);
    case "linux":
      return run("xdg-open", [url]);
    case "windows":
      return run("cmd", ["/c", "start", "", url]);
  }
}
