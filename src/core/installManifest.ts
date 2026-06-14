/**
 * Generators for the static files an internal (ad-hoc) install link needs.
 *
 * iOS over-the-air installs are driven by an `itms-services://` URL that points at a "manifest" plist
 * describing the `.ipa` to fetch; Android just downloads the `.apk` directly. Both get a small landing
 * page so a tester opens one link and taps Install. These are pure string builders — the distribute
 * pipeline uploads whatever they return to the user's bucket; nothing here touches the network.
 */

import type { Platform } from "./types.js";

/** Escape the five XML special characters so app titles/ids can't break the plist or the HTML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Inputs for the iOS install manifest plist. */
export interface IosManifestOptions {
  /** Public URL of the uploaded `.ipa`. */
  ipaUrl: string;
  bundleId: string;
  /** Marketing version shown during install, e.g. `1.0.0`. */
  version: string;
  /** Display name shown in the install sheet. */
  title: string;
}

/**
 * Build the iOS OTA-install manifest plist (the document an `itms-services://…&url=` link fetches).
 * iOS requires this exact `items → assets[kind=software-package] + metadata` shape to install an
 * ad-hoc `.ipa` straight from a web link.
 */
export function iosInstallManifestPlist(options: IosManifestOptions): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    "<key>items</key><array><dict>",
    "<key>assets</key><array><dict>",
    "<key>kind</key><string>software-package</string>",
    `<key>url</key><string>${escapeXml(options.ipaUrl)}</string>`,
    "</dict></array>",
    "<key>metadata</key><dict>",
    `<key>bundle-identifier</key><string>${escapeXml(options.bundleId)}</string>`,
    `<key>bundle-version</key><string>${escapeXml(options.version)}</string>`,
    "<key>kind</key><string>software</string>",
    `<key>title</key><string>${escapeXml(options.title)}</string>`,
    "</dict></dict></array>",
    "</dict></plist>",
  ].join("\n");
}

/**
 * Wrap a manifest URL in the `itms-services://` scheme iOS recognizes as "install this app". The
 * manifest URL must be HTTPS and is URL-encoded so its query string survives intact.
 */
export function itmsServicesUrl(manifestUrl: string): string {
  return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
}

/** Inputs for the install landing page. */
export interface LandingPageOptions {
  title: string;
  version: string;
  buildNumber: number;
  platform: Platform;
  /** The tap-to-install target: an `itms-services://` URL (iOS) or the direct `.apk` URL (Android). */
  installUrl: string;
}

/**
 * Build the tester-facing install landing page: app name, version/build, and one Install button
 * wired to {@link LandingPageOptions.installUrl}. iOS also gets the standard reminder that ad-hoc
 * installs only work on a device whose UDID is registered on the profile.
 */
export function installLandingPage(options: LandingPageOptions): string {
  const note =
    options.platform === "ios"
      ? "<p>iOS: your device must be registered for this build. After installing, trust the developer in Settings → General → VPN &amp; Device Management.</p>"
      : "<p>Android: you may need to allow installs from this browser/source.</p>";
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>Install ${escapeXml(options.title)}</title>`,
    "<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center}",
    ".btn{display:inline-block;margin:1.5rem 0;padding:.85rem 2rem;background:#111;color:#fff;border-radius:.6rem;text-decoration:none;font-weight:600}",
    "p{color:#555;line-height:1.5}</style></head><body>",
    `<h1>${escapeXml(options.title)}</h1>`,
    `<p>Version ${escapeXml(options.version)} (build ${options.buildNumber})</p>`,
    `<a class="btn" href="${escapeXml(options.installUrl)}">Install</a>`,
    note,
    "</body></html>",
  ].join("\n");
}
