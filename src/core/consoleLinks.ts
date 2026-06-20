/**
 * The single source of truth for store-console web URLs, plus the cross-platform opener.
 *
 * `launch open` deep-links a developer from a read-only finding ("agreement unsigned", "missing
 * screenshots") straight to the irreducible UI step that fixes it. Every console URL template lives
 * here — never inlined at a call site — so the App Store Connect / Play Console paths have one home to
 * audit and update when Apple or Google move a page. {@link buildConsoleUrl} resolves a
 * {@link OpenTarget} + {@link Platform} (and the resolved app id, when known) to a URL; {@link openUrl}
 * launches it through the OS browser via `core/exec.ts` (`shell: false`, arg array — never a shell string).
 *
 * Apple supports stable per-app deep links keyed by the App Store Connect app id, so an iOS target lands
 * on the exact app page when the id resolves and on the console home otherwise. Google Play's per-app
 * URLs additionally need the developer-account id (which Launch doesn't hold), so Android targets land on
 * the Play Console home — the same behavior `launch doctor` and the build receipt already use.
 */

import type { OpenTarget, Platform } from "./types.js";
import { run } from "./exec.js";
import { hostOs } from "./os.js";

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
