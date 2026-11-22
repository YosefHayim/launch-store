import { readPlainObject } from '../../services/platform/plain-object.ts';
type SyncCommandInput = {
  app?: string;
  dryRun: boolean;
  allowDestructive: boolean;
  yes: boolean;
  snapshot: boolean;
};

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readOptionalString(record: Record<string, unknown>, fieldName: string): string | null {
  if (fieldName in record == false) {
    return null;
  }

  const field = record[fieldName];

  if (field == null) {
    return null;
  }

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function decodeSyncCommandInput(rawCommandInput: unknown): SyncCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Sync command input must be an object.');
  }

  const commandInput: SyncCommandInput = {
    dryRun: readRequiredBoolean(rawCommandInputObject, 'dryRun'),
    allowDestructive: readRequiredBoolean(rawCommandInputObject, 'allowDestructive'),
    yes: readRequiredBoolean(rawCommandInputObject, 'yes'),
    snapshot: readRequiredBoolean(rawCommandInputObject, 'snapshot'),
  };
  const appName = readOptionalString(rawCommandInputObject, 'app');

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const SyncCommandInputSchema = decodeSyncCommandInput;
