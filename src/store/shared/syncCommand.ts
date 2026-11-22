type SyncCommandInput = {
  app?: string;
  dryRun: boolean;
  allowDestructive: boolean;
  yes: boolean;
  snapshot: boolean;
};

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

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
  if (isRecord(rawCommandInput) == false) {
    throw new Error('Sync command input must be an object.');
  }

  const commandInput: SyncCommandInput = {
    dryRun: readRequiredBoolean(rawCommandInput, 'dryRun'),
    allowDestructive: readRequiredBoolean(rawCommandInput, 'allowDestructive'),
    yes: readRequiredBoolean(rawCommandInput, 'yes'),
    snapshot: readRequiredBoolean(rawCommandInput, 'snapshot'),
  };
  const appName = readOptionalString(rawCommandInput, 'app');

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const SyncCommandInputSchema = decodeSyncCommandInput;
