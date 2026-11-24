// Authorizes European Union alternative distribution domains on App Store Connect.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import { loadActiveAppleStore } from './apple-store-command.ts';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from './app-store-surface-command.ts';
import { reconcileEuDistributionDomains } from './eu-distribution.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

type EuDistributionCommandInput =
  | Readonly<{
      operation: 'reconcile';
      dryRun: boolean;
      yes: boolean;
    }>
  | Readonly<{ operation: 'set-key'; pemPath: string }>
  | Readonly<{ operation: 'list' }>;

function readText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }

  return field;
}

function readFlag(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isFlag = typeof field == 'boolean';

  if (isFlag == false) {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

function decodeEuDistributionCommandInput(rawCommandInput: unknown): EuDistributionCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('EU distribution command input must be an object.');
  }

  const operation = rawCommandInputObject['operation'];

  if (operation == 'list') {
    return { operation: 'list' };
  }

  if (operation == 'set-key') {
    return { operation: 'set-key', pemPath: readText(rawCommandInputObject, 'pemPath') };
  }

  if (operation == 'reconcile') {
    return {
      operation: 'reconcile',
      dryRun: readFlag(rawCommandInputObject, 'dryRun'),
      yes: readFlag(rawCommandInputObject, 'yes'),
    };
  }

  throw new Error('Unknown EU distribution command.');
}

function projectPath(commandPath: string): string {
  const launchPaths = readLaunchDirectories();

  const isAbsolutePath = path.isAbsolute(commandPath);

  if (isAbsolutePath) {
    return commandPath;
  }

  return path.join(launchPaths.workingDirectory, commandPath);
}

function isFailedAction(plannedAction: PlannedAction): boolean {
  return plannedAction.status == 'failed';
}

function renderPlanned(plannedAction: PlannedAction): string {
  return renderStoreSurfaceAction(plannedAction);
}

function renderApplied(plannedAction: PlannedAction): string {
  return renderAppliedStoreSurfaceAction(plannedAction);
}

async function reconcileDomains(
  commandInput: Extract<EuDistributionCommandInput, { operation: 'reconcile' }>,
): Promise<void> {
  const logger = createLogger(false);
  const storeAppContext = await loadStoreAppContext(undefined);
  const euDistributionSection = storeAppContext.config.euDistribution;

  const isEuDistributionMissing = euDistributionSection == null;

  if (isEuDistributionMissing) {
    throw new Error('No EU distribution config. Add an euDistribution field to launch.config.ts.');
  }

  const appleStore = await loadActiveAppleStore();
  const plannedActions = await reconcileEuDistributionDomains(
    appleStore,
    euDistributionSection,
    true,
  );

  logger.gap();

  const isAlreadyAuthorized = plannedActions.length == 0;

  if (isAlreadyAuthorized) {
    logger.step('eu-distribution', 'distribution domains already authorized');
    return;
  }

  const plannedLines = plannedActions.map(renderPlanned);

  logger.notice('EU alternative distribution', ...plannedLines);
  logger.gap();
  logger.note(`${plannedActions.length} domain(s) to authorize.`);

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
    return;
  }

  const confirmed = await confirmStoreSurfaceWrite(
    `Authorize ${plannedActions.length} distribution domain(s)?`,
    commandInput.yes,
  );

  const declined = confirmed == false;

  if (declined) {
    return;
  }

  const appliedActions = await reconcileEuDistributionDomains(
    appleStore,
    euDistributionSection,
    false,
  );
  const failedActionCount = appliedActions.filter(isFailedAction).length;
  let receiptTitle = 'Domains authorized';

  const hasFailures = failedActionCount > 0;

  if (hasFailures) {
    receiptTitle = 'Authorized with errors';
  }

  logger.box(receiptTitle, appliedActions.map(renderApplied));

  if (hasFailures) {
    completeCommand(1);
  }
}

async function setDistributionKey(pemPath: string): Promise<void> {
  const logger = createLogger(false);
  const publicKeyPath = projectPath(pemPath);
  const publicKeyFile = await readFile(publicKeyPath, 'utf8');
  const publicKey = publicKeyFile.trim();

  const isEmpty = publicKey.length == 0;

  if (isEmpty) {
    throw new Error(`${pemPath} is empty - expected a PEM public key.`);
  }

  const appleStore = await loadActiveAppleStore();
  const registeredKeys = await appleStore.listAlternativeDistributionKeys();
  const registeredKey = registeredKeys[0];

  const hasRegisteredKey = registeredKey != null;

  if (hasRegisteredKey) {
    logger.note(
      `A distribution key is already registered (id ${registeredKey.id}). Delete it in App Store Connect to replace it.`,
    );
    return;
  }

  await appleStore.createAlternativeDistributionKey(publicKey);
  logger.ok('Registered the alternative-distribution public key.');
}

function domainLine(distributionDomain: { domain?: string; referenceName?: string }): string {
  let domainName = '?';
  const domainNameText = distributionDomain.domain;

  const hasDomain = domainNameText != null;

  if (hasDomain) {
    domainName = domainNameText;
  }

  let referenceText = '';

  const hasReference = distributionDomain.referenceName != null;

  if (hasReference) {
    referenceText = ` (${distributionDomain.referenceName})`;
  }

  return `- ${domainName}${referenceText}`;
}

async function listDistributionState(): Promise<void> {
  const logger = createLogger(false);
  const appleStore = await loadActiveAppleStore();
  const listed = await Promise.all([
    appleStore.listAlternativeDistributionDomains(),
    appleStore.listAlternativeDistributionKeys(),
  ]);
  const domains = listed[0];
  const keys = listed[1];
  let keyStatus = 'not registered';

  const hasKey = keys.length > 0;

  if (hasKey) {
    keyStatus = 'registered';
  }

  const domainLines: string[] = [];

  for (const distributionDomain of domains) {
    domainLines.push(domainLine(distributionDomain));
  }

  const hasNoDomains = domainLines.length == 0;

  if (hasNoDomains) {
    domainLines.push('- no domains authorized');
  }

  logger.notice(`EU alternative distribution - key ${keyStatus}`, ...domainLines);
}

export async function euDistributionCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeEuDistributionCommandInput(rawCommandInput);

    if (commandInput.operation == 'reconcile') {
      await reconcileDomains(commandInput);
      return;
    }

    if (commandInput.operation == 'set-key') {
      await setDistributionKey(commandInput.pemPath);
      return;
    }

    await listDistributionState();
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw new Error(failureMessage, { cause });
  }
}

type EuDistributionOptions = Readonly<{
  dryRun: boolean;
  yes: boolean;
}>;

export function registerEuDistributionCommand(program: Command): void {
  function runEuDistribution(commandOptions: EuDistributionOptions) {
    const euDistributionProgram = euDistributionCommandProgram({
      operation: 'reconcile',
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
    });

    return runCliProgram(euDistributionProgram);
  }

  const euDistributionCommand = program
    .command('eu-distribution')
    .description('authorize EU alternative-distribution domains from launch.config.ts (DMA)')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runEuDistribution);

  function runSetKeyPemPath(pemPath: string) {
    const euDistributionProgram = euDistributionCommandProgram({ operation: 'set-key', pemPath });
    return runCliProgram(euDistributionProgram);
  }

  euDistributionCommand
    .command('set-key <pemPath>')
    .description(
      "register the team's package-signing public key (the public half - a plain .pem file)",
    )
    .action(runSetKeyPemPath);

  function runList() {
    const euDistributionProgram = euDistributionCommandProgram({ operation: 'list' });
    return runCliProgram(euDistributionProgram);
  }

  euDistributionCommand
    .command('list')
    .description("show the team's authorized distribution domains and whether a key is registered")
    .action(runList);
}
