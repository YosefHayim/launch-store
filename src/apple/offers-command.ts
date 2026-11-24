// Runs one subscription-offer action against App Store Connect.

import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import { executeGenerateCodes } from './offers-generate-codes.ts';
import { executeListOfferCodes } from './offers-list.ts';
import { executeOffersReconcile } from './offers-reconcile.ts';
import { findOfferCode, readSubscription } from './offers-subscription.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';

export type OffersReconcileInput = {
  operation: 'reconcile';
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

export type OffersGenerateCodesInput = {
  operation: 'generate-codes';
  productId: string;
  offerName: string;
  app?: string;
  count: string;
  expires?: string;
  custom?: string;
};

export type OffersListInput = {
  operation: 'list';
  productId: string;
  app?: string;
};

export type OffersDeactivateInput = {
  operation: 'deactivate';
  productId: string;
  offerName: string;
  app?: string;
};

type OffersCommandInput =
  | OffersReconcileInput
  | OffersGenerateCodesInput
  | OffersListInput
  | OffersDeactivateInput;

function readCommandRecord(rawCommandInput: unknown): Record<string, unknown> {
  const commandRecord = readPlainObject(rawCommandInput);

  if (commandRecord == null) {
    throw new Error('Offers command input must be an object.');
  }

  return commandRecord;
}

function readRequiredString(record: Record<string, unknown>, field: string): string {
  const fieldText = record[field];
  const isString = typeof fieldText == 'string';

  if (isString == false) {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return fieldText;
}

function readRequiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const fieldFlag = record[field];
  const isBoolean = typeof fieldFlag == 'boolean';

  if (isBoolean == false) {
    throw new Error(`Expected ${field} to be a boolean.`);
  }

  return fieldFlag;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const hasField = Object.hasOwn(record, field);

  if (hasField == false) {
    return undefined;
  }

  const fieldText = record[field];
  const isString = typeof fieldText == 'string';

  if (isString == false) {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return fieldText;
}

function optionalApp(record: Record<string, unknown>): { app?: string } {
  const appName = readExactOptionalString(record, 'app');
  const hasAppName = appName != null;

  if (hasAppName == false) {
    return {};
  }

  return { app: appName };
}

function decodeOffersReconcile(record: Record<string, unknown>): OffersReconcileInput {
  return {
    operation: 'reconcile',
    ...optionalApp(record),
    dryRun: readRequiredBoolean(record, 'dryRun'),
    yes: readRequiredBoolean(record, 'yes'),
  };
}

function optionalText(
  record: Record<string, unknown>,
  field: 'expires' | 'custom',
): {
  expires?: string;
  custom?: string;
} {
  const fieldText = readExactOptionalString(record, field);
  const hasFieldText = fieldText != null;

  if (hasFieldText == false) {
    return {};
  }

  if (field == 'expires') {
    return { expires: fieldText };
  }

  return { custom: fieldText };
}

function decodeOffersGenerateCodes(record: Record<string, unknown>): OffersGenerateCodesInput {
  return {
    operation: 'generate-codes',
    productId: readRequiredString(record, 'productId'),
    offerName: readRequiredString(record, 'offerName'),
    count: readRequiredString(record, 'count'),
    ...optionalApp(record),
    ...optionalText(record, 'expires'),
    ...optionalText(record, 'custom'),
  };
}

function decodeOffersList(record: Record<string, unknown>): OffersListInput {
  return {
    operation: 'list',
    productId: readRequiredString(record, 'productId'),
    ...optionalApp(record),
  };
}

function decodeOffersDeactivate(record: Record<string, unknown>): OffersDeactivateInput {
  return {
    operation: 'deactivate',
    productId: readRequiredString(record, 'productId'),
    offerName: readRequiredString(record, 'offerName'),
    ...optionalApp(record),
  };
}

export function OffersCommandInputSchema(rawCommandInput: unknown): OffersCommandInput {
  const record = readCommandRecord(rawCommandInput);
  const operation = readRequiredString(record, 'operation');

  if (operation == 'reconcile') {
    return decodeOffersReconcile(record);
  }

  if (operation == 'generate-codes') {
    return decodeOffersGenerateCodes(record);
  }

  if (operation == 'list') {
    return decodeOffersList(record);
  }

  if (operation == 'deactivate') {
    return decodeOffersDeactivate(record);
  }

  throw new Error('Unknown offers command.');
}

/** Deactivate one offer-code campaign. */
async function executeDeactivateOfferCode(commandInput: OffersDeactivateInput): Promise<void> {
  try {
    const logger = createLogger(false);
    const chosenSubscription = await readSubscription(commandInput.app, commandInput.productId);
    const offerCode = await findOfferCode(
      chosenSubscription,
      commandInput.productId,
      commandInput.offerName,
    );

    try {
      await chosenSubscription.appleStore.deactivateOfferCode(offerCode.id);
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    logger.step(
      'offers',
      `deactivated offer code "${commandInput.offerName}" on ${commandInput.productId}`,
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Decode and run the selected offers command operation. */
async function executeOffersCommand(rawCommandInput: unknown): Promise<number> {
  try {
    try {
      var commandInput = OffersCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    if (commandInput.operation == 'reconcile') {
      return await executeOffersReconcile(commandInput);
    }

    if (commandInput.operation == 'generate-codes') {
      await executeGenerateCodes(commandInput);
      return 0;
    }

    if (commandInput.operation == 'list') {
      await executeListOfferCodes(commandInput);
      return 0;
    }

    await executeDeactivateOfferCode(commandInput);

    return 0;
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

/** Run a schema-decoded offers operation. */
export async function offersCommandProgram(rawCommandInput: unknown): Promise<void> {
  const failureCount = await executeOffersCommand(rawCommandInput);

  const hasFailures = failureCount > 0;

  if (hasFailures) {
    completeCommand(1);
  }
}

type OffersOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

type AppScopedOptions = Readonly<{
  readonly app?: string;
}>;

type GenerateCodesOptions = AppScopedOptions &
  Readonly<{
    readonly count: string;
    readonly expires?: string;
    readonly custom?: string;
  }>;

/** Map the default offers command without explicit undefined properties. */
function readOffersReconcile(commandOptions: OffersOptions): OffersReconcileInput {
  let offersInput: OffersReconcileInput = {
    operation: 'reconcile',
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) offersInput = { ...offersInput, app: commandOptions.app };

  return offersInput;
}

/** Map code-generation arguments without explicit undefined properties. */
function readOfferCodes(
  productId: string,
  offerName: string,
  commandOptions: GenerateCodesOptions,
): OffersGenerateCodesInput {
  let generateCodesInput: OffersGenerateCodesInput = {
    operation: 'generate-codes',
    productId,
    offerName,
    count: commandOptions.count,
  };

  if (commandOptions.app != null) {
    generateCodesInput = { ...generateCodesInput, app: commandOptions.app };
  }

  if (commandOptions.expires != null) {
    generateCodesInput = { ...generateCodesInput, expires: commandOptions.expires };
  }

  if (commandOptions.custom != null) {
    generateCodesInput = { ...generateCodesInput, custom: commandOptions.custom };
  }

  return generateCodesInput;
}

/** Map a list request without an explicit undefined app. */
function readOffersList(productId: string, commandOptions: AppScopedOptions): OffersListInput {
  let listInput: OffersListInput = { operation: 'list', productId };

  if (commandOptions.app != null) listInput = { ...listInput, app: commandOptions.app };

  return listInput;
}

/** Map a deactivate request without an explicit undefined app. */
function readOffersDeactivate(
  productId: string,
  offerName: string,
  commandOptions: AppScopedOptions,
): OffersDeactivateInput {
  let deactivateInput: OffersDeactivateInput = { operation: 'deactivate', productId, offerName };

  if (commandOptions.app != null) {
    deactivateInput = { ...deactivateInput, app: commandOptions.app };
  }

  return deactivateInput;
}

/** Attach offers reconciliation and offer-code operations. */
export function registerOffersCommand(program: Command): void {
  function runOffers(commandOptions: OffersOptions) {
    const offersReconcile = readOffersReconcile(commandOptions);
    const offersProgram = offersCommandProgram(offersReconcile);
    return runCliProgram(offersProgram);
  }

  const offersCommand = program
    .command('offers')
    .description(
      'reconcile subscription offers (codes, promo/intro/win-back) and promoted-purchase order from config',
    )
    .option(
      '-a, --app <names>',
      'comma-separated app handles (default: all apps with offers declared)',
    )
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runOffers);

  function runGenerateCodesProductIdOfferName(
    productId: string,
    offerName: string,
    commandOptions: GenerateCodesOptions,
  ) {
    const generateCodes = readOfferCodes(productId, offerName, commandOptions);
    const offersProgram = offersCommandProgram(generateCodes);
    return runCliProgram(offersProgram);
  }

  offersCommand
    .command('generate-codes <productId> <offerName>')
    .description('generate redeemable codes under an existing offer-code campaign')
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .option('-n, --count <number>', 'how many codes to generate', '100')
    .option('-e, --expires <date>', 'expiration date (YYYY-MM-DD); required for one-time-use codes')
    .option(
      '--custom <code>',
      'create one shareable custom code with this value instead of one-time-use codes',
    )
    .action(runGenerateCodesProductIdOfferName);

  function runListProductId(productId: string, commandOptions: AppScopedOptions) {
    const offersList = readOffersList(productId, commandOptions);
    const offersProgram = offersCommandProgram(offersList);
    return runCliProgram(offersProgram);
  }

  offersCommand
    .command('list <productId>')
    .description("list a subscription's offer-code campaigns and their states")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action(runListProductId);

  function runDeactivateProductIdOfferName(
    productId: string,
    offerName: string,
    commandOptions: AppScopedOptions,
  ) {
    const offersDeactivate = readOffersDeactivate(productId, offerName, commandOptions);
    const offersProgram = offersCommandProgram(offersDeactivate);
    return runCliProgram(offersProgram);
  }

  offersCommand
    .command('deactivate <productId> <offerName>')
    .description("deactivate an offer-code campaign (its terms can't be edited, only switched off)")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action(runDeactivateProductIdOfferName);
}
