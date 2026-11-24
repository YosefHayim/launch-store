// Imports, lists, and exports Apple push notification keys for the credentials command.

import { readFile, writeFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { AccountRecord } from '../types/credentials.ts';
import { getActiveAccount } from './accounts.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { displayPath, expandHomePath } from './credentials-paths.ts';
import { commandCanPrompt, firstDefinedText, requireText } from './credentials-prompt.ts';
import { extractKeyId, reconcileKeyId } from './key-files.ts';
import { findPushKey, importPushKey, listPushKeys, loadPushKey } from './push-key-store.ts';

async function showPushKeys(): Promise<void> {
  const logger = createLogger(false);
  const pushKeys = await listPushKeys();

  if (pushKeys.length == 0) {
    logger.line('No APNs keys in the vault.');

    return;
  }

  for (const pushKey of pushKeys) {
    const details: string[] = [];

    const hasDistinctLabel = pushKey.label != null;

    if (hasDistinctLabel) {
      const labelDiffers = pushKey.label != pushKey.keyId;

      if (labelDiffers) {
        details.push(pushKey.label);
      }
    }

    if (pushKey.teamId != null) {
      details.push(`team ${pushKey.teamId}`);
    }

    let detailText = '';

    const hasDetails = details.length > 0;

    if (hasDetails) {
      detailText = ` - ${details.join(' - ')}`;
    }

    logger.line(`- ${pushKey.keyId}${detailText}`);
  }
}

function pickTeamId(
  commandTeamId: string | undefined,
  activeAccount: AccountRecord | null,
): string | undefined {
  if (commandTeamId != null) {
    return commandTeamId;
  }

  if (activeAccount == null) {
    return undefined;
  }

  return activeAccount.teamId;
}

async function importApnsKey(
  pathArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const canPrompt = commandCanPrompt(commandOptions);
  const firstDefined = firstDefinedText(pathArgument, commandOptions.p8);
  const enteredPath = await requireText(
    firstDefined,
    'Path to the APNs .p8 key',
    'Pass the APNs .p8 path.',
    canPrompt,
  );
  const keyPath = expandHomePath(enteredPath);
  const keyExists = await pathExists(keyPath);

  if (keyExists == false) {
    throw new Error(`No .p8 file at ${enteredPath}.`);
  }

  const filenameKeyId = extractKeyId(keyPath);
  let keyId = reconcileKeyId(commandOptions.keyId, filenameKeyId);

  keyId = await requireText(
    keyId,
    'APNs Key ID',
    'Pass --key-id <id> or name the file AuthKey_<KEYID>.p8.',
    canPrompt,
  );

  const activeAccount = await getActiveAccount();
  const teamId = pickTeamId(commandOptions.teamId, activeAccount);
  let keyLabel = commandOptions.label;

  if (keyLabel == null) {
    keyLabel = keyId;
  }

  const p8 = await readFile(keyPath, 'utf8');
  const importRequest: {
    keyId: string;
    p8: string;
    label: string;
    teamId?: string;
  } = { keyId, p8, label: keyLabel };

  if (teamId != null) {
    importRequest.teamId = teamId;
  }

  await importPushKey(importRequest);

  const logger = createLogger(false);

  logger.ok(`Imported APNs key ${keyId}.`);
  logger.warn(`Keep ${displayPath(keyPath)}; Apple permits only one download.`);
}

function blocksKeyOverwrite(outputExists: boolean, force: boolean | undefined): boolean {
  if (outputExists == false) {
    return false;
  }

  return force != true;
}

async function exportApnsKey(
  keyIdArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (keyIdArgument == null) {
    throw new Error('Usage: launch-store creds push-key export <keyId> --out <path>.');
  }

  const keyRecord = await findPushKey(keyIdArgument);

  if (keyRecord == null) {
    throw new Error(`No APNs key "${keyIdArgument}" exists.`);
  }

  const p8 = await loadPushKey(keyRecord.keyId);

  if (p8 == null) {
    throw new Error(`APNs key ${keyRecord.keyId} has no stored secret.`);
  }

  const canPrompt = commandCanPrompt(commandOptions);
  const enteredPath = await requireText(
    commandOptions.out,
    'Write the APNs .p8 to',
    'Pass --out <path>.',
    canPrompt,
  );
  const outputPath = expandHomePath(enteredPath);
  const outputExists = await pathExists(outputPath);

  if (blocksKeyOverwrite(outputExists, commandOptions.force)) {
    throw new Error(`${displayPath(outputPath)} already exists. Pass --force to overwrite.`);
  }

  if (canPrompt) {
    const confirmed = await new LaunchPrompt().confirm(
      `Write secret APNs key ${keyRecord.keyId} to ${displayPath(outputPath)}?`,
    );

    if (confirmed == false) {
      return;
    }
  }

  const privateFileMode = 0o600;

  await writeFile(outputPath, p8, { mode: privateFileMode });
  createLogger(false).ok(`Wrote APNs key ${keyRecord.keyId} to ${displayPath(outputPath)}.`);
}

export async function runPushKeyAction(
  pushAction: string | undefined,
  keyArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (pushAction == null) {
    await showPushKeys();

    return;
  }

  if (pushAction == 'status') {
    await showPushKeys();

    return;
  }

  if (pushAction == 'import') {
    await importApnsKey(keyArgument, commandOptions);

    return;
  }

  if (pushAction == 'export') {
    await exportApnsKey(keyArgument, commandOptions);

    return;
  }

  throw new Error(`Unknown push-key action "${pushAction}". Use import, status, or export.`);
}
