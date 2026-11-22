import { createLogger } from '../../../../services/platform/logger.ts';
import { completeCommand } from '../../../../terminal/command-exit.ts';
import { executeGenerateCodes } from './offers-generate-codes.ts';
import { executeListOfferCodes } from './offers-list.ts';
import { executeOffersReconcile } from './offers-reconcile.ts';
import { findOfferCode, offersFailure, resolveSubscription } from './offers-subscription.ts';

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
  if (rawCommandInput == null) {
    throw new Error('Offers command input must be an object.');
  }

  const isObject = typeof rawCommandInput == 'object';

  if (isObject == false) {
    throw new Error('Offers command input must be an object.');
  }

  const isArray = Array.isArray(rawCommandInput);

  if (isArray) {
    throw new Error('Offers command input must be an object.');
  }

  return rawCommandInput as Record<string, unknown>;
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
    const resolvedSubscription = await resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    const offerCode = await findOfferCode(
      resolvedSubscription,
      commandInput.productId,
      commandInput.offerName,
    );

    try {
      await resolvedSubscription.appleStore.deactivateOfferCode(offerCode.id);
    } catch (cause) {
      throw offersFailure('deactivate offer-code campaign', cause);
    }

    logger.step(
      'offers',
      `deactivated offer code "${commandInput.offerName}" on ${commandInput.productId}`,
    );
  } catch (cause) {
    throw offersFailure('deactivate offer code', cause);
  }
}

/** Decode and run the selected offers command operation. */
async function executeOffersCommand(rawCommandInput: unknown): Promise<number> {
  try {
    let commandInput: OffersCommandInput;

    try {
      commandInput = OffersCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw offersFailure('decode offers command input', cause);
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
    throw offersFailure('run offers command', cause);
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
