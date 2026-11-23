import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '@/path-exists.js';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigSpec,
} from './surface-config.ts';
import { readPlainObject } from '@/services/platform/plain-object.js';

/** App Store and Play listing metadata. */
export type StoreConfig = {
  configVersion?: number;
  apple?: AppleStoreConfig;
  android?: AndroidStoreConfig;
};

/** The App Store listing: per-locale text plus app-level category ids. */
export type AppleStoreConfig = {
  info: Record<string, AppleLocaleInfo>;
  categories?: string[];
};

/** One locale's App Store listing text. Every field is optional - only what's present is pushed. */
export type AppleLocaleInfo = {
  title?: string;
  subtitle?: string;
  description?: string;
  keywords?: string[];
  releaseNotes?: string;
  promotionalText?: string;
  marketingUrl?: string;
  supportUrl?: string;
  privacyPolicyUrl?: string;
};

/** The Play Store listing (Launch's extension; no EAS equivalent): per-locale text. */
export type AndroidStoreConfig = {
  info: Record<string, AndroidLocaleInfo>;
};

/** One locale's Play Store listing text. */
export type AndroidLocaleInfo = {
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
  video?: string;
};

const APPLE_FILE_NAMES = {
  title: 'name.txt',
  subtitle: 'subtitle.txt',
  description: 'description.txt',
  releaseNotes: 'release_notes.txt',
  promotionalText: 'promotional_text.txt',
  marketingUrl: 'marketing_url.txt',
  supportUrl: 'support_url.txt',
  privacyPolicyUrl: 'privacy_url.txt',
} as const;

const ANDROID_FILE_NAMES = {
  title: 'title.txt',
  shortDescription: 'short_description.txt',
  fullDescription: 'full_description.txt',
  video: 'video.txt',
} as const;

function readOptionalString(record: Record<string, unknown>, fieldName: string): string | null {
  if (fieldName in record == false) {
    return null;
  }

  const field = record[fieldName];

  if (field == null) {
    return null;
  }

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function readOptionalStringList(
  record: Record<string, unknown>,
  fieldName: string,
): string[] | null {
  if (fieldName in record == false) {
    return null;
  }

  const field = record[fieldName];

  if (field == null) {
    return null;
  }

  if (Array.isArray(field) == false) {
    throw new Error(`${fieldName} must be an array of strings`);
  }

  for (const entry of field) {
    if (typeof entry != 'string') {
      throw new Error(`${fieldName} must be an array of strings`);
    }
  }

  return field;
}

function readAppleLocale(localeDocument: unknown): AppleLocaleInfo {
  const localeDocumentObject = readPlainObject(localeDocument);

  if (localeDocumentObject == null) {
    throw new Error('apple info locale must be an object');
  }

  const localeListing: AppleLocaleInfo = {};
  const title = readOptionalString(localeDocumentObject, 'title');
  const subtitle = readOptionalString(localeDocumentObject, 'subtitle');
  const description = readOptionalString(localeDocumentObject, 'description');
  const keywords = readOptionalStringList(localeDocumentObject, 'keywords');
  const releaseNotes = readOptionalString(localeDocumentObject, 'releaseNotes');
  const promotionalText = readOptionalString(localeDocumentObject, 'promotionalText');
  const marketingUrl = readOptionalString(localeDocumentObject, 'marketingUrl');
  const supportUrl = readOptionalString(localeDocumentObject, 'supportUrl');
  const privacyPolicyUrl = readOptionalString(localeDocumentObject, 'privacyPolicyUrl');

  if (title != null) {
    localeListing.title = title;
  }

  if (subtitle != null) {
    localeListing.subtitle = subtitle;
  }

  if (description != null) {
    localeListing.description = description;
  }

  if (keywords != null) {
    localeListing.keywords = keywords;
  }

  if (releaseNotes != null) {
    localeListing.releaseNotes = releaseNotes;
  }

  if (promotionalText != null) {
    localeListing.promotionalText = promotionalText;
  }

  if (marketingUrl != null) {
    localeListing.marketingUrl = marketingUrl;
  }

  if (supportUrl != null) {
    localeListing.supportUrl = supportUrl;
  }

  if (privacyPolicyUrl != null) {
    localeListing.privacyPolicyUrl = privacyPolicyUrl;
  }

  return localeListing;
}

function readAndroidLocale(localeDocument: unknown): AndroidLocaleInfo {
  const localeDocumentObject = readPlainObject(localeDocument);

  if (localeDocumentObject == null) {
    throw new Error('android info locale must be an object');
  }

  const localeListing: AndroidLocaleInfo = {};
  const title = readOptionalString(localeDocumentObject, 'title');
  const shortDescription = readOptionalString(localeDocumentObject, 'shortDescription');
  const fullDescription = readOptionalString(localeDocumentObject, 'fullDescription');
  const video = readOptionalString(localeDocumentObject, 'video');

  if (title != null) {
    localeListing.title = title;
  }

  if (shortDescription != null) {
    localeListing.shortDescription = shortDescription;
  }

  if (fullDescription != null) {
    localeListing.fullDescription = fullDescription;
  }

  if (video != null) {
    localeListing.video = video;
  }

  return localeListing;
}

function readLocaleMap<Locale>(
  record: Record<string, unknown>,
  fieldName: string,
  readLocale: (localeDocument: unknown) => Locale,
): Record<string, Locale> {
  const field = record[fieldName];

  const fieldObject = readPlainObject(field);

  if (fieldObject == null) {
    throw new Error(`${fieldName} must be an object`);
  }

  const locales: Record<string, Locale> = {};

  for (const [localeName, localeDocument] of Object.entries(fieldObject)) {
    locales[localeName] = readLocale(localeDocument);
  }

  return locales;
}

function readAppleConfig(document: unknown): AppleStoreConfig {
  const documentObject = readPlainObject(document);

  if (documentObject == null) {
    throw new Error('apple must be an object');
  }

  const apple: AppleStoreConfig = {
    info: readLocaleMap(documentObject, 'info', readAppleLocale),
  };
  const categories = readOptionalStringList(documentObject, 'categories');

  if (categories != null) {
    apple.categories = categories;
  }

  return apple;
}

function readAndroidConfig(document: unknown): AndroidStoreConfig {
  const documentObject = readPlainObject(document);

  if (documentObject == null) {
    throw new Error('android must be an object');
  }

  return {
    info: readLocaleMap(documentObject, 'info', readAndroidLocale),
  };
}

function decodeStoreConfigFields(rawDocument: unknown): StoreConfig {
  const rawDocumentObject = readPlainObject(rawDocument);

  if (rawDocumentObject == null) {
    throw new Error('store.config.json must be a JSON object.');
  }

  const storeConfig: StoreConfig = {};

  if ('configVersion' in rawDocumentObject) {
    const configVersion = rawDocumentObject['configVersion'];

    if (configVersion != null) {
      if (typeof configVersion != 'number') {
        throw new Error('configVersion must be a number');
      }

      storeConfig.configVersion = configVersion;
    }
  }

  if ('apple' in rawDocumentObject) {
    const apple = rawDocumentObject['apple'];

    if (apple != null) {
      storeConfig.apple = readAppleConfig(apple);
    }
  }

  if ('android' in rawDocumentObject) {
    const android = rawDocumentObject['android'];

    if (android != null) {
      storeConfig.android = readAndroidConfig(android);
    }
  }

  if (storeConfig.apple != null) {
    return storeConfig;
  }

  if (storeConfig.android != null) {
    return storeConfig;
  }

  throw new Error(
    'store.config.json has neither an "apple" nor an "android" section - nothing to push.',
  );
}

function storeConfigSpec(): StoreSurfaceConfigSpec<StoreConfig> {
  return {
    documentName: 'store.config.json',
    displayName: 'store config',
    missingMessage(configPath: string) {
      return `No store.config.json at ${configPath}. Run \`launch-store metadata pull\` to create one.`;
    },
    decodeDocument: decodeStoreConfigFields,
  };
}

/** Decode an untrusted store.config.json document. */
export function parseStoreConfig(rawDocument: unknown): StoreConfig {
  const storeSpec = storeConfigSpec();
  return decodeStoreSurfaceConfig(rawDocument, storeSpec);
}

/** Read and decode store.config.json. */
export function loadStoreConfig(configPath: string): Promise<StoreConfig> {
  const storeSpec = storeConfigSpec();
  return loadStoreSurfaceConfig(configPath, storeSpec);
}

/** Read a single metadata `.txt` file, returning undefined when it's absent or blank. */
async function readMetadataField(
  localeDirectory: string,
  fileName: string,
): Promise<string | undefined> {
  const fieldPath = join(localeDirectory, fileName);
  const fieldExists = await pathExists(fieldPath);

  if (fieldExists == false) {
    return undefined;
  }

  const fieldText = (await readFile(fieldPath, 'utf8')).trim();

  if (fieldText.length == 0) {
    return undefined;
  }

  return fieldText;
}

/** List the immediate subdirectories of `dir` (the per-locale folders), or [] when `dir` is absent. */
async function listLocaleDirectories(metadataDirectory: string): Promise<string[]> {
  const directoryExists = await pathExists(metadataDirectory);

  if (directoryExists == false) {
    return [];
  }

  const entryNames = await readdir(metadataDirectory);
  const localeDirectories: string[] = [];

  for (const entryName of entryNames) {
    const entryPath = join(metadataDirectory, entryName);
    const entryStat = await stat(entryPath);

    if (entryStat.isDirectory()) {
      localeDirectories.push(entryName);
    }
  }

  return localeDirectories;
}

/** Read fastlane `deliver` metadata folders under `dir` back into an {@link AppleStoreConfig}. */
export async function readAppleMetadataDir(metadataDirectory: string): Promise<AppleStoreConfig> {
  const localeInfoByName: Record<string, AppleLocaleInfo> = {};
  const localeNames = await listLocaleDirectories(metadataDirectory);

  for (const localeName of localeNames) {
    const localeDirectory = join(metadataDirectory, localeName);
    const titlePromise = readMetadataField(localeDirectory, APPLE_FILE_NAMES.title);
    const subtitlePromise = readMetadataField(localeDirectory, APPLE_FILE_NAMES.subtitle);
    const descriptionPromise = readMetadataField(localeDirectory, APPLE_FILE_NAMES.description);
    const keywordsPromise = readMetadataField(localeDirectory, 'keywords.txt');
    const releaseNotesPromise = readMetadataField(localeDirectory, APPLE_FILE_NAMES.releaseNotes);
    const promotionalTextPromise = readMetadataField(
      localeDirectory,
      APPLE_FILE_NAMES.promotionalText,
    );
    const marketingUrlPromise = readMetadataField(localeDirectory, APPLE_FILE_NAMES.marketingUrl);
    const supportUrlPromise = readMetadataField(localeDirectory, APPLE_FILE_NAMES.supportUrl);
    const privacyPolicyUrlPromise = readMetadataField(
      localeDirectory,
      APPLE_FILE_NAMES.privacyPolicyUrl,
    );
    const title = await titlePromise;
    const subtitle = await subtitlePromise;
    const description = await descriptionPromise;
    const keywordsText = await keywordsPromise;
    const releaseNotes = await releaseNotesPromise;
    const promotionalText = await promotionalTextPromise;
    const marketingUrl = await marketingUrlPromise;
    const supportUrl = await supportUrlPromise;
    const privacyPolicyUrl = await privacyPolicyUrlPromise;
    let keywords: string[] | undefined;

    if (keywordsText != null) {
      keywords = keywordsText
        .split(',')
        .map(function trimKeyword(keyword: string) {
          return keyword.trim();
        })
        .filter(function isKeyword(keyword: string) {
          return keyword.length > 0;
        });
    }

    const localeListing: AppleLocaleInfo = {};

    if (title != null) {
      localeListing.title = title;
    }

    if (subtitle != null) {
      localeListing.subtitle = subtitle;
    }

    if (description != null) {
      localeListing.description = description;
    }

    if (keywords != null) {
      const hasKeywords = keywords.length > 0;

      if (hasKeywords) {
        localeListing.keywords = keywords;
      }
    }

    if (releaseNotes != null) {
      localeListing.releaseNotes = releaseNotes;
    }

    if (promotionalText != null) {
      localeListing.promotionalText = promotionalText;
    }

    if (marketingUrl != null) {
      localeListing.marketingUrl = marketingUrl;
    }

    if (supportUrl != null) {
      localeListing.supportUrl = supportUrl;
    }

    if (privacyPolicyUrl != null) {
      localeListing.privacyPolicyUrl = privacyPolicyUrl;
    }

    if (Object.keys(localeListing).length > 0) {
      localeInfoByName[localeName] = localeListing;
    }
  }

  return { info: localeInfoByName };
}

/** Read fastlane `supply` metadata folders under `dir` back into an {@link AndroidStoreConfig}. */
export async function readAndroidMetadataDir(
  metadataDirectory: string,
): Promise<AndroidStoreConfig> {
  const localeInfoByName: Record<string, AndroidLocaleInfo> = {};
  const localeNames = await listLocaleDirectories(metadataDirectory);

  for (const localeName of localeNames) {
    const localeDirectory = join(metadataDirectory, localeName);
    const titlePromise = readMetadataField(localeDirectory, ANDROID_FILE_NAMES.title);
    const shortDescriptionPromise = readMetadataField(
      localeDirectory,
      ANDROID_FILE_NAMES.shortDescription,
    );
    const fullDescriptionPromise = readMetadataField(
      localeDirectory,
      ANDROID_FILE_NAMES.fullDescription,
    );
    const videoPromise = readMetadataField(localeDirectory, ANDROID_FILE_NAMES.video);
    const title = await titlePromise;
    const shortDescription = await shortDescriptionPromise;
    const fullDescription = await fullDescriptionPromise;
    const video = await videoPromise;
    const localeListing: AndroidLocaleInfo = {};

    if (title != null) {
      localeListing.title = title;
    }

    if (shortDescription != null) {
      localeListing.shortDescription = shortDescription;
    }

    if (fullDescription != null) {
      localeListing.fullDescription = fullDescription;
    }

    if (video != null) {
      localeListing.video = video;
    }

    if (Object.keys(localeListing).length > 0) {
      localeInfoByName[localeName] = localeListing;
    }
  }

  return { info: localeInfoByName };
}

/** Serialize a {@link StoreConfig} to pretty JSON (the on-disk `store.config.json` form). */
export function serializeStoreConfig(config: StoreConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
