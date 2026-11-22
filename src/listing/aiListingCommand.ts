import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, readResolvedConfig } from '../config/config.ts';
import { pathExists } from '../path-exists.ts';
import { readLastApp } from '../distribution/lastRun.ts';
import { errorMessage } from '../services/platform/errorMessage.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import type {
  AndroidLocaleInfo,
  AndroidStoreConfig,
  AppleLocaleInfo,
  AppleStoreConfig,
  StoreConfig,
} from '../store/shared/storeConfig.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { DraftListing, ListingBrief, LocaleDraft } from '../types/listing.ts';
import { applyDraft, briefFor, clampDraft, renderDraftPreview } from './apply.ts';
import { createAnthropicListingGenerator } from './generator.ts';

export interface AiListingInput {
  app?: string;
  locale?: string;
  about?: string;
  platform: string;
  model?: string;
  config?: string;
  dryRun: boolean;
  yes: boolean;
}

interface ListingTargets {
  readonly ios: boolean;
  readonly android: boolean;
}

interface AiListingFailure {
  readonly _tag: 'AiListingFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}

interface CopyGenerator {
  readonly name: string;
  generate(brief: ListingBrief): Promise<DraftListing>;
}

interface PromptChoice {
  selection: AppDescriptor;
  label: string;
  hint?: string;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function isAiListingFailure(cause: unknown): cause is AiListingFailure {
  if (isRecord(cause) == false) {
    return false;
  }

  return cause['_tag'] == 'AiListingFailure';
}

/** Normalize one listing command failure. */
function listingFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AiListingFailure {
  let message = errorMessage(cause);

  if (explicitMessage != null) {
    message = explicitMessage;
  }

  return { _tag: 'AiListingFailure', operation, message, cause };
}

function readOptionalInputString(
  record: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  if (Object.hasOwn(record, fieldName) == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (field == null) {
    return undefined;
  }

  if (typeof field != 'string') {
    throw listingFailure(
      'decode AI listing command',
      field,
      `Command field ${fieldName} must be a string.`,
    );
  }

  return field;
}

function readBooleanField(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: boolean,
): boolean {
  if (Object.hasOwn(record, fieldName) == false) {
    return fallback;
  }

  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw listingFailure(
      'decode AI listing command',
      field,
      `Command field ${fieldName} must be a boolean.`,
    );
  }

  return field;
}

function readPlatform(record: Record<string, unknown>): string {
  const platform = readOptionalInputString(record, 'platform');

  if (platform == null) {
    return 'ios';
  }

  return platform;
}

export function readAiListingInput(rawCommandInput: unknown): AiListingInput {
  if (isRecord(rawCommandInput) == false) {
    throw listingFailure(
      'decode AI listing command',
      rawCommandInput,
      'The AI listing command input must be an object.',
    );
  }

  const commandInput: AiListingInput = {
    platform: readPlatform(rawCommandInput),
    dryRun: readBooleanField(rawCommandInput, 'dryRun', false),
    yes: readBooleanField(rawCommandInput, 'yes', false),
  };
  const app = readOptionalInputString(rawCommandInput, 'app');
  const locale = readOptionalInputString(rawCommandInput, 'locale');
  const about = readOptionalInputString(rawCommandInput, 'about');
  const model = readOptionalInputString(rawCommandInput, 'model');
  const config = readOptionalInputString(rawCommandInput, 'config');

  if (app != null) {
    commandInput.app = app;
  }

  if (locale != null) {
    commandInput.locale = locale;
  }

  if (about != null) {
    commandInput.about = about;
  }

  if (model != null) {
    commandInput.model = model;
  }

  if (config != null) {
    commandInput.config = config;
  }

  return commandInput;
}

/** Decode the requested store selector. */
export function parseListingTargets(platformSelector: string): ListingTargets {
  if (platformSelector == 'ios') {
    return { ios: true, android: false };
  }

  if (platformSelector == 'android') {
    return { ios: false, android: true };
  }

  if (platformSelector == 'all') {
    return { ios: true, android: true };
  }

  throw listingFailure(
    'select listing platforms',
    platformSelector,
    `Unknown platform "${platformSelector}". Use ios, android, or all.`,
  );
}

function readConfigString(record: Record<string, unknown>, fieldName: string): string | undefined {
  if (Object.hasOwn(record, fieldName) == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (field == null) {
    return undefined;
  }

  if (typeof field != 'string') {
    throw listingFailure(
      'decode listing config',
      field,
      `store.config.json field ${fieldName} must be a string.`,
    );
  }

  return field;
}

function readConfigStringList(
  record: Record<string, unknown>,
  fieldName: string,
): string[] | undefined {
  if (Object.hasOwn(record, fieldName) == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (field == null) {
    return undefined;
  }

  if (Array.isArray(field) == false) {
    throw listingFailure(
      'decode listing config',
      field,
      `store.config.json field ${fieldName} must be a list of strings.`,
    );
  }

  const texts: string[] = [];

  for (const entry of field) {
    if (typeof entry != 'string') {
      throw listingFailure(
        'decode listing config',
        entry,
        `store.config.json field ${fieldName} must be a list of strings.`,
      );
    }

    texts.push(entry);
  }

  return texts;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  fieldName: string,
): number | undefined {
  if (Object.hasOwn(record, fieldName) == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (field == null) {
    return undefined;
  }

  if (typeof field != 'number') {
    throw listingFailure(
      'decode listing config',
      field,
      `store.config.json field ${fieldName} must be a number.`,
    );
  }

  return field;
}

function readAppleLocale(candidate: unknown): AppleLocaleInfo {
  if (isRecord(candidate) == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json locale must be an object.',
    );
  }

  const locale: AppleLocaleInfo = {};
  const title = readConfigString(candidate, 'title');
  const subtitle = readConfigString(candidate, 'subtitle');
  const description = readConfigString(candidate, 'description');
  const releaseNotes = readConfigString(candidate, 'releaseNotes');
  const promotionalText = readConfigString(candidate, 'promotionalText');
  const marketingUrl = readConfigString(candidate, 'marketingUrl');
  const supportUrl = readConfigString(candidate, 'supportUrl');
  const privacyPolicyUrl = readConfigString(candidate, 'privacyPolicyUrl');
  const keywords = readConfigStringList(candidate, 'keywords');

  if (title != null) {
    locale.title = title;
  }

  if (subtitle != null) {
    locale.subtitle = subtitle;
  }

  if (description != null) {
    locale.description = description;
  }

  if (releaseNotes != null) {
    locale.releaseNotes = releaseNotes;
  }

  if (promotionalText != null) {
    locale.promotionalText = promotionalText;
  }

  if (marketingUrl != null) {
    locale.marketingUrl = marketingUrl;
  }

  if (supportUrl != null) {
    locale.supportUrl = supportUrl;
  }

  if (privacyPolicyUrl != null) {
    locale.privacyPolicyUrl = privacyPolicyUrl;
  }

  if (keywords != null) {
    locale.keywords = keywords;
  }

  return locale;
}

function readAndroidLocale(candidate: unknown): AndroidLocaleInfo {
  if (isRecord(candidate) == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json locale must be an object.',
    );
  }

  const locale: AndroidLocaleInfo = {};
  const title = readConfigString(candidate, 'title');
  const shortDescription = readConfigString(candidate, 'shortDescription');
  const fullDescription = readConfigString(candidate, 'fullDescription');
  const video = readConfigString(candidate, 'video');

  if (title != null) {
    locale.title = title;
  }

  if (shortDescription != null) {
    locale.shortDescription = shortDescription;
  }

  if (fullDescription != null) {
    locale.fullDescription = fullDescription;
  }

  if (video != null) {
    locale.video = video;
  }

  return locale;
}

function readAppleLocales(candidate: unknown): Record<string, AppleLocaleInfo> {
  if (isRecord(candidate) == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json apple.info must be an object.',
    );
  }

  const locales: Record<string, AppleLocaleInfo> = {};

  for (const localeName of Object.keys(candidate)) {
    locales[localeName] = readAppleLocale(candidate[localeName]);
  }

  return locales;
}

function readAndroidLocales(candidate: unknown): Record<string, AndroidLocaleInfo> {
  if (isRecord(candidate) == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json android.info must be an object.',
    );
  }

  const locales: Record<string, AndroidLocaleInfo> = {};

  for (const localeName of Object.keys(candidate)) {
    locales[localeName] = readAndroidLocale(candidate[localeName]);
  }

  return locales;
}

function readAppleStore(candidate: unknown): AppleStoreConfig {
  if (isRecord(candidate) == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json apple must be an object.',
    );
  }

  if (Object.hasOwn(candidate, 'info') == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json apple.info is required.',
    );
  }

  const appleStore: NonNullable<StoreConfig['apple']> = {
    info: readAppleLocales(candidate['info']),
  };
  const categories = readConfigStringList(candidate, 'categories');

  if (categories != null) {
    appleStore.categories = categories;
  }

  return appleStore;
}

function readAndroidStore(candidate: unknown): AndroidStoreConfig {
  if (isRecord(candidate) == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json android must be an object.',
    );
  }

  if (Object.hasOwn(candidate, 'info') == false) {
    throw listingFailure(
      'decode listing config',
      candidate,
      'store.config.json android.info is required.',
    );
  }

  return { info: readAndroidLocales(candidate['info']) };
}

function decodeStoreConfig(configText: string): StoreConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(configText);
  } catch (cause) {
    throw listingFailure(
      'decode listing config',
      cause,
      'store.config.json must be a JSON object.',
    );
  }

  if (isRecord(parsed) == false) {
    throw listingFailure(
      'decode listing config',
      parsed,
      'store.config.json must be a JSON object.',
    );
  }

  const storeConfiguration: StoreConfig = {};
  const configVersion = readOptionalNumber(parsed, 'configVersion');

  if (configVersion != null) {
    storeConfiguration.configVersion = configVersion;
  }

  if (Object.hasOwn(parsed, 'apple')) {
    storeConfiguration.apple = readAppleStore(parsed['apple']);
  }

  if (Object.hasOwn(parsed, 'android')) {
    storeConfiguration.android = readAndroidStore(parsed['android']);
  }

  return storeConfiguration;
}

/** Decode an existing store config or start an empty listing. */
async function readListingConfig(configPath: string): Promise<StoreConfig> {
  let configExists = false;

  try {
    configExists = await pathExists(configPath);
  } catch (cause) {
    throw listingFailure('inspect listing config', cause);
  }

  if (configExists == false) {
    return {};
  }

  let configText: string;

  try {
    configText = await readFile(configPath, 'utf8');
  } catch (cause) {
    throw listingFailure('read listing config', cause);
  }

  return decodeStoreConfig(configText);
}

function trimLocale(localeName: string): string {
  return localeName.trim();
}

function isPresentLocale(localeName: string): boolean {
  return localeName.length > 0;
}

/** Resolve explicit locales or reuse the current Apple listing locales. */
export function resolveListingLocales(
  localeSelector: string | undefined,
  storeConfiguration: StoreConfig,
): string[] {
  if (localeSelector != null) {
    const requestedLocales = localeSelector.split(',').map(trimLocale).filter(isPresentLocale);

    if (requestedLocales.length > 0) {
      return requestedLocales;
    }

    throw listingFailure(
      'select listing locales',
      localeSelector,
      '--locale was empty. Pass locales like --locale en-US,fr-FR.',
    );
  }

  const appleListing = storeConfiguration.apple;

  if (appleListing == null) {
    return ['en-US'];
  }

  const currentLocales = Object.keys(appleListing.info);

  if (currentLocales.length == 0) {
    return ['en-US'];
  }

  return currentLocales;
}

function readAppName(discoveredApp: AppDescriptor): string {
  return discoveredApp.name;
}

function appChoice(discoveredApp: AppDescriptor): PromptChoice {
  let hint = discoveredApp.packageName;

  if (discoveredApp.bundleId != null) {
    hint = discoveredApp.bundleId;
  }

  if (hint == null) {
    return { selection: discoveredApp, label: discoveredApp.name };
  }

  return { selection: discoveredApp, label: discoveredApp.name, hint };
}

function findNamedApp(
  discoveredApps: readonly AppDescriptor[],
  appName: string | undefined,
): AppDescriptor | null {
  if (appName == null) {
    return null;
  }

  function hasAppName(discoveredApp: AppDescriptor): boolean {
    return discoveredApp.name == appName;
  }

  const selectedApp = discoveredApps.find(hasAppName);

  if (selectedApp == null) {
    return null;
  }

  return selectedApp;
}

function requireDiscoveredApp(
  onlyApp: AppDescriptor | undefined,
  discoveredApps: readonly AppDescriptor[],
): AppDescriptor {
  if (onlyApp == null) {
    throw listingFailure(
      'select app',
      discoveredApps,
      'No apps found. Run Launch from a repo containing at least one app.json.',
    );
  }

  return onlyApp;
}

async function selectNamedApp(request: {
  message: string;
  choices: readonly PromptChoice[];
  initialSelection?: AppDescriptor;
}): Promise<AppDescriptor> {
  try {
    return await LaunchPrompt.select(request);
  } catch (cause) {
    throw listingFailure('select app', cause);
  }
}

async function promptForListingApp(
  discoveredApps: readonly AppDescriptor[],
): Promise<AppDescriptor> {
  const isInteractive = checkTerminalIsInteractive();

  if (isInteractive == false) {
    throw listingFailure(
      'select app',
      discoveredApps,
      `Multiple apps found. Pass --app <name> to choose one: ${discoveredApps.map(readAppName).join(', ')}.`,
    );
  }

  const rememberedAppName = await readLastApp();
  const rememberedApp = findNamedApp(discoveredApps, rememberedAppName);
  const selectionRequest = {
    message: `Which app? (${discoveredApps.length} found)`,
    choices: discoveredApps.map(appChoice),
  };

  if (rememberedApp == null) {
    return selectNamedApp(selectionRequest);
  }

  return selectNamedApp({ ...selectionRequest, initialSelection: rememberedApp });
}

/** Select one app without reading process state inside core. */
async function selectListingApp(
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Promise<AppDescriptor> {
  if (discoveredApps.length == 0) {
    throw listingFailure(
      'select app',
      discoveredApps,
      'No apps found. Run Launch from a repo containing at least one app.json.',
    );
  }

  if (appSelector != null) {
    const selectedApp = findNamedApp(discoveredApps, appSelector);

    if (selectedApp != null) {
      return selectedApp;
    }

    throw listingFailure(
      'select app',
      appSelector,
      `App "${appSelector}" not found. Available: ${discoveredApps.map(readAppName).join(', ')}.`,
    );
  }

  const onlyApp = discoveredApps[0];
  const isOnlyApp = discoveredApps.length == 1;

  if (isOnlyApp) {
    return requireDiscoveredApp(onlyApp, discoveredApps);
  }

  return promptForListingApp(discoveredApps);
}

function namedOrFallback(name: unknown, fallbackName: string): string {
  if (typeof name != 'string') {
    return fallbackName;
  }

  return name;
}

function displayNameFromExpo(
  expo: unknown,
  resolvedAppConfig: Record<string, unknown>,
  fallbackName: string,
): string {
  if (isRecord(expo) == false) {
    return fallbackName;
  }

  if (Object.hasOwn(expo, 'name') == false) {
    return namedOrFallback(resolvedAppConfig['name'], fallbackName);
  }

  if (typeof expo['name'] != 'string') {
    return fallbackName;
  }

  return expo['name'];
}

function displayNameFromConfig(
  resolvedAppConfig: Record<string, unknown>,
  fallbackName: string,
): string {
  if (Object.hasOwn(resolvedAppConfig, 'expo')) {
    return displayNameFromExpo(resolvedAppConfig['expo'], resolvedAppConfig, fallbackName);
  }

  return namedOrFallback(resolvedAppConfig['name'], fallbackName);
}

/** Read the display name from resolved Expo configuration. */
async function resolveDisplayName(selectedApp: AppDescriptor): Promise<string> {
  const resolvedAppConfig = await readResolvedConfig(selectedApp.dir);

  if (resolvedAppConfig == null) {
    return selectedApp.name;
  }

  return displayNameFromConfig(resolvedAppConfig, selectedApp.name);
}

function readCurrentListing(
  storeConfiguration: StoreConfig,
  localeName: string,
): AppleLocaleInfo | undefined {
  const appleListing = storeConfiguration.apple;

  if (appleListing == null) {
    return undefined;
  }

  return appleListing.info[localeName];
}

async function confirmListingWrite(configPath: string): Promise<boolean> {
  const isInteractive = checkTerminalIsInteractive();

  if (isInteractive == false) {
    throw listingFailure(
      'confirm listing write',
      'confirmation-required',
      'Refusing to write without confirmation. Re-run with --yes.',
    );
  }

  const confirmed = await LaunchPrompt.confirm(`Write these draft(s) into ${configPath}?`);

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel('Aborted - nothing written.');

  return false;
}

async function draftLocales(
  locales: readonly string[],
  storeConfiguration: StoreConfig,
  displayName: string,
  about: string | undefined,
  listingGenerator: CopyGenerator,
): Promise<LocaleDraft[]> {
  const localeDrafts: LocaleDraft[] = [];

  for (const localeName of locales) {
    const currentListing = readCurrentListing(storeConfiguration, localeName);
    const listingBrief = briefFor(localeName, displayName, currentListing, about);
    const generatedListing = await listingGenerator.generate(listingBrief);
    const clampedListing = clampDraft(generatedListing);

    localeDrafts.push({
      locale: localeName,
      draft: clampedListing.draft,
      warnings: clampedListing.warnings,
    });
  }

  return localeDrafts;
}

/** Draft, preview, and optionally write listing copy with an injected generator. */
export async function runAiListing(
  commandInput: AiListingInput,
  listingGenerator: CopyGenerator,
): Promise<void> {
  try {
    const launchPaths = readLaunchDirectories();
    const logger = createLogger(false);
    const listingTargets = parseListingTargets(commandInput.platform);
    const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
    const selectedApp = await selectListingApp(loadedConfiguration.apps, commandInput.app);
    const displayName = await resolveDisplayName(selectedApp);
    let configPath = join(selectedApp.dir, 'store.config.json');

    if (commandInput.config != null) {
      configPath = commandInput.config;
    }

    const storeConfiguration = await readListingConfig(configPath);
    const locales = resolveListingLocales(commandInput.locale, storeConfiguration);

    logger.note(
      `Drafting ${locales.length} locale(s) for ${displayName} with ${listingGenerator.name}...`,
    );

    const localeDrafts = await draftLocales(
      locales,
      storeConfiguration,
      displayName,
      commandInput.about,
      listingGenerator,
    );

    logger.line(renderDraftPreview(localeDrafts, listingTargets));

    if (commandInput.dryRun) {
      logger.note('Dry run - nothing written. Drop --dry-run to save into store.config.json.');
      return;
    }

    if (commandInput.yes == false) {
      const confirmed = await confirmListingWrite(configPath);

      if (confirmed == false) {
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

    const configText = `${JSON.stringify(updatedStoreConfiguration, null, 2)}\n`;

    try {
      await writeFile(configPath, configText);
    } catch (cause) {
      throw listingFailure('run AI listing command', cause);
    }

    logger.ok(`ai listing - wrote ${localeDrafts.length} locale draft(s) -> ${configPath}`);
    logger.note(
      'Review with `launch plan`, then apply with `launch sync` or `launch metadata push`.',
    );
  } catch (cause) {
    if (isAiListingFailure(cause)) {
      throw cause;
    }

    throw listingFailure('run AI listing command', cause);
  }
}

/** Run `launch ai listing` with the shared Anthropic generator. */
export async function aiListingCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = readAiListingInput(rawCommandInput);
    let generatorOptions: { model?: string } = {};

    if (commandInput.model != null) {
      generatorOptions = { model: commandInput.model };
    }

    const listingGenerator = createAnthropicListingGenerator(generatorOptions);

    await runAiListing(commandInput, listingGenerator);
  } catch (cause) {
    if (isAiListingFailure(cause)) {
      throw cause;
    }

    throw listingFailure('decode AI listing command', cause);
  }
}
