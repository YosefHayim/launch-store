import { FileSystem, type HttpClient, Path, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { readResolvedConfig, loadConfig } from '../config/config.js';
import { readLastApp } from '../distribution/lastRun.js';
import { errorMessage } from '../services/errorMessage.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { AndroidLocaleInfo, AppleLocaleInfo, StoreConfig } from '../store/storeConfig.js';
import type { AppDescriptor } from '../types/app.js';
import type { ListingGenerator, LocaleDraft } from '../types/listing.js';
import { applyDraft, briefFor, clampDraft, renderDraftPreview } from './apply.js';
import { createAnthropicListingGenerator } from './generator.js';

export const AiListingInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  locale: Schema.optionalWith(Schema.String, { exact: true }),
  about: Schema.optionalWith(Schema.String, { exact: true }),
  platform: Schema.optionalWith(Schema.String, { default: () => 'ios' }),
  model: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  yes: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export type AiListingInput = Schema.Schema.Type<typeof AiListingInputSchema>;

const optionalString = Schema.optionalWith(Schema.String, { exact: true });
const optionalStringArray = Schema.optionalWith(Schema.mutable(Schema.Array(Schema.String)), {
  exact: true,
});

const AppleLocaleInfoSchema: Schema.Schema<AppleLocaleInfo> = Schema.mutable(
  Schema.Struct({
    title: optionalString,
    subtitle: optionalString,
    description: optionalString,
    keywords: optionalStringArray,
    releaseNotes: optionalString,
    promotionalText: optionalString,
    marketingUrl: optionalString,
    supportUrl: optionalString,
    privacyPolicyUrl: optionalString,
  }),
);

const AndroidLocaleInfoSchema: Schema.Schema<AndroidLocaleInfo> = Schema.mutable(
  Schema.Struct({
    title: optionalString,
    shortDescription: optionalString,
    fullDescription: optionalString,
    video: optionalString,
  }),
);

const StoreConfigSchema: Schema.Schema<StoreConfig> = Schema.mutable(
  Schema.Struct({
    configVersion: Schema.optionalWith(Schema.Number, { exact: true }),
    apple: Schema.optionalWith(
      Schema.mutable(
        Schema.Struct({
          info: Schema.mutable(Schema.Record({ key: Schema.String, value: AppleLocaleInfoSchema })),
          categories: optionalStringArray,
        }),
      ),
      { exact: true },
    ),
    android: Schema.optionalWith(
      Schema.mutable(
        Schema.Struct({
          info: Schema.mutable(
            Schema.Record({ key: Schema.String, value: AndroidLocaleInfoSchema }),
          ),
        }),
      ),
      { exact: true },
    ),
  }),
);

const ResolvedDisplayNameSchema = Schema.Struct({
  name: Schema.optionalWith(Schema.String, { exact: true }),
  expo: Schema.optionalWith(
    Schema.Struct({ name: Schema.optionalWith(Schema.String, { exact: true }) }),
    { exact: true },
  ),
});

/** Listing drafting, preview, or persistence failed. */
export type AiListingFailure = Readonly<{
  readonly _tag: 'AiListingFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeAiListingFailure = Data.tagged<AiListingFailure>('AiListingFailure');

export const AiListingFailureSchema: Schema.Schema<AiListingFailure> = Schema.Struct({
  _tag: Schema.Literal('AiListingFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

type ListingTargets = Readonly<{ ios: boolean; android: boolean }>;

type AiListingRequirements =
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | Logger
  | Path.Path
  | Terminal.Terminal;

/** Normalize one listing command failure. */
const listingFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AiListingFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeAiListingFailure({ operation, message, cause });
};

/** Decode the requested store selector. */
export const parseListingTargets = (
  platformSelector: string,
): Effect.Effect<ListingTargets, AiListingFailure> => {
  switch (platformSelector) {
    case 'ios':
      return Effect.succeed({ ios: true, android: false });
    case 'android':
      return Effect.succeed({ ios: false, android: true });
    case 'all':
      return Effect.succeed({ ios: true, android: true });
    default:
      return Effect.fail(
        listingFailure(
          'select listing platforms',
          platformSelector,
          `Unknown platform "${platformSelector}". Use ios, android, or all.`,
        ),
      );
  }
};

/** Select one app without reading process state inside core. */
const selectListingApp = (
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Effect.Effect<
  AppDescriptor,
  AiListingFailure,
  FileSystem.FileSystem | LaunchPathsService | LaunchPromptService | Path.Path | Terminal.Terminal
> =>
  Effect.gen(function* () {
    if (discoveredApps.length === 0) {
      return yield* Effect.fail(
        listingFailure(
          'select app',
          discoveredApps,
          'No apps found. Run Launch from a repo containing at least one app.json.',
        ),
      );
    }
    if (appSelector !== undefined) {
      const selectedApp = discoveredApps.find(
        (discoveredApp) => discoveredApp.name === appSelector,
      );
      if (selectedApp !== undefined) return selectedApp;
      return yield* Effect.fail(
        listingFailure(
          'select app',
          appSelector,
          `App "${appSelector}" not found. Available: ${discoveredApps.map((discoveredApp) => discoveredApp.name).join(', ')}.`,
        ),
      );
    }
    const soleApp = discoveredApps[0];
    if (discoveredApps.length === 1 && soleApp !== undefined) return soleApp;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        listingFailure(
          'select app',
          discoveredApps,
          `Multiple apps found. Pass --app <name> to choose one: ${discoveredApps.map((discoveredApp) => discoveredApp.name).join(', ')}.`,
        ),
      );
    }
    const rememberedAppName = yield* readLastApp();
    const rememberedApp = discoveredApps.find(
      (discoveredApp) => discoveredApp.name === rememberedAppName,
    );
    const launchPrompt = yield* LaunchPrompt;
    const selectionRequest = {
      message: `Which app? (${discoveredApps.length} found)`,
      choices: discoveredApps.map((discoveredApp) => {
        let hint = discoveredApp.packageName;
        if (discoveredApp.bundleId !== undefined) hint = discoveredApp.bundleId;
        if (hint === undefined) return { selection: discoveredApp, label: discoveredApp.name };
        return { selection: discoveredApp, label: discoveredApp.name, hint };
      }),
    };
    if (rememberedApp !== undefined) {
      return yield* launchPrompt
        .select({ ...selectionRequest, initialSelection: rememberedApp })
        .pipe(Effect.mapError((cause) => listingFailure('select app', cause)));
    }
    return yield* launchPrompt
      .select(selectionRequest)
      .pipe(Effect.mapError((cause) => listingFailure('select app', cause)));
  });

/** Read the display name from resolved Expo configuration. */
const resolveDisplayName = (
  selectedApp: AppDescriptor,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const resolvedAppConfig = yield* readResolvedConfig(selectedApp.dir);
    if (resolvedAppConfig === null) return selectedApp.name;
    const decodedConfig = Schema.decodeUnknownEither(ResolvedDisplayNameSchema)(resolvedAppConfig);
    if (decodedConfig._tag === 'Left') return selectedApp.name;
    if (decodedConfig.right.expo !== undefined && decodedConfig.right.expo.name !== undefined)
      return decodedConfig.right.expo.name;
    if (decodedConfig.right.name !== undefined) return decodedConfig.right.name;
    return selectedApp.name;
  });

/** Decode an existing store config or start an empty listing. */
const readListingConfig = (
  configPath: string,
): Effect.Effect<StoreConfig, AiListingFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem
      .exists(configPath)
      .pipe(Effect.mapError((cause) => listingFailure('inspect listing config', cause)));
    if (!configExists) return {};
    const configText = yield* fileSystem
      .readFileString(configPath)
      .pipe(Effect.mapError((cause) => listingFailure('read listing config', cause)));
    return yield* Schema.decodeUnknown(Schema.parseJson(StoreConfigSchema))(configText).pipe(
      Effect.mapError((cause) => listingFailure('decode listing config', cause)),
    );
  });

/** Resolve explicit locales or reuse the current Apple listing locales. */
export const resolveListingLocales = (
  localeSelector: string | undefined,
  storeConfiguration: StoreConfig,
): Effect.Effect<string[], AiListingFailure> => {
  if (localeSelector !== undefined) {
    const requestedLocales = localeSelector
      .split(',')
      .map((localeName) => localeName.trim())
      .filter((localeName) => localeName.length > 0);
    if (requestedLocales.length > 0) return Effect.succeed(requestedLocales);
    return Effect.fail(
      listingFailure(
        'select listing locales',
        localeSelector,
        '--locale was empty. Pass locales like --locale en-US,fr-FR.',
      ),
    );
  }
  if (storeConfiguration.apple !== undefined) {
    const currentLocales = Object.keys(storeConfiguration.apple.info);
    if (currentLocales.length > 0) return Effect.succeed(currentLocales);
  }
  return Effect.succeed(['en-US']);
};

/** Draft, preview, and optionally write listing copy with an injected generator. */
export const runAiListing = <GeneratorRequirements>(
  commandInput: AiListingInput,
  listingGenerator: ListingGenerator<GeneratorRequirements>,
): Effect.Effect<
  void,
  AiListingFailure,
  | FileSystem.FileSystem
  | GeneratorRequirements
  | LaunchPathsService
  | LaunchPromptService
  | Logger
  | Path.Path
  | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;
    const logger = yield* createLogger(false);
    const listingTargets = yield* parseListingTargets(commandInput.platform);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApp = yield* selectListingApp(loadedConfiguration.apps, commandInput.app);
    const displayName = yield* resolveDisplayName(selectedApp);
    let configPath = pathService.join(selectedApp.dir, 'store.config.json');
    if (commandInput.config !== undefined) configPath = commandInput.config;
    const storeConfiguration = yield* readListingConfig(configPath);
    const locales = yield* resolveListingLocales(commandInput.locale, storeConfiguration);
    yield* logger.note(
      `Drafting ${locales.length} locale(s) for ${displayName} with ${listingGenerator.name}...`,
    );
    const localeDrafts = yield* Effect.forEach(
      locales,
      (localeName): Effect.Effect<LocaleDraft, unknown, GeneratorRequirements> =>
        Effect.gen(function* () {
          const currentListing = storeConfiguration.apple?.info[localeName];
          const generatedListing = yield* listingGenerator.generate(
            briefFor(localeName, displayName, currentListing, commandInput.about),
          );
          const clampedListing = clampDraft(generatedListing);
          return {
            locale: localeName,
            draft: clampedListing.draft,
            warnings: clampedListing.warnings,
          };
        }),
      { concurrency: 1 },
    );
    yield* logger.line(renderDraftPreview(localeDrafts, listingTargets));
    if (commandInput.dryRun) {
      yield* logger.note(
        'Dry run - nothing written. Drop --dry-run to save into store.config.json.',
      );
      return;
    }
    if (!commandInput.yes) {
      const terminal = yield* Terminal.Terminal;
      if (!(yield* terminal.isTTY)) {
        return yield* Effect.fail(
          listingFailure(
            'confirm listing write',
            'confirmation-required',
            'Refusing to write without confirmation. Re-run with --yes.',
          ),
        );
      }
      const launchPrompt = yield* LaunchPrompt;
      const confirmed = yield* launchPrompt.confirm(`Write these draft(s) into ${configPath}?`);
      if (!confirmed) {
        yield* launchPrompt.cancel('Aborted - nothing written.');
        return;
      }
    }
    let updatedStoreConfiguration = storeConfiguration;
    for (const localeDraft of localeDrafts) {
      updatedStoreConfiguration = applyDraft(
        updatedStoreConfiguration,
        localeDraft.locale,
        localeDraft.draft,
        listingTargets,
      );
    }
    yield* fileSystem.writeFileString(
      configPath,
      `${JSON.stringify(updatedStoreConfiguration, null, 2)}\n`,
    );
    yield* logger.ok(`ai listing - wrote ${localeDrafts.length} locale draft(s) -> ${configPath}`);
    yield* logger.note(
      'Review with `launch plan`, then apply with `launch sync` or `launch metadata push`.',
    );
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(AiListingFailureSchema)(cause)) return cause;
      return listingFailure('run AI listing command', cause);
    }),
  );

/** Run `launch ai listing` with the shared Anthropic generator. */
export const aiListingCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, AiListingFailure, AiListingRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(AiListingInputSchema)(rawCommandInput);
    let generatorOptions: Readonly<{ model?: string }> = {};
    if (commandInput.model !== undefined) generatorOptions = { model: commandInput.model };
    const listingGenerator = yield* createAnthropicListingGenerator(generatorOptions);
    yield* runAiListing(commandInput, listingGenerator);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(AiListingFailureSchema)(cause)) return cause;
      return listingFailure('decode AI listing command', cause);
    }),
  );
