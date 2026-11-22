import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { selectStoreApp } from '../store/shared/select-store-app.ts';
import {
  listSecretRefs,
  removeBuildSecret,
  setBuildSecret,
  type SecretRef,
} from './build-secrets.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type SecretListInput = Readonly<{
  action: 'list' | 'status';
  app?: string;
  profile?: string;
}>;

type SecretSetInput = Readonly<{
  action: 'set';
  name?: string;
  value?: string;
  yes: boolean;
  app?: string;
  profile?: string;
}>;

type SecretRemoveInput = Readonly<{
  action: 'rm' | 'remove';
  name?: string;
  app?: string;
  profile?: string;
}>;

type SecretCommandInput = SecretListInput | SecretSetInput | SecretRemoveInput;

type SecretCommandFailure = Readonly<{
  readonly _tag: 'SecretCommandFailure';
  readonly action: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeSecretCommandFailure(fields: {
  action: string;
  message: string;
  cause?: unknown;
}): SecretCommandFailure {
  const hasCause = fields.cause != null;

  if (hasCause) {
    return {
      _tag: 'SecretCommandFailure',
      action: fields.action,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return { _tag: 'SecretCommandFailure', action: fields.action, message: fields.message };
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const hasKey = Object.hasOwn(record, key);

  if (hasKey == false) {
    return undefined;
  }

  const field = record[key];
  const isMissing = field == null;

  if (isMissing) {
    return undefined;
  }

  const isString = typeof field == 'string';

  if (isString == false) {
    throw new Error(`Secret command ${key} must be a string.`);
  }

  return field;
}

function assignOptional(
  target: { app?: string; profile?: string },
  record: Record<string, unknown>,
): void {
  const appName = readOptionalString(record, 'app');
  const hasApp = appName != null;

  if (hasApp) {
    target.app = appName;
  }

  const profileName = readOptionalString(record, 'profile');
  const hasProfile = profileName != null;

  if (hasProfile) {
    target.profile = profileName;
  }
}

function isListAction(action: unknown): action is 'list' | 'status' {
  if (action == 'list') {
    return true;
  }

  return action == 'status';
}

function isRemoveAction(action: unknown): action is 'rm' | 'remove' {
  if (action == 'rm') {
    return true;
  }

  return action == 'remove';
}

function createSecretSetInput(secretDraft: {
  yes: boolean;
  name: string | undefined;
  value: string | undefined;
}): SecretSetInput {
  const setInput: {
    action: 'set';
    yes: boolean;
    name?: string;
    value?: string;
  } = { action: 'set', yes: secretDraft.yes };
  const secretName = secretDraft.name;

  if (typeof secretName == 'string') {
    setInput.name = secretName;
  }

  const secretText = secretDraft.value;

  if (typeof secretText == 'string') {
    setInput.value = secretText;
  }

  return setInput;
}

function createSecretRemoveInput(secretDraft: {
  action: 'rm' | 'remove';
  name: string | undefined;
}): SecretRemoveInput {
  const removeInput: {
    action: 'rm' | 'remove';
    name?: string;
  } = { action: secretDraft.action };
  const secretName = secretDraft.name;

  if (typeof secretName == 'string') {
    removeInput.name = secretName;
  }

  return removeInput;
}

/** Decode one build-secret command. Omitted optionals stay absent. */
export function decodeSecretCommandInput(rawCommandInput: unknown): SecretCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Secret command input must be an object.');
  }

  const action = rawCommandInputObject['action'];
  const isList = isListAction(action);

  if (isList) {
    const listInput: SecretListInput = { action };
    assignOptional(listInput, rawCommandInputObject);
    return listInput;
  }

  const isSet = action == 'set';

  if (isSet) {
    const yes = rawCommandInputObject['yes'];
    const yesIsBoolean = typeof yes == 'boolean';

    if (yesIsBoolean == false) {
      throw new Error('Secret set yes must be a boolean.');
    }

    const secretName = readOptionalString(rawCommandInputObject, 'name');
    const secretText = readOptionalString(rawCommandInputObject, 'value');
    const setInput = createSecretSetInput({ yes, name: secretName, value: secretText });
    assignOptional(setInput, rawCommandInputObject);
    return setInput;
  }

  const isRemove = isRemoveAction(action);

  if (isRemove) {
    const secretName = readOptionalString(rawCommandInputObject, 'name');
    const removeInput = createSecretRemoveInput({ action, name: secretName });
    assignOptional(removeInput, rawCommandInputObject);
    return removeInput;
  }

  const asString = String(action);
  throw new Error(`Unknown secret action "${asString}".`);
}

/** Render a secret reference's app-wide or profile-specific scope. */
function scopeLabel(secretReference: SecretRef): string {
  const isAppWide = secretReference.profile == null;

  if (isAppWide) {
    return 'all profiles';
  }

  return `profile ${secretReference.profile}`;
}

/** Build one secret coordinate from the selected app and optional profile. */
function makeSecretReference(
  appName: string,
  profileName: string | undefined,
  environmentName: string,
): SecretRef {
  let profile: string | null = null;
  const hasProfile = profileName != null;

  if (hasProfile) {
    profile = profileName;
  }

  return { app: appName, profile, name: environmentName };
}

const MISSING_SECRET_VALUE =
  'A value is required. Pass --value <v> or run in an interactive terminal without --yes.';

async function readSecretText(commandInput: SecretSetInput): Promise<string> {
  const providedSecret = commandInput.value;
  const secretIsMissing = providedSecret == null;

  if (secretIsMissing == false) {
    return providedSecret;
  }

  const assumesYes = commandInput.yes == true;

  if (assumesYes) {
    throw makeSecretCommandFailure({ action: 'set', message: MISSING_SECRET_VALUE });
  }

  const terminalIsInteractive = checkTerminalIsInteractive();

  if (terminalIsInteractive == false) {
    throw makeSecretCommandFailure({ action: 'set', message: MISSING_SECRET_VALUE });
  }

  const promptedSecret = await LaunchPrompt.requiredSecret(`Value for ${commandInput.name}`);

  return promptedSecret;
}

/** Store or overwrite one keychain-backed build secret. */
async function setSecretValue(commandInput: SecretSetInput): Promise<void> {
  const nameIsMissing = commandInput.name == null;

  if (nameIsMissing) {
    throw makeSecretCommandFailure({
      action: 'set',
      message: 'Usage: launch secret set <NAME> [--value <v>] [--app <app>] [--profile <profile>].',
    });
  }

  const nameIsValid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(commandInput.name);

  if (nameIsValid == false) {
    throw makeSecretCommandFailure({
      action: 'set',
      message: `"${commandInput.name}" is not a valid env var name (letters, digits, underscores).`,
    });
  }

  const selectedApp = await selectStoreApp(commandInput.app);
  const secretText = await readSecretText(commandInput);
  const secretReference = makeSecretReference(
    selectedApp.name,
    commandInput.profile,
    commandInput.name,
  );
  await setBuildSecret(secretReference, secretText);
  const logger = createLogger(false);
  logger.ok(
    `Stored ${commandInput.name} for ${selectedApp.name} - ${scopeLabel(secretReference)} - in the keychain.`,
  );
}

/** Remove one keychain-backed build secret. */
async function removeSecretValue(commandInput: SecretRemoveInput): Promise<void> {
  const nameIsMissing = commandInput.name == null;

  if (nameIsMissing) {
    throw makeSecretCommandFailure({
      action: commandInput.action,
      message: 'Usage: launch secret rm <NAME> [--app <app>] [--profile <profile>].',
    });
  }

  const selectedApp = await selectStoreApp(commandInput.app);
  const secretReference = makeSecretReference(
    selectedApp.name,
    commandInput.profile,
    commandInput.name,
  );
  const secretExisted = await removeBuildSecret(secretReference);
  const logger = createLogger(false);

  if (secretExisted) {
    logger.ok(
      `Removed ${commandInput.name} for ${selectedApp.name} - ${scopeLabel(secretReference)}.`,
    );
    return;
  }

  logger.skip(
    `No secret ${commandInput.name} for ${selectedApp.name} - ${scopeLabel(secretReference)}.`,
  );
}

/** List non-secret build-secret coordinates without reading their values. */
async function listSecrets(commandInput: SecretListInput): Promise<void> {
  const secretReferences = await listSecretRefs(commandInput.app);
  const logger = createLogger(false);
  const hasSecrets = secretReferences.length > 0;

  if (hasSecrets) {
    for (const secretReference of secretReferences) {
      logger.line(
        `- ${secretReference.app} - ${secretReference.name} (${scopeLabel(secretReference)})`,
      );
    }

    return;
  }

  const hasApp = commandInput.app != null;

  if (hasApp) {
    logger.skip(
      `No build secrets for ${commandInput.app}. Add one with: launch secret set <NAME> --app ${commandInput.app}`,
    );
    return;
  }

  logger.skip('No build secrets stored. Add one with: launch secret set <NAME>');
}

/** Run one decoded build-secret command. */
export async function secretCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeSecretCommandInput(rawCommandInput);

    switch (commandInput.action) {
      case 'list':
      case 'status':
        await listSecrets(commandInput);
        return;
      case 'set':
        await setSecretValue(commandInput);
        return;
      case 'rm':
      case 'remove':
        await removeSecretValue(commandInput);
        return;
    }
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw makeSecretCommandFailure({
      action: 'run',
      message: failureMessage,
      cause,
    });
  }
}
