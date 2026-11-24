// Writes a starter Launch config, an environment example, and an ignore rule for artifacts.

import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Prompts } from '../prompts.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { AppDescriptor } from '../types/app.ts';
import { pathExists } from '../path-exists.ts';
import { loadConfig } from './config.ts';
import {
  configTemplate,
  DEFAULT_IN_REPO_ARTIFACT_DIR,
  detectAppRoot,
  ENV_EXAMPLE_TEMPLATE,
} from './config-scaffold.ts';
import { ensureArtifactDirIgnored } from './gitignore.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type InitCommandInput = Readonly<{
  workingDirectory?: string;
  framed: boolean;
}>;

function readWorkingDirectory(record: Record<string, unknown>): string | undefined {
  const directoryIsPresent = 'workingDirectory' in record;

  if (directoryIsPresent == false) {
    return undefined;
  }

  const workingDirectory = record['workingDirectory'];

  if (workingDirectory == null) {
    throw new Error('workingDirectory cannot be undefined');
  }

  if (typeof workingDirectory != 'string') {
    throw new Error('workingDirectory must be a string');
  }

  return workingDirectory;
}

export function InitCommandInputSchema(rawCommandInput: unknown): InitCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject != null) {
    return readInitCommandInput(rawCommandInputObject);
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

function requireInteractiveTerminal(): void {
  const prompts = new Prompts();

  const isInteractive = prompts.isInteractive();

  if (isInteractive) {
    return;
  }

  throw new Error('`launch-store init` requires an interactive terminal.');
}

async function readArtifactDirectory(): Promise<string | null> {
  requireInteractiveTerminal();

  const prompts = new Prompts();
  const enteredDirectory = await prompts.text(
    `Where should build artifacts be stored? [${DEFAULT_IN_REPO_ARTIFACT_DIR}] `,
  );

  if (enteredDirectory == null) {
    new LaunchPrompt().cancel('Left your launch.config.ts untouched.');

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
    'Run `launch-store --help` for the commands.',
  );
}

function readInitArtifactDirectory(artifactDir: string, projectDirectory: string): string {
  const directories = readLaunchDirectories();
  const configuredDirectory = artifactDir.trim();

  const isEmpty = configuredDirectory.length == 0;

  if (isEmpty) {
    throw new Error(
      '`artifactDir` in launch.config.ts must not be empty - set a path or omit it for ~/.launch/artifacts.',
    );
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
      logger.line('launch-store init');
    }

    let workingDirectory = readLaunchDirectories().workingDirectory;

    if (commandInput.workingDirectory != null) {
      workingDirectory = commandInput.workingDirectory;
    }

    const loadedConfiguration = await loadConfig(workingDirectory);

    showDiscoveredApps(loadedConfiguration.apps);
    requireInteractiveTerminal();

    const configPath = join(workingDirectory, 'launch.config.ts');

    const configExists = await pathExists(configPath);

    if (configExists) {
      const overwriteConfirmed = await new LaunchPrompt().confirm(
        'launch.config.ts already exists. Overwrite it?',
      );

      if (overwriteConfirmed == false) {
        new LaunchPrompt().cancel('Left your launch.config.ts untouched.');

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

    const joinedPath = join(workingDirectory, '.env.example');
    const environmentExampleWritten = await writeFileIfAbsent(joinedPath, ENV_EXAMPLE_TEMPLATE);
    const projectArtifactDirectory = readInitArtifactDirectory(artifactDirectory, workingDirectory);
    const gitignoreChange = await ensureArtifactDirIgnored(
      projectArtifactDirectory,
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
    throw new Error(errorMessage(cause), { cause });
  }
}
