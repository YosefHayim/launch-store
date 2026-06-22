/**
 * Discover and fingerprint the App Store assets `launch sync` uploads (screenshots, app preview videos,
 * and subscription review screenshots), so the reconcilers in `core/ascScreenshots.ts` can diff them
 * against App Store Connect without touching the filesystem itself.
 *
 * Layout convention (chosen to mirror fastlane `deliver` while staying explicit about Apple's device
 * enum): screenshots live under `<appDir>/screenshots/<locale>/<DISPLAY_TYPE>/<image files>`, e.g.
 * `screenshots/en-US/APP_IPHONE_67/01.png`. The second-level folder name IS Apple's
 * `screenshotDisplayType` — naming the target explicitly avoids guessing device family from pixel
 * dimensions (which fails for new hardware Apple maps onto an older constant). App preview videos use the
 * parallel `<appDir>/previews/<locale>/<PREVIEW_TYPE>/<video files>` tree, where the second-level folder
 * is Apple's `previewType` (e.g. `IPHONE_67`) — same lagging-enum caveat, same explicit-target rationale.
 *
 * Idempotency: every asset is MD5-fingerprinted here, matching the `sourceFileChecksum` Apple stores at
 * commit time. The reconciler skips any local file whose checksum already appears on Apple, so re-running
 * `launch sync` after no change uploads nothing.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";

/** Folder, relative to an app's directory, that holds the per-locale screenshot tree. */
export const SCREENSHOTS_DIRNAME = "screenshots";

/** Apple's hard cap on screenshots per (localization × display type) set; extras are skipped, not silently dropped. */
export const MAX_SCREENSHOTS_PER_SET = 10;

/** Image extensions Apple accepts for App Store screenshots (lowercased). */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

/**
 * Apple's documented `screenshotDisplayType` constants → a human label, by device family. This is a
 * **fallback/labeling table only**: folder names are NOT restricted to it. An unrecognized folder name
 * is still uploaded (Apple's enum lags new hardware — a 6.9" iPhone or 13" iPad uses an older constant,
 * and brand-new constants appear before any table can list them), so a new device works with no code
 * change; the table only supplies a friendlier plan line when the type is known.
 */
export const KNOWN_DISPLAY_TYPES: Record<string, string> = {
  APP_IPHONE_67: 'iPhone 6.7"',
  APP_IPHONE_65: 'iPhone 6.5"',
  APP_IPHONE_61: 'iPhone 6.1"',
  APP_IPHONE_58: 'iPhone 5.8"',
  APP_IPHONE_55: 'iPhone 5.5"',
  APP_IPHONE_47: 'iPhone 4.7"',
  APP_IPHONE_40: 'iPhone 4"',
  APP_IPHONE_35: 'iPhone 3.5"',
  APP_IPAD_PRO_3GEN_129: 'iPad Pro 12.9" (3rd gen)',
  APP_IPAD_PRO_3GEN_11: 'iPad Pro 11" (3rd gen)',
  APP_IPAD_PRO_129: 'iPad Pro 12.9"',
  APP_IPAD_105: 'iPad 10.5"',
  APP_IPAD_97: 'iPad 9.7"',
  APP_DESKTOP: "Mac",
  APP_WATCH_ULTRA: "Apple Watch Ultra",
  APP_WATCH_SERIES_7: "Apple Watch Series 7",
  APP_WATCH_SERIES_4: "Apple Watch Series 4",
  APP_WATCH_SERIES_3: "Apple Watch Series 3",
  APP_APPLE_TV: "Apple TV",
  APP_APPLE_VISION_PRO: "Apple Vision Pro",
  IMESSAGE_APP_IPHONE_67: 'iMessage iPhone 6.7"',
  IMESSAGE_APP_IPHONE_65: 'iMessage iPhone 6.5"',
  IMESSAGE_APP_IPHONE_58: 'iMessage iPhone 5.8"',
  IMESSAGE_APP_IPAD_PRO_3GEN_129: 'iMessage iPad Pro 12.9"',
};

/**
 * A local file fingerprinted for idempotent upload. `checksum` is the MD5 Apple records as
 * `sourceFileChecksum`, so a byte-identical re-run is recognized and skipped.
 */
export interface LocalAsset {
  /** Absolute path to the file on disk — handed to the client to read and upload. */
  path: string;
  /** Base file name Apple stores and displays for the asset. */
  fileName: string;
  /** Lowercase-hex MD5 of the file's bytes; the reconciler's skip key. */
  checksum: string;
  /** Size in bytes — sent in the upload reservation so Apple can pre-allocate the chunks. */
  size: number;
}

/** One discovered screenshot: a {@link LocalAsset} tagged with the locale + display type its folder named. */
export interface LocalScreenshot extends LocalAsset {
  /** App Store locale (the first-level folder), e.g. `en-US`. */
  locale: string;
  /** Apple `screenshotDisplayType` (the second-level folder), e.g. `APP_IPHONE_67`. */
  displayType: string;
}

/** A friendlier label for a display type, or the raw constant when it isn't in {@link KNOWN_DISPLAY_TYPES}. */
export function displayTypeLabel(displayType: string): string {
  return KNOWN_DISPLAY_TYPES[displayType] ?? displayType;
}

/** MD5 a file as lowercase hex, alongside its byte length — the two values Apple's asset flow needs. */
export function hashFile(path: string): { checksum: string; size: number } {
  const bytes = readFileSync(path);
  return { checksum: createHash("md5").update(bytes).digest("hex"), size: bytes.byteLength };
}

/** Immediate subdirectory names of `dir` (sorted for a stable walk), or [] when `dir` is absent. */
function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** File names directly in `dir` whose extension is in `extensions` (lowercased), sorted for a deterministic upload order. */
function mediaFilesIn(dir: string, extensions: Set<string>): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Walk a screenshots **root** — any directory laid out as `<root>/<locale>/<displayType>/<image files>` —
 * and fingerprint every image, returning a flat, deterministically-ordered list. Returns [] when the root
 * is absent. This is the convention-tree walker: {@link discoverScreenshots} points it at an app's standard
 * `screenshots/` folder, while `launch ai screenshots` points it at an arbitrary import or staging root.
 */
export function discoverScreenshotsAt(root: string): LocalScreenshot[] {
  const screenshots: LocalScreenshot[] = [];
  for (const locale of subdirs(root)) {
    const localeDir = join(root, locale);
    for (const displayType of subdirs(localeDir)) {
      const typeDir = join(localeDir, displayType);
      for (const fileName of mediaFilesIn(typeDir, IMAGE_EXTENSIONS)) {
        const path = join(typeDir, fileName);
        const { checksum, size } = hashFile(path);
        screenshots.push({ locale, displayType, fileName, path, checksum, size });
      }
    }
  }
  return screenshots;
}

/**
 * Walk `<appDir>/screenshots/<locale>/<displayType>/` and fingerprint every image, returning a flat,
 * deterministically-ordered list. Returns [] when the convention folder is absent — an app simply isn't
 * managing screenshots through Launch.
 */
export function discoverScreenshots(appDir: string): LocalScreenshot[] {
  return discoverScreenshotsAt(join(appDir, SCREENSHOTS_DIRNAME));
}

/**
 * Fingerprint a single declared asset (e.g. a subscription's `reviewScreenshot`), resolving it relative
 * to the app directory. Returns null when the path is missing or isn't a file, so the caller can record
 * an actionable "file not found" skip instead of failing the whole sync.
 */
export function fingerprintAsset(appDir: string, relPath: string): LocalAsset | null {
  const path = isAbsolute(relPath) ? relPath : join(appDir, relPath);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  const { checksum, size } = hashFile(path);
  return { path, fileName: basename(path), checksum, size };
}

// ── App preview videos (`previews/<locale>/<previewType>/`) ──────────────────────────────────────────

/** Folder, relative to an app's directory, that holds the per-locale app-preview-video tree. */
export const PREVIEWS_DIRNAME = "previews";

/** Apple's cap on app preview videos per (localization × preview type) set; extras are skipped, not silently dropped. */
export const MAX_PREVIEWS_PER_SET = 3;

/** Video container extensions Apple accepts for App Store app previews (lowercased). */
const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".m4v"]);

/**
 * Apple's `previewType` constants → a human label. Like {@link KNOWN_DISPLAY_TYPES} this is a
 * **fallback/labeling table only**: folder names are NOT restricted to it. The `previewType` enum lags new
 * hardware the same way `screenshotDisplayType` does, so an unrecognized folder name is still uploaded
 * (Apple maps it) — the table only supplies a friendlier plan line when the type is known. App previews
 * exist for fewer targets than screenshots (no Watch or iMessage previews), which is why this list is shorter.
 */
export const KNOWN_PREVIEW_TYPES: Record<string, string> = {
  IPHONE_67: 'iPhone 6.7"',
  IPHONE_65: 'iPhone 6.5"',
  IPHONE_61: 'iPhone 6.1"',
  IPHONE_58: 'iPhone 5.8"',
  IPHONE_55: 'iPhone 5.5"',
  IPHONE_47: 'iPhone 4.7"',
  IPHONE_40: 'iPhone 4"',
  IPHONE_35: 'iPhone 3.5"',
  IPAD_PRO_3GEN_129: 'iPad Pro 12.9" (3rd gen)',
  IPAD_PRO_3GEN_11: 'iPad Pro 11" (3rd gen)',
  IPAD_PRO_129: 'iPad Pro 12.9"',
  IPAD_105: 'iPad 10.5"',
  IPAD_97: 'iPad 9.7"',
  DESKTOP: "Mac",
  APPLE_TV: "Apple TV",
  APPLE_VISION_PRO: "Apple Vision Pro",
};

/** One discovered app preview video: a {@link LocalAsset} tagged with the locale + preview type its folder named. */
export interface LocalPreview extends LocalAsset {
  /** App Store locale (the first-level folder), e.g. `en-US`. */
  locale: string;
  /** Apple `previewType` (the second-level folder), e.g. `IPHONE_67`. */
  previewType: string;
}

/** A friendlier label for a preview type, or the raw constant when it isn't in {@link KNOWN_PREVIEW_TYPES}. */
export function previewTypeLabel(previewType: string): string {
  return KNOWN_PREVIEW_TYPES[previewType] ?? previewType;
}

/**
 * Walk `<appDir>/previews/<locale>/<previewType>/` and fingerprint every video, returning a flat,
 * deterministically-ordered list — the preview counterpart to {@link discoverScreenshots}. Returns [] when
 * the convention folder is absent (an app simply isn't managing app previews through Launch).
 */
export function discoverPreviews(appDir: string): LocalPreview[] {
  const root = join(appDir, PREVIEWS_DIRNAME);
  const previews: LocalPreview[] = [];
  for (const locale of subdirs(root)) {
    const localeDir = join(root, locale);
    for (const previewType of subdirs(localeDir)) {
      const typeDir = join(localeDir, previewType);
      for (const fileName of mediaFilesIn(typeDir, VIDEO_EXTENSIONS)) {
        const path = join(typeDir, fileName);
        const { checksum, size } = hashFile(path);
        previews.push({ locale, previewType, fileName, path, checksum, size });
      }
    }
  }
  return previews;
}
