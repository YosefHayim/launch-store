import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect, Schema } from 'effect';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigFailure,
} from './surfaceConfig.js';

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
const APPLE_FILES = [
  { field: 'title', fileName: APPLE_FILE_NAMES.title },
  { field: 'subtitle', fileName: APPLE_FILE_NAMES.subtitle },
  { field: 'description', fileName: APPLE_FILE_NAMES.description },
  { field: 'releaseNotes', fileName: APPLE_FILE_NAMES.releaseNotes },
  { field: 'promotionalText', fileName: APPLE_FILE_NAMES.promotionalText },
  { field: 'marketingUrl', fileName: APPLE_FILE_NAMES.marketingUrl },
  { field: 'supportUrl', fileName: APPLE_FILE_NAMES.supportUrl },
  { field: 'privacyPolicyUrl', fileName: APPLE_FILE_NAMES.privacyPolicyUrl },
] as const;
/** `deliver` stores keywords comma-joined in their own file. */
const APPLE_KEYWORDS_FILE = 'keywords.txt';
const ANDROID_FILE_NAMES = {
  title: 'title.txt',
  shortDescription: 'short_description.txt',
  fullDescription: 'full_description.txt',
  video: 'video.txt',
} as const;
const ANDROID_FILES = [
  { field: 'title', fileName: ANDROID_FILE_NAMES.title },
  { field: 'shortDescription', fileName: ANDROID_FILE_NAMES.shortDescription },
  { field: 'fullDescription', fileName: ANDROID_FILE_NAMES.fullDescription },
  { field: 'video', fileName: ANDROID_FILE_NAMES.video },
] as const;

const AppleLocaleInfoSchema = Schema.mutable(
  Schema.Struct({
    title: Schema.optionalWith(Schema.String, { exact: true }),
    subtitle: Schema.optionalWith(Schema.String, { exact: true }),
    description: Schema.optionalWith(Schema.String, { exact: true }),
    keywords: Schema.optionalWith(Schema.mutable(Schema.Array(Schema.String)), { exact: true }),
    releaseNotes: Schema.optionalWith(Schema.String, { exact: true }),
    promotionalText: Schema.optionalWith(Schema.String, { exact: true }),
    marketingUrl: Schema.optionalWith(Schema.String, { exact: true }),
    supportUrl: Schema.optionalWith(Schema.String, { exact: true }),
    privacyPolicyUrl: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

const AndroidLocaleInfoSchema = Schema.mutable(
  Schema.Struct({
    title: Schema.optionalWith(Schema.String, { exact: true }),
    shortDescription: Schema.optionalWith(Schema.String, { exact: true }),
    fullDescription: Schema.optionalWith(Schema.String, { exact: true }),
    video: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

const AppleStoreConfigSchema = Schema.mutable(
  Schema.Struct({
    info: Schema.mutable(Schema.Record({ key: Schema.String, value: AppleLocaleInfoSchema })),
    categories: Schema.optionalWith(Schema.mutable(Schema.Array(Schema.String)), { exact: true }),
  }),
);

const AndroidStoreConfigSchema = Schema.mutable(
  Schema.Struct({
    info: Schema.mutable(Schema.Record({ key: Schema.String, value: AndroidLocaleInfoSchema })),
  }),
);

export const StoreConfigSchema = Schema.mutable(
  Schema.Struct({
    configVersion: Schema.optionalWith(Schema.Number, { exact: true }),
    apple: Schema.optionalWith(AppleStoreConfigSchema, { exact: true }),
    android: Schema.optionalWith(AndroidStoreConfigSchema, { exact: true }),
  }),
).pipe(
  Schema.filter((storeConfig) => {
    if (storeConfig.apple !== undefined) return true;
    if (storeConfig.android !== undefined) return true;
    return 'store.config.json has neither an "apple" nor an "android" section - nothing to push.';
  }),
);

const StoreConfigSpec = {
  documentName: 'store.config.json',
  displayName: 'store config',
  missingMessage: (configPath: string) =>
    `No store.config.json at ${configPath}. Run \`launch metadata pull\` to create one.`,
  schema: StoreConfigSchema,
};

/** Decode an untrusted store.config.json document. */
export const parseStoreConfig = (
  rawDocument: unknown,
): Effect.Effect<StoreConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, StoreConfigSpec);

/** Read and decode store.config.json through Effect Platform. */
export const loadStoreConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, StoreConfigSpec);
/**
 * Write `apple` listing text into fastlane `deliver`'s metadata layout under `dir` (one folder per
 * locale, one `.txt` file per field), returning the relative file paths written. The inverse of
 * {@link readAppleMetadataDir}; used by `launch metadata push` to feed `deliver --metadata_path`.
 */
export const writeAppleMetadataDir = (
  appleStoreConfig: AppleStoreConfig,
  metadataDirectory: string,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const writtenPaths: string[] = [];
    for (const [locale, localeListing] of Object.entries(appleStoreConfig.info)) {
      const localeDirectory = pathService.join(metadataDirectory, locale);
      yield* fileSystem.makeDirectory(localeDirectory, { recursive: true });
      for (const fieldMapping of APPLE_FILES) {
        const fieldText = localeListing[fieldMapping.field];
        if (fieldText === undefined) continue;
        yield* fileSystem.writeFileString(
          pathService.join(localeDirectory, fieldMapping.fileName),
          fieldText,
        );
        writtenPaths.push(pathService.join(locale, fieldMapping.fileName));
      }
      if (localeListing.keywords !== undefined && localeListing.keywords.length > 0) {
        yield* fileSystem.writeFileString(
          pathService.join(localeDirectory, APPLE_KEYWORDS_FILE),
          localeListing.keywords.join(', '),
        );
        writtenPaths.push(pathService.join(locale, APPLE_KEYWORDS_FILE));
      }
    }
    return writtenPaths;
  });
/**
 * Write `android` listing text into fastlane `supply`'s metadata layout under `dir`. The inverse of
 * {@link readAndroidMetadataDir}; used by `launch metadata push` to feed `supply --metadata_path`.
 */
export const writeAndroidMetadataDir = (
  androidStoreConfig: AndroidStoreConfig,
  metadataDirectory: string,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const writtenPaths: string[] = [];
    for (const [locale, localeListing] of Object.entries(androidStoreConfig.info)) {
      const localeDirectory = pathService.join(metadataDirectory, locale);
      yield* fileSystem.makeDirectory(localeDirectory, { recursive: true });
      for (const fieldMapping of ANDROID_FILES) {
        const fieldText = localeListing[fieldMapping.field];
        if (fieldText === undefined) continue;
        yield* fileSystem.writeFileString(
          pathService.join(localeDirectory, fieldMapping.fileName),
          fieldText,
        );
        writtenPaths.push(pathService.join(locale, fieldMapping.fileName));
      }
    }
    return writtenPaths;
  });
/** Read a single metadata `.txt` file, returning undefined when it's absent or blank. */
const readMetadataField = (
  localeDirectory: string,
  fileName: string,
): Effect.Effect<string | undefined, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const fieldPath = pathService.join(localeDirectory, fileName);
    if (!(yield* fileSystem.exists(fieldPath))) return undefined;
    const fieldText = (yield* fileSystem.readFileString(fieldPath)).trim();
    if (fieldText.length === 0) return undefined;
    return fieldText;
  });
/** List the immediate subdirectories of `dir` (the per-locale folders), or [] when `dir` is absent. */
const listLocaleDirectories = (
  metadataDirectory: string,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    if (!(yield* fileSystem.exists(metadataDirectory))) return [];
    const entryNames = yield* fileSystem.readDirectory(metadataDirectory);
    const localeDirectories: string[] = [];
    for (const entryName of entryNames) {
      const entryPath = pathService.join(metadataDirectory, entryName);
      if ((yield* fileSystem.stat(entryPath)).type === 'Directory') {
        localeDirectories.push(entryName);
      }
    }
    return localeDirectories;
  });
/**
 * Read fastlane `deliver` metadata folders under `dir` back into an {@link AppleStoreConfig}. The
 * inverse of {@link writeAppleMetadataDir}; used by `launch metadata pull` after `deliver` downloads
 * the live listing.
 */
export const readAppleMetadataDir = (
  metadataDirectory: string,
): Effect.Effect<AppleStoreConfig, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const localeInfoByName: Record<string, AppleLocaleInfo> = {};
    const localeNames = yield* listLocaleDirectories(metadataDirectory);
    for (const localeName of localeNames) {
      const localeDirectory = pathService.join(metadataDirectory, localeName);
      const metadataFields = yield* Effect.all(
        {
          title: readMetadataField(localeDirectory, APPLE_FILE_NAMES.title),
          subtitle: readMetadataField(localeDirectory, APPLE_FILE_NAMES.subtitle),
          description: readMetadataField(localeDirectory, APPLE_FILE_NAMES.description),
          keywords: readMetadataField(localeDirectory, APPLE_KEYWORDS_FILE),
          releaseNotes: readMetadataField(localeDirectory, APPLE_FILE_NAMES.releaseNotes),
          promotionalText: readMetadataField(localeDirectory, APPLE_FILE_NAMES.promotionalText),
          marketingUrl: readMetadataField(localeDirectory, APPLE_FILE_NAMES.marketingUrl),
          supportUrl: readMetadataField(localeDirectory, APPLE_FILE_NAMES.supportUrl),
          privacyPolicyUrl: readMetadataField(localeDirectory, APPLE_FILE_NAMES.privacyPolicyUrl),
        },
        { concurrency: 'unbounded' },
      );
      let keywords: string[] | undefined;
      if (metadataFields.keywords !== undefined) {
        keywords = metadataFields.keywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter((keyword) => keyword.length > 0);
      }
      const localeListing: AppleLocaleInfo = {};
      if (metadataFields.title !== undefined) localeListing.title = metadataFields.title;
      if (metadataFields.subtitle !== undefined) localeListing.subtitle = metadataFields.subtitle;
      if (metadataFields.description !== undefined) {
        localeListing.description = metadataFields.description;
      }
      if (keywords !== undefined && keywords.length > 0) localeListing.keywords = keywords;
      if (metadataFields.releaseNotes !== undefined) {
        localeListing.releaseNotes = metadataFields.releaseNotes;
      }
      if (metadataFields.promotionalText !== undefined) {
        localeListing.promotionalText = metadataFields.promotionalText;
      }
      if (metadataFields.marketingUrl !== undefined) {
        localeListing.marketingUrl = metadataFields.marketingUrl;
      }
      if (metadataFields.supportUrl !== undefined) {
        localeListing.supportUrl = metadataFields.supportUrl;
      }
      if (metadataFields.privacyPolicyUrl !== undefined) {
        localeListing.privacyPolicyUrl = metadataFields.privacyPolicyUrl;
      }
      if (Object.keys(localeListing).length > 0) localeInfoByName[localeName] = localeListing;
    }
    return { info: localeInfoByName };
  });
/** Read fastlane `supply` metadata folders under `dir` back into an {@link AndroidStoreConfig}. */
export const readAndroidMetadataDir = (
  metadataDirectory: string,
): Effect.Effect<AndroidStoreConfig, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const localeInfoByName: Record<string, AndroidLocaleInfo> = {};
    const localeNames = yield* listLocaleDirectories(metadataDirectory);
    for (const localeName of localeNames) {
      const localeDirectory = pathService.join(metadataDirectory, localeName);
      const metadataFields = yield* Effect.all(
        {
          title: readMetadataField(localeDirectory, ANDROID_FILE_NAMES.title),
          shortDescription: readMetadataField(localeDirectory, ANDROID_FILE_NAMES.shortDescription),
          fullDescription: readMetadataField(localeDirectory, ANDROID_FILE_NAMES.fullDescription),
          video: readMetadataField(localeDirectory, ANDROID_FILE_NAMES.video),
        },
        { concurrency: 'unbounded' },
      );
      const localeListing: AndroidLocaleInfo = {};
      if (metadataFields.title !== undefined) localeListing.title = metadataFields.title;
      if (metadataFields.shortDescription !== undefined) {
        localeListing.shortDescription = metadataFields.shortDescription;
      }
      if (metadataFields.fullDescription !== undefined) {
        localeListing.fullDescription = metadataFields.fullDescription;
      }
      if (metadataFields.video !== undefined) localeListing.video = metadataFields.video;
      if (Object.keys(localeListing).length > 0) localeInfoByName[localeName] = localeListing;
    }
    return { info: localeInfoByName };
  });
/** Serialize a {@link StoreConfig} to pretty JSON (the on-disk `store.config.json` form). */
export const serializeStoreConfig = (config: StoreConfig): string => {
  return `${JSON.stringify(config, null, 2)}\n`;
};
