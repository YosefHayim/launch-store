// Drafts App Store Connect and Google Play listing copy to paste under listing.

import { launchConfigForApp, loadConfig, readResolvedConfig } from '../config/config.ts';
import { readLastApp } from '../distribution/last-run.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import type { AppleLocaleInfo, StoreConfig } from '../store/shared/store-config.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { DraftListing, ListingBrief, LocaleDraft } from '../types/listing.ts';
import { applyDraft, briefFor, clampDraft, renderDraftPreview } from './apply.ts';
import { createAnthropicListingGenerator } from './generator.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export interface AiListingInput {
  app?: string;
  locale?: string;
  about?: string;
  platform: string;
  model?: string;
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
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw listingFailure(
      'decode AI listing command',
      rawCommandInput,
      'The AI listing command input must be an object.',
    );
  }

  const commandInput: AiListingInput = {
    platform: readPlatform(rawCommandInputObject),
    dryRun: readBooleanField(rawCommandInputObject, 'dryRun', false),
    yes: readBooleanField(rawCommandInputObject, 'yes', false),
  };
  const app = readOptionalInputString(rawCommandInputObject, 'app');
  const locale = readOptionalInputString(rawCommandInputObject, 'locale');
  const about = readOptionalInputString(rawCommandInputObject, 'about');
  const model = readOptionalInputString(rawCommandInputObject, 'model');

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
    return await new LaunchPrompt().select(request);
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
  const expoObject = readPlainObject(expo);

  if (expoObject == null) {
    return fallbackName;
  }

  if (Object.hasOwn(expoObject, 'name') == false) {
    return namedOrFallback(resolvedAppConfig['name'], fallbackName);
  }

  if (typeof expoObject['name'] != 'string') {
    return fallbackName;
  }

  return expoObject['name'];
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

function listingKeyFor(app: AppDescriptor): string | null {
  let listingKey: string | null = null;

  if (app.bundleId != null) {
    listingKey = app.bundleId;
  }

  if (listingKey == null) {
    listingKey = app.packageName ?? null;
  }

  return listingKey;
}

function declaredStoreListing(launchFile: LaunchConfig, app: AppDescriptor): StoreConfig {
  const listings = launchFile.listing;

  if (listings == null) {
    return {};
  }

  const listingKey = listingKeyFor(app);

  if (listingKey == null) {
    return {};
  }

  const storeListing = listings[listingKey];

  if (storeListing == null) {
    return {};
  }

  return storeListing;
}

/** Draft listing copy and print it so it can be pasted under `listing`. */
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
    const appLaunch = await launchConfigForApp(loadedConfiguration.config, selectedApp.dir);
    const storeConfiguration = declaredStoreListing(appLaunch, selectedApp);
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
    const draftPreview = renderDraftPreview(localeDrafts, listingTargets);

    logger.line(draftPreview);

    if (commandInput.dryRun) {
      logger.note('Dry run. Paste the draft under listing in launch.config.ts when you are ready.');

      return;
    }

    const listingKey = listingKeyFor(selectedApp);

    if (listingKey == null) {
      throw listingFailure(
        'print listing draft',
        selectedApp.name,
        `${selectedApp.name} has no bundle id or package name, so the draft cannot be keyed under listing.`,
      );
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

    const listingDocument = { [listingKey]: updatedStoreConfiguration };

    logger.line(JSON.stringify(listingDocument, null, 2));
    logger.note(
      `Add this under listing in launch.config.ts, then run \`launch-store metadata push\`.`,
    );
  } catch (cause) {
    if (isFailureTag(cause, 'AiListingFailure')) {
      throw cause;
    }

    throw listingFailure('run AI listing command', cause);
  }
}

/** Run `launch-store ai listing` with the shared Anthropic generator. */
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
    if (isFailureTag(cause, 'AiListingFailure')) {
      throw cause;
    }

    throw listingFailure('decode AI listing command', cause);
  }
}
