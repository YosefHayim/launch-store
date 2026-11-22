import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Prompts } from '../prompts.js';
import { hasMessage } from '../services/platform/errorMessage.js';
import { createLogger } from '../services/platform/logger.js';
import { readLaunchDirectories } from '../services/platform/paths.js';
import { LaunchPrompt } from '../services/platform/prompt.js';
import type { AppDescriptor } from '../types/app.js';
import { pathExists } from '../path-exists.js';
import { loadConfig } from './config.js';
import {
  configTemplate,
  DEFAULT_IN_REPO_ARTIFACT_DIR,
  detectAppRoot,
  ENV_EXAMPLE_TEMPLATE,
} from './configScaffold.js';
import { ensureArtifactDirIgnored } from './gitignore.js';

type InitCommandInput = Readonly<{
  workingDirectory?: string;
  framed: boolean;
}>;

type InitCommandFailure = Readonly<{
  _tag: 'InitCommandFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function initFailure(operation: string, cause: unknown): InitCommandFailure {
  let message = `${operation} failed.`;

  if (typeof cause == 'string') {
    const hasText = cause.length > 0;

    if (hasText) {
      message = cause;
    }
  }

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return { _tag: 'InitCommandFailure', operation, message, cause };
}

function readWorkingDirectory(record: Record<string, unknown>): string | undefined {
  const directoryIsPresent = 'workingDirectory' in record;

  if (directoryIsPresent == false) {
    return undefined;
  }

  const workingDirectory = record['workingDirectory'];

  if (workingDirectory === undefined) {
    throw new Error('workingDirectory cannot be undefined');
  }

  if (typeof workingDirectory != 'string') {
    throw new Error('workingDirectory must be a string');
  }

  return workingDirectory;
}

export function InitCommandInputSchema(rawCommandInput: unknown): InitCommandInput {
  if (isPlainRecord(rawCommandInput)) {
    return readInitCommandInput(rawCommandInput);
  }

  throw new Error('init command input must be an object');
}

function readInitCommandInput(record: Record<string, unknown>): InitCommandInput {
  const workingDirectory = readWorkingDirectory(record);
  const framed = record['framed'];

  if (typeof framed != 'boolean') {
    throw new Error('framed must be a boolean');
  }

  if (workingDirectory == null) {
    return { framed };
  }

  return { workingDirectory, framed };
}

async function writeFileIfAbsent(filePath: string, fileContents: string): Promise<boolean> {
  const fileIsPresent = await pathExists(filePath);

  if (fileIsPresent) {
    return false;
  }

  await writeFile(filePath, fileContents);

  return true;
}

function showDiscoveredApps(discoveredApps: AppDescriptor[]): void {
  const logger = createLogger(false);
  const noneFound = discoveredApps.length == 0;

  if (noneFound) {
    logger.notice(
      'Heads up',
      'No app.json found under this folder. Launch will still scaffold a config you can edit.',
    );

    return;
  }

  function describeApp(discoveredApp: AppDescriptor): string {
    let bundleDetails = '';

    if (discoveredApp.bundleId != null) {
      bundleDetails = `  (${discoveredApp.bundleId})`;
    }

    return `- ${discoveredApp.name}${bundleDetails}`;
  }

  const appLines = discoveredApps.map(describeApp);
  let appSuffix = 's';
  const isOneApp = discoveredApps.length == 1;

  if (isOneApp) {
    appSuffix = '';
  }

  logger.notice(`Found ${discoveredApps.length} app${appSuffix}`, ...appLines);
}

function requireInteractiveTerminal(operation: string): void {
  const prompts = new Prompts();
  const isInteractive = prompts.isInteractive();

  if (isInteractive) {
    return;
  }

  throw initFailure(operation, {
    message: '`launch init` requires an interactive terminal.',
  });
}

async function readArtifactDirectory(): Promise<string | null> {
  requireInteractiveTerminal('read artifact directory');
  const prompts = new Prompts();
  const enteredDirectory = await prompts.text(
    `Where should build artifacts be stored? [${DEFAULT_IN_REPO_ARTIFACT_DIR}] `,
  );

  if (enteredDirectory == null) {
    LaunchPrompt.cancel('Left your launch.config.ts untouched.');

    return null;
  }

  const trimmedDirectory = enteredDirectory.trim();
  const isBlank = trimmedDirectory.length == 0;

  if (isBlank) {
    return DEFAULT_IN_REPO_ARTIFACT_DIR;
  }

  return trimmedDirectory;
}

function showInitReceipt(writtenFiles: string): void {
  createLogger(false).notice(
    'Done',
    `Wrote: ${writtenFiles}`,
    '',
    'Next:',
    '  1. launch creds set-key   # import your App Store Connect API key',
    '  2. launch creds setup     # create/reuse your cert + provisioning profile',
    '  3. launch build ios --dry-run   # rehearse the whole flow, no changes',
  );
}

function resolveInitArtifactDirectory(artifactDir: string, projectDirectory: string): string {
  const directories = readLaunchDirectories();
  const configuredDirectory = artifactDir.trim();
  const isEmpty = configuredDirectory.length == 0;

  if (isEmpty) {
    throw {
      _tag: 'ArtifactDirectoryFailure',
      message:
        '`artifactDir` in launch.config.ts must not be empty - set a path or omit it for ~/.launch/artifacts.',
    };
  }

  if (configuredDirectory == '~') {
    return directories.homeDirectory;
  }

  const isHomeRelative = configuredDirectory.startsWith('~/');

  if (isHomeRelative) {
    return resolve(directories.homeDirectory, configuredDirectory.slice(2));
  }

  if (isAbsolute(configuredDirectory)) {
    return configuredDirectory;
  }

  return resolve(projectDirectory, configuredDirectory);
}

export async function runInitProgram(rawCommandInput: unknown): Promise<boolean> {
  try {
    const commandInput = InitCommandInputSchema(rawCommandInput);
    const logger = createLogger(false);

    if (commandInput.framed) {
      logger.line('launch init');
    }

    let workingDirectory = readLaunchDirectories().workingDirectory;

    if (commandInput.workingDirectory != null) {
      workingDirectory = commandInput.workingDirectory;
    }

    const loadedConfiguration = await loadConfig(workingDirectory);
    showDiscoveredApps(loadedConfiguration.apps);
    requireInteractiveTerminal('start init prompt');
    const configPath = join(workingDirectory, 'launch.config.ts');
    const configExists = await pathExists(configPath);

    if (configExists) {
      const overwriteConfirmed = await LaunchPrompt.confirm(
        'launch.config.ts already exists. Overwrite it?',
      );

      if (overwriteConfirmed == false) {
        LaunchPrompt.cancel('Left your launch.config.ts untouched.');

        return false;
      }
    }

    const artifactDirectory = await readArtifactDirectory();

    if (artifactDirectory == null) {
      return false;
    }

    const detectedAppRoot = detectAppRoot(loadedConfiguration.apps, workingDirectory);
    const initialConfig = configTemplate(detectedAppRoot, undefined, undefined, artifactDirectory);
    await writeFile(configPath, initialConfig);
    const environmentExampleWritten = await writeFileIfAbsent(
      join(workingDirectory, '.env.example'),
      ENV_EXAMPLE_TEMPLATE,
    );
    const resolvedArtifactDirectory = resolveInitArtifactDirectory(
      artifactDirectory,
      workingDirectory,
    );
    const gitignoreChange = await ensureArtifactDirIgnored(
      resolvedArtifactDirectory,
      workingDirectory,
    );
    const writtenFiles = ['launch.config.ts'];

    if (environmentExampleWritten) {
      writtenFiles.push('.env.example');
    }

    if (gitignoreChange.added) {
      let ignoreEntry = '';

      if (gitignoreChange.entry != null) {
        ignoreEntry = gitignoreChange.entry;
      }

      writtenFiles.push(`.gitignore (+ ${ignoreEntry})`);
    }

    showInitReceipt(writtenFiles.join(', '));

    if (commandInput.framed) {
      logger.line('Launch is configured.');
    }

    return true;
  } catch (cause) {
    throw initFailure('run init', cause);
  }
}
