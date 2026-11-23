// Syncs Apple Pay merchant ids and Wallet pass type ids on App Store Connect.

import { errorMessage } from '@/services/platform/error-message.js';
import { createLogger } from '@/services/platform/logger.js';
import { completeCommand, isCommandExit } from '@/terminal/command-exit.js';
import { loadActiveAppleStore } from './apple-store-command.ts';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from './app-store-surface-command.ts';
import { reconcileWalletIds } from '@/apple/store/wallet-ids.js';
import { loadStoreAppContext } from '@/store/shared/select-store-app.js';
import type { PlannedAction } from '@/types/reconcile.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

type WalletCommandInput =
  | Readonly<{
      operation: 'reconcile';
      dryRun: boolean;
      yes: boolean;
    }>
  | Readonly<{ operation: 'list' }>;

type WalletCommandFailure = Readonly<{
  readonly _tag: 'WalletCommandFailure';
  readonly operation: WalletCommandInput['operation'];
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeWalletCommandFailure(fields: {
  operation: WalletCommandInput['operation'];
  message: string;
  cause?: unknown;
}): WalletCommandFailure {
  return { _tag: 'WalletCommandFailure', ...fields };
}

function readFlag(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isFlag = typeof field == 'boolean';

  if (isFlag == false) {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

function decodeWalletCommandInput(rawCommandInput: unknown): WalletCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Wallet command input must be an object.');
  }

  const operation = rawCommandInputObject['operation'];

  if (operation == 'list') {
    return { operation: 'list' };
  }

  if (operation == 'reconcile') {
    return {
      operation: 'reconcile',
      dryRun: readFlag(rawCommandInputObject, 'dryRun'),
      yes: readFlag(rawCommandInputObject, 'yes'),
    };
  }

  throw new Error('Unknown wallet command.');
}

function readWalletOperation(rawCommandInput: unknown): WalletCommandInput['operation'] | null {
  try {
    return decodeWalletCommandInput(rawCommandInput).operation;
  } catch (cause) {
    return null;
  }
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

async function reconcileWallet(
  commandInput: Extract<WalletCommandInput, { operation: 'reconcile' }>,
): Promise<void> {
  const logger = createLogger(false);
  const storeAppContext = await loadStoreAppContext(undefined);
  const walletSection = storeAppContext.config.wallet;

  const isWalletMissing = walletSection == null;

  if (isWalletMissing) {
    throw makeWalletCommandFailure({
      operation: 'reconcile',
      message: 'No wallet config. Add a wallet field to launch.config.ts.',
    });
  }

  const appleStore = await loadActiveAppleStore();
  const plannedActions = await reconcileWalletIds(appleStore, walletSection, true);

  logger.gap();

  const isAlreadyRegistered = plannedActions.length == 0;

  if (isAlreadyRegistered) {
    logger.step('wallet', 'merchant ids and pass type ids already registered');
    return;
  }

  logger.notice('Apple Pay / Wallet identifiers', ...plannedActions.map(renderPlanned));
  logger.gap();
  logger.note(`${plannedActions.length} identifier(s) to register.`);

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
    return;
  }

  const confirmed = await confirmStoreSurfaceWrite(
    `Register ${plannedActions.length} identifier(s)?`,
    commandInput.yes,
  );

  const declined = confirmed == false;

  if (declined) {
    return;
  }

  const appliedActions = await reconcileWalletIds(appleStore, walletSection, false);
  const failedActionCount = appliedActions.filter(isFailedAction).length;
  let receiptTitle = 'Identifiers registered';

  const hasFailures = failedActionCount > 0;

  if (hasFailures) {
    receiptTitle = 'Registered with errors';
  }

  logger.box(receiptTitle, appliedActions.map(renderApplied));

  if (hasFailures) {
    completeCommand(1);
  }
}

function identifierLines(
  familyTitle: string,
  identifiers: readonly Readonly<{ identifier?: string; name?: string }>[],
): Readonly<{ title: string; lines: string[] }> {
  const lines: string[] = [];

  for (const registeredIdentifier of identifiers) {
    let identifier = '?';

    const hasIdentifier = registeredIdentifier.identifier != null;

    if (hasIdentifier) {
      identifier = registeredIdentifier.identifier;
    }

    let nameText = '';

    const hasName = registeredIdentifier.name != null;

    if (hasName) {
      nameText = ` (${registeredIdentifier.name})`;
    }

    lines.push(`- ${identifier}${nameText}`);
  }

  const isEmpty = lines.length == 0;

  if (isEmpty) {
    lines.push('- none registered');
  }

  return { title: familyTitle, lines };
}

async function listWalletIdentifiers(): Promise<void> {
  const logger = createLogger(false);
  const appleStore = await loadActiveAppleStore();
  const listed = await Promise.all([appleStore.listMerchantIds(), appleStore.listPassTypeIds()]);
  const merchantSection = identifierLines('Apple Pay merchant ids', listed[0]);
  const passSection = identifierLines('Wallet pass type ids', listed[1]);

  logger.notice(merchantSection.title, ...merchantSection.lines);
  logger.notice(passSection.title, ...passSection.lines);
}

export async function walletCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeWalletCommandInput(rawCommandInput);

    if (commandInput.operation == 'reconcile') {
      await reconcileWallet(commandInput);
      return;
    }

    await listWalletIdentifiers();
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    let operation: WalletCommandInput['operation'] = 'reconcile';
    const decodedOperation = readWalletOperation(rawCommandInput);

    const hasDecodedOperation = decodedOperation != null;

    if (hasDecodedOperation) {
      operation = decodedOperation;
    }

    const failureMessage = errorMessage(cause);

    throw makeWalletCommandFailure({
      operation,
      message: failureMessage,
      cause,
    });
  }
}
