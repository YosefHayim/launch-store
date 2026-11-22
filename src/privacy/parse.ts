import type { PrivacySurface } from '../types/privacy.ts';

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  const isObject = typeof candidate == 'object';

  if (isObject == false) {
    return false;
  }

  if (candidate == null) {
    return false;
  }

  const isArray = Array.isArray(candidate);

  if (isArray) {
    return false;
  }

  return true;
}

function recordOrNull(candidate: unknown): Record<string, unknown> | null {
  const isRecordValue = isRecord(candidate);

  if (isRecordValue) {
    return candidate;
  }

  return null;
}

function readCollectedDataType(entry: unknown): string | null {
  const record = recordOrNull(entry);

  if (record == null) {
    return null;
  }

  const dataType = record['NSPrivacyCollectedDataType'];
  const isString = typeof dataType == 'string';

  if (isString == false) {
    return null;
  }

  return dataType;
}
/** `<key>NS...UsageDescription</key>` with its `<string>` value - captures empty and self-closing values too. */
const USAGE_DESCRIPTION_RE =
  /<key>(NS\w*UsageDescription)<\/key>\s*(?:<string>([^<]*)<\/string>|<string\s*\/>)/g;
/** De-duplicate while preserving first-seen order. */
const unique = (strings: readonly string[]): string[] => {
  return [...new Set(strings)];
};
/** Collect every `<string>...</string>` inside an XML fragment. */
const stringTags = (xml: string): string[] => {
  return [...xml.matchAll(/<string>([^<]+)<\/string>/g)]
    .map((match) => match[1])
    .filter((v): v is string => Boolean(v));
};
/** Parse `NS*UsageDescription` keys (and their purpose strings) out of an `Info.plist`. */
export const parseUsageDescriptions = (plistXml: string): Record<string, string> => {
  const usage: Record<string, string> = {};
  for (const match of plistXml.matchAll(USAGE_DESCRIPTION_RE)) {
    const [, key, purposeText] = match;
    if (key) {
      let purpose = purposeText;
      if (purpose === undefined) purpose = '';
      usage[key] = purpose.trim();
    }
  }
  return usage;
};
/** Parse the data types, tracking flag, and tracking domains out of a `PrivacyInfo.xcprivacy`. */
export const parsePrivacyManifest = (
  xml: string,
): {
  collectedDataTypes: string[];
  tracking: boolean;
  trackingDomains: string[];
} => {
  const collectedDataTypes = [
    ...xml.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/g),
  ]
    .map((match) => match[1])
    .filter((v): v is string => Boolean(v));
  const tracking = /<key>NSPrivacyTracking<\/key>\s*<true\s*\/>/.test(xml);
  const domainsBlock = /<key>NSPrivacyTrackingDomains<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
    xml,
  )?.[1];
  let trackingDomains: string[] = [];
  if (domainsBlock) trackingDomains = unique(stringTags(domainsBlock));
  return {
    collectedDataTypes: unique(collectedDataTypes),
    tracking,
    trackingDomains,
  };
};
/** Parse `<uses-permission android:name="...">` names out of an `AndroidManifest.xml`. */
export const parseAndroidPermissions = (manifestXml: string): string[] => {
  return unique(
    [...manifestXml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((v): v is string => Boolean(v)),
  );
};
/** Read a string-array field, dropping non-strings; `[]` when absent or the wrong type. */
const stringArray = (unknownArray: unknown): string[] => {
  if (Array.isArray(unknownArray))
    return unknownArray.filter((entry): entry is string => typeof entry === 'string');
  return [];
};
/** Pull the `NSPrivacyCollectedDataType` id out of each entry of an `NSPrivacyCollectedDataTypes` array. */
const collectedDataTypesFrom = (manifestEntries: unknown): string[] => {
  if (!Array.isArray(manifestEntries)) return [];
  const types: string[] = [];
  for (const entry of manifestEntries) {
    const dataType = readCollectedDataType(entry);

    if (dataType != null) {
      types.push(dataType);
    }
  }
  return unique(types);
};
/**
 * Build a surface from native files. Usage descriptions union across all `Info.plist`s; the manifest
 * fields union across all `.xcprivacy`s (tracking is true if any manifest enables it). `hasManifest`
 * reflects whether any privacy manifest was found at all.
 */
export const surfaceFromNative = (files: {
  infoPlists: string[];
  privacyManifests: string[];
  androidManifests: string[];
}): PrivacySurface => {
  const usageDescriptions: Record<string, string> = {};
  for (const xml of files.infoPlists) Object.assign(usageDescriptions, parseUsageDescriptions(xml));
  const collectedDataTypes: string[] = [];
  const trackingDomains: string[] = [];
  let tracking = false;
  for (const xml of files.privacyManifests) {
    const parsed = parsePrivacyManifest(xml);
    collectedDataTypes.push(...parsed.collectedDataTypes);
    trackingDomains.push(...parsed.trackingDomains);
    if (parsed.tracking) tracking = true;
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
};
/**
 * Build a surface from a resolved Expo config - the managed-workflow source, read before `expo prebuild`
 * has generated any native files. Reads usage strings from `ios.infoPlist`, the manifest from
 * `ios.privacyManifests`, and permissions from `android.permissions`.
 */
export const surfaceFromExpoConfig = (config: Record<string, unknown>): PrivacySurface => {
  const decodedExpo = recordOrNull(config['expo']);
  let expo = config;

  if (decodedExpo != null) {
    expo = decodedExpo;
  }

  const decodedIos = recordOrNull(expo['ios']);
  const decodedAndroid = recordOrNull(expo['android']);
  let ios: Record<string, unknown> = {};

  if (decodedIos != null) {
    ios = decodedIos;
  }

  let android: Record<string, unknown> = {};

  if (decodedAndroid != null) {
    android = decodedAndroid;
  }

  const usageDescriptions: Record<string, string> = {};
  const infoPlist = recordOrNull(ios['infoPlist']) ?? {};

  for (const [privacyKey, privacyText] of Object.entries(infoPlist)) {
    // Apple purpose strings are keys like NSCameraUsageDescription
    const isUsageKey = /^NS\w*UsageDescription$/.test(privacyKey);
    const isUsageText = typeof privacyText == 'string';

    if (isUsageKey == false) {
      continue;
    }

    if (isUsageText == false) {
      continue;
    }

    usageDescriptions[privacyKey] = privacyText.trim();
  }

  const manifest = recordOrNull(ios['privacyManifests']);
  const hasManifest = manifest != null;
  let collectedDataTypes: string[] = [];
  let trackingDomains: string[] = [];

  if (hasManifest) {
    collectedDataTypes = collectedDataTypesFrom(manifest['NSPrivacyCollectedDataTypes']);
    trackingDomains = unique(stringArray(manifest['NSPrivacyTrackingDomains']));
  }

  return {
    usageDescriptions,
    hasManifest,
    collectedDataTypes,
    tracking: manifest?.['NSPrivacyTracking'] == true,
    trackingDomains,
    androidPermissions: unique(stringArray(android['permissions'])),
  };
};
