import { errorMessage } from '../services/platform/errorMessage.js';
import { createLogger } from '../services/platform/logger.js';
import { openUrl, resolveOpenUrl } from './consoleLinks.js';

export interface OpenCommandInput {
  target?: string;
  platform?: string;
  app?: string;
}

type OpenCommandFailure = Readonly<{
  readonly _tag: 'OpenCommandFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

function makeOpenCommandFailure(fields: { message: string; cause: unknown }): OpenCommandFailure {
  return { _tag: 'OpenCommandFailure', message: fields.message, cause: fields.cause };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  if (candidate == null) {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function readOptionalText(record: Record<string, unknown>, fieldName: string): string | null {
  const fieldIsPresent = Object.hasOwn(record, fieldName);

  if (fieldIsPresent == false) {
    return null;
  }

  const fieldText = record[fieldName];

  if (typeof fieldText == 'string') {
    return fieldText;
  }

  throw new Error('Could not read the open command.');
}

export function readOpenCommandInput(rawCommandInput: unknown): OpenCommandInput {
  if (isRecord(rawCommandInput) == false) {
    throw new Error('Could not read the open command.');
  }

  const commandInput: OpenCommandInput = {};
  const target = readOptionalText(rawCommandInput, 'target');

  if (target != null) {
    commandInput.target = target;
  }

  const platform = readOptionalText(rawCommandInput, 'platform');

  if (platform != null) {
    commandInput.platform = platform;
  }

  const appText = readOptionalText(rawCommandInput, 'app');

  if (appText != null) {
    commandInput.app = appText;
  }

  return commandInput;
}

export async function openCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = readOpenCommandInput(rawCommandInput);
    const openOptions: { platform?: string; app?: string } = {};

    if (commandInput.platform != null) {
      openOptions.platform = commandInput.platform;
    }

    if (commandInput.app != null) {
      openOptions.app = commandInput.app;
    }

    const consoleUrl = await resolveOpenUrl(commandInput.target, openOptions);
    const logger = createLogger(false);
    logger.line(`Opening ${consoleUrl}`);
    await openUrl(consoleUrl);
  } catch (cause) {
    throw makeOpenCommandFailure({ message: errorMessage(cause), cause });
  }
}
