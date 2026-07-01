/**
 * Pure parsers that read an app's privacy surface from its files or Expo config into a
 * {@link PrivacySurface}. Two sources feed the same shape: native files for a prebuilt/bare project
 * (`Info.plist`, `PrivacyInfo.xcprivacy`, `AndroidManifest.xml`) and the resolved Expo config for a
 * managed one (`ios.infoPlist`, `ios.privacyManifests`, `android.permissions`).
 *
 * Plist/XML is read with focused regexes (not a parser dependency), mirroring the provisioning-profile
 * reader in `apple/credentials.ts` — the keys we need are flat and well-known, so a full XML parse would
 * be over-engineering. Everything here is string-in / data-out, so the reconcile stays unit-testable.
 */

import { asRecord } from '../json.js';
import type { PrivacySurface } from '../types.js';

/** `<key>NS…UsageDescription</key>` with its `<string>` value — captures empty and self-closing values too. */
const USAGE_DESCRIPTION_RE =
  /<key>(NS\w*UsageDescription)<\/key>\s*(?:<string>([^<]*)<\/string>|<string\s*\/>)/g;

/** De-duplicate while preserving first-seen order. */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Collect every `<string>…</string>` inside an XML fragment. */
function stringTags(xml: string): string[] {
  return [...xml.matchAll(/<string>([^<]+)<\/string>/g)]
    .map((match) => match[1])
    .filter((v): v is string => Boolean(v));
}

/** Parse `NS*UsageDescription` keys (and their purpose strings) out of an `Info.plist`. */
export function parseUsageDescriptions(plistXml: string): Record<string, string> {
  const usage: Record<string, string> = {};
  for (const match of plistXml.matchAll(USAGE_DESCRIPTION_RE)) {
    const [, key, value] = match;
    if (key) usage[key] = (value ?? '').trim();
  }
  return usage;
}

/** Parse the data types, tracking flag, and tracking domains out of a `PrivacyInfo.xcprivacy`. */
export function parsePrivacyManifest(xml: string): {
  collectedDataTypes: string[];
  tracking: boolean;
  trackingDomains: string[];
} {
  const collectedDataTypes = [
    ...xml.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/g),
  ]
    .map((match) => match[1])
    .filter((v): v is string => Boolean(v));
  const tracking = /<key>NSPrivacyTracking<\/key>\s*<true\s*\/>/.test(xml);
  const domainsBlock = /<key>NSPrivacyTrackingDomains<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
    xml,
  )?.[1];
  return {
    collectedDataTypes: unique(collectedDataTypes),
    tracking,
    trackingDomains: domainsBlock ? unique(stringTags(domainsBlock)) : [],
  };
}

/** Parse `<uses-permission android:name="…">` names out of an `AndroidManifest.xml`. */
export function parseAndroidPermissions(manifestXml: string): string[] {
  return unique(
    [...manifestXml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((v): v is string => Boolean(v)),
  );
}

/** Read a string-array field, dropping non-strings; `[]` when absent or the wrong type. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Pull the `NSPrivacyCollectedDataType` id out of each entry of an `NSPrivacyCollectedDataTypes` array. */
function collectedDataTypesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const types: string[] = [];
  for (const entry of value) {
    const type = asRecord(entry)?.['NSPrivacyCollectedDataType'];
    if (typeof type === 'string') types.push(type);
  }
  return unique(types);
}

/**
 * Build a surface from native files. Usage descriptions union across all `Info.plist`s; the manifest
 * fields union across all `.xcprivacy`s (tracking is true if any manifest enables it). `hasManifest`
 * reflects whether any privacy manifest was found at all.
 */
export function surfaceFromNative(files: {
  infoPlists: string[];
  privacyManifests: string[];
  androidManifests: string[];
}): PrivacySurface {
  const usageDescriptions: Record<string, string> = {};
  for (const xml of files.infoPlists) Object.assign(usageDescriptions, parseUsageDescriptions(xml));

  const collectedDataTypes: string[] = [];
  const trackingDomains: string[] = [];
  let tracking = false;
  for (const xml of files.privacyManifests) {
    const parsed = parsePrivacyManifest(xml);
    collectedDataTypes.push(...parsed.collectedDataTypes);
    trackingDomains.push(...parsed.trackingDomains);
    tracking = tracking || parsed.tracking;
  }

  const androidPermissions: string[] = [];
  for (const xml of files.androidManifests)
    androidPermissions.push(...parseAndroidPermissions(xml));

  return {
    usageDescriptions,
    hasManifest: files.privacyManifests.length > 0,
    collectedDataTypes: unique(collectedDataTypes),
    tracking,
    trackingDomains: unique(trackingDomains),
    androidPermissions: unique(androidPermissions),
  };
}

/**
 * Build a surface from a resolved Expo config — the managed-workflow source, read before `expo prebuild`
 * has generated any native files. Reads usage strings from `ios.infoPlist`, the manifest from
 * `ios.privacyManifests`, and permissions from `android.permissions`.
 */
export function surfaceFromExpoConfig(config: Record<string, unknown>): PrivacySurface {
  const expo = asRecord(config['expo']) ?? config;
  const ios = asRecord(expo['ios']) ?? {};
  const android = asRecord(expo['android']) ?? {};

  const usageDescriptions: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(ios['infoPlist']) ?? {})) {
    if (/^NS\w*UsageDescription$/.test(key) && typeof value === 'string')
      usageDescriptions[key] = value.trim();
  }

  const manifests = asRecord(ios['privacyManifests']);
  return {
    usageDescriptions,
    hasManifest: manifests !== null,
    collectedDataTypes: manifests
      ? collectedDataTypesFrom(manifests['NSPrivacyCollectedDataTypes'])
      : [],
    tracking: manifests?.['NSPrivacyTracking'] === true,
    trackingDomains: manifests ? unique(stringArray(manifests['NSPrivacyTrackingDomains'])) : [],
    androidPermissions: unique(stringArray(android['permissions'])),
  };
}
