import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { failCommand } from './credentials-failure.ts';

export function firstDefinedText(
  ...candidates: readonly (string | undefined)[]
): string | undefined {
  for (const candidate of candidates) {
    if (candidate != null) {
      return candidate;
    }
  }

  return undefined;
}

export function commandCanPrompt(commandOptions: CredentialsCommandOptions): boolean {
  if (commandOptions.yes == true) {
    return false;
  }

  return process.stdout.isTTY == true;
}

function suppliedText(supplied: string | undefined): string | null {
  if (supplied == null) {
    return null;
  }

  const trimmed = supplied.trim();

  if (trimmed.length == 0) {
    return null;
  }

  return trimmed;
}

export async function requireText(
  supplied: string | undefined,
  promptMessage: string,
  nonInteractiveMessage: string,
  canPrompt: boolean,
): Promise<string> {
  const trimmed = suppliedText(supplied);

  if (trimmed != null) {
    return trimmed;
  }

  if (canPrompt == false) {
    failCommand('read credentials input', nonInteractiveMessage);
  }

  const entered = await LaunchPrompt.requiredText(promptMessage);

  return entered.trim();
}
