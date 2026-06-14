/**
 * Store-listing metadata: parse Expo's `store.config.json` and translate it to/from the on-disk
 * metadata folders that fastlane `deliver` (iOS) and `supply` (Android) read and write.
 *
 * Why this shape: `eas metadata` uses `store.config.json` for the App Store listing but has NO Android
 * support at all. Launch adopts the same file verbatim for iOS (so an EAS user migrates by copying it)
 * and EXTENDS it with an `android` section for the Play listing — covering a platform EAS can't.
 *
 * Why fastlane (not the ASC API directly): `deliver`/`supply` own the fiddly, transactional listing
 * edits and screenshot handling. Routing through them sidesteps the exact direct-API listing bugs
 * EAS keeps hitting (e.g. screenshots that re-upload identically, reorders that silently no-op),
 * and reuses the build engine Launch already depends on. This module is the pure translation layer;
 * the command (`cli/commands/metadata.ts`) drives the actual fastlane runs.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The full `store.config.json` document. `apple` matches Expo/EAS's schema (a subset of the fields
 * `eas metadata` supports); `android` is Launch's own extension (no EAS equivalent). Either platform
 * section may be absent — `launch metadata --platform ios` only needs `apple`.
 */
export interface StoreConfig {
  /** Schema version, carried through untouched for forward-compat with Expo's format. */
  configVersion?: number;
  apple?: AppleStoreConfig;
  android?: AndroidStoreConfig;
}

/** The App Store listing: per-locale text plus app-level category ids. */
export interface AppleStoreConfig {
  /** Per-locale listing, keyed by Apple locale (e.g. `en-US`). */
  info: Record<string, AppleLocaleInfo>;
  /** App Store category ids (e.g. `PRODUCTIVITY`). Optional; left untouched when absent. */
  categories?: string[];
}

/** One locale's App Store listing text. Every field is optional — only what's present is pushed. */
export interface AppleLocaleInfo {
  title?: string;
  subtitle?: string;
  description?: string;
  keywords?: string[];
  releaseNotes?: string;
  promotionalText?: string;
  marketingUrl?: string;
  supportUrl?: string;
  privacyPolicyUrl?: string;
}

/** The Play Store listing (Launch's extension; no EAS equivalent): per-locale text. */
export interface AndroidStoreConfig {
  /** Per-locale listing, keyed by Play locale (e.g. `en-US`). */
  info: Record<string, AndroidLocaleInfo>;
}

/** One locale's Play Store listing text. */
export interface AndroidLocaleInfo {
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
  video?: string;
}

/** Map each Apple listing field to fastlane `deliver`'s per-locale filename. The single source of the mapping. */
const APPLE_FILES: Record<keyof Omit<AppleLocaleInfo, "keywords">, string> = {
  title: "name.txt",
  subtitle: "subtitle.txt",
  description: "description.txt",
  releaseNotes: "release_notes.txt",
  promotionalText: "promotional_text.txt",
  marketingUrl: "marketing_url.txt",
  supportUrl: "support_url.txt",
  privacyPolicyUrl: "privacy_url.txt",
};
/** `deliver` stores keywords comma-joined in their own file. */
const APPLE_KEYWORDS_FILE = "keywords.txt";

/** Map each Play listing field to fastlane `supply`'s per-locale filename. */
const ANDROID_FILES: Record<keyof AndroidLocaleInfo, string> = {
  title: "title.txt",
  shortDescription: "short_description.txt",
  fullDescription: "full_description.txt",
  video: "video.txt",
};

/** Narrow an unknown value to a plain object, or null. Mirrors `config.ts` (no zod dependency). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Read a string field, or undefined when absent/non-string. */
function str(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

/** Read a string-array field (e.g. keywords/categories), dropping non-string entries. */
function strArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === "string");
  return items.length > 0 ? items : undefined;
}

/**
 * Drop undefined-valued keys so the result carries only fields that were actually present. The return
 * type makes every key optional-without-undefined, which is what `exactOptionalPropertyTypes` wants
 * (an absent key, never a `key: undefined`). The cast is the unavoidable cost of `Object.fromEntries`
 * losing the key types; it's sound because we only remove entries.
 */
function compact<T extends Record<string, unknown>>(object: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/** Parse one Apple locale block from raw JSON into a typed {@link AppleLocaleInfo}. */
function parseAppleLocale(raw: Record<string, unknown>): AppleLocaleInfo {
  return compact({
    title: str(raw, "title"),
    subtitle: str(raw, "subtitle"),
    description: str(raw, "description"),
    keywords: strArray(raw, "keywords"),
    releaseNotes: str(raw, "releaseNotes"),
    promotionalText: str(raw, "promotionalText"),
    marketingUrl: str(raw, "marketingUrl"),
    supportUrl: str(raw, "supportUrl"),
    privacyPolicyUrl: str(raw, "privacyPolicyUrl"),
  });
}

/** Parse one Android locale block from raw JSON into a typed {@link AndroidLocaleInfo}. */
function parseAndroidLocale(raw: Record<string, unknown>): AndroidLocaleInfo {
  return compact({
    title: str(raw, "title"),
    shortDescription: str(raw, "shortDescription"),
    fullDescription: str(raw, "fullDescription"),
    video: str(raw, "video"),
  });
}

/** Parse a per-locale `info` map, applying `parseLocale` to each locale's block. */
function parseInfo<T>(infoRaw: unknown, parseLocale: (raw: Record<string, unknown>) => T): Record<string, T> {
  const record = asRecord(infoRaw);
  if (!record) return {};
  const info: Record<string, T> = {};
  for (const [locale, block] of Object.entries(record)) {
    const blockRecord = asRecord(block);
    if (blockRecord) info[locale] = parseLocale(blockRecord);
  }
  return info;
}

/**
 * Parse and validate a raw `store.config.json` value into a typed {@link StoreConfig}. Tolerant of
 * missing platform sections (so a single-platform listing is valid), but rejects a non-object document
 * outright so a malformed file fails loudly instead of silently pushing an empty listing.
 */
export function parseStoreConfig(raw: unknown): StoreConfig {
  const record = asRecord(raw);
  if (!record) throw new Error("store.config.json must be a JSON object.");

  const config: StoreConfig = {};
  if (typeof record["configVersion"] === "number") config.configVersion = record["configVersion"];

  const appleRaw = asRecord(record["apple"]);
  if (appleRaw) {
    const apple: AppleStoreConfig = { info: parseInfo(appleRaw["info"], parseAppleLocale) };
    const categories = strArray(appleRaw, "categories");
    if (categories) apple.categories = categories;
    config.apple = apple;
  }

  const android = asRecord(record["android"]);
  if (android) {
    config.android = { info: parseInfo(android["info"], parseAndroidLocale) };
  }

  if (!config.apple && !config.android) {
    throw new Error('store.config.json has neither an "apple" nor an "android" section — nothing to push.');
  }
  return config;
}

/** Read and parse a `store.config.json` from disk. */
export function loadStoreConfig(path: string): StoreConfig {
  if (!existsSync(path))
    throw new Error(`No store.config.json at ${path}. Run \`launch metadata pull\` to create one.`);
  return parseStoreConfig(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Write `apple` listing text into fastlane `deliver`'s metadata layout under `dir` (one folder per
 * locale, one `.txt` file per field), returning the relative file paths written. The inverse of
 * {@link readAppleMetadataDir}; used by `launch metadata push` to feed `deliver --metadata_path`.
 */
export function writeAppleMetadataDir(apple: AppleStoreConfig, dir: string): string[] {
  const written: string[] = [];
  for (const [locale, info] of Object.entries(apple.info)) {
    const localeDir = join(dir, locale);
    mkdirSync(localeDir, { recursive: true });
    for (const [field, file] of Object.entries(APPLE_FILES)) {
      const value = info[field as keyof typeof APPLE_FILES];
      if (value === undefined) continue;
      writeFileSync(join(localeDir, file), value);
      written.push(join(locale, file));
    }
    if (info.keywords?.length) {
      writeFileSync(join(localeDir, APPLE_KEYWORDS_FILE), info.keywords.join(", "));
      written.push(join(locale, APPLE_KEYWORDS_FILE));
    }
  }
  return written;
}

/**
 * Write `android` listing text into fastlane `supply`'s metadata layout under `dir`. The inverse of
 * {@link readAndroidMetadataDir}; used by `launch metadata push` to feed `supply --metadata_path`.
 */
export function writeAndroidMetadataDir(android: AndroidStoreConfig, dir: string): string[] {
  const written: string[] = [];
  for (const [locale, info] of Object.entries(android.info)) {
    const localeDir = join(dir, locale);
    mkdirSync(localeDir, { recursive: true });
    for (const [field, file] of Object.entries(ANDROID_FILES)) {
      const value = info[field as keyof AndroidLocaleInfo];
      if (value === undefined) continue;
      writeFileSync(join(localeDir, file), value);
      written.push(join(locale, file));
    }
  }
  return written;
}

/** Read a single metadata `.txt` file, returning undefined when it's absent or blank. */
function readField(localeDir: string, file: string): string | undefined {
  const path = join(localeDir, file);
  if (!existsSync(path)) return undefined;
  const value = readFileSync(path, "utf8").trim();
  return value.length > 0 ? value : undefined;
}

/** List the immediate subdirectories of `dir` (the per-locale folders), or [] when `dir` is absent. */
function localeDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Read fastlane `deliver` metadata folders under `dir` back into an {@link AppleStoreConfig}. The
 * inverse of {@link writeAppleMetadataDir}; used by `launch metadata pull` after `deliver` downloads
 * the live listing.
 */
export function readAppleMetadataDir(dir: string): AppleStoreConfig {
  const info: Record<string, AppleLocaleInfo> = {};
  for (const locale of localeDirs(dir)) {
    const localeDir = join(dir, locale);
    const keywords = readField(localeDir, APPLE_KEYWORDS_FILE);
    const localeInfo = compact({
      title: readField(localeDir, APPLE_FILES.title),
      subtitle: readField(localeDir, APPLE_FILES.subtitle),
      description: readField(localeDir, APPLE_FILES.description),
      keywords: keywords
        ? keywords
            .split(",")
            .map((keyword) => keyword.trim())
            .filter(Boolean)
        : undefined,
      releaseNotes: readField(localeDir, APPLE_FILES.releaseNotes),
      promotionalText: readField(localeDir, APPLE_FILES.promotionalText),
      marketingUrl: readField(localeDir, APPLE_FILES.marketingUrl),
      supportUrl: readField(localeDir, APPLE_FILES.supportUrl),
      privacyPolicyUrl: readField(localeDir, APPLE_FILES.privacyPolicyUrl),
    });
    if (Object.keys(localeInfo).length > 0) info[locale] = localeInfo;
  }
  return { info };
}

/** Read fastlane `supply` metadata folders under `dir` back into an {@link AndroidStoreConfig}. */
export function readAndroidMetadataDir(dir: string): AndroidStoreConfig {
  const info: Record<string, AndroidLocaleInfo> = {};
  for (const locale of localeDirs(dir)) {
    const localeDir = join(dir, locale);
    const localeInfo = compact({
      title: readField(localeDir, ANDROID_FILES.title),
      shortDescription: readField(localeDir, ANDROID_FILES.shortDescription),
      fullDescription: readField(localeDir, ANDROID_FILES.fullDescription),
      video: readField(localeDir, ANDROID_FILES.video),
    });
    if (Object.keys(localeInfo).length > 0) info[locale] = localeInfo;
  }
  return { info };
}

/** Serialize a {@link StoreConfig} to pretty JSON (the on-disk `store.config.json` form). */
export function serializeStoreConfig(config: StoreConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
