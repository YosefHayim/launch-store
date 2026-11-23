import { writeFile } from 'node:fs/promises';
import { createLogger } from '../services/platform/logger.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';
import { isCommandExit } from '../terminal/command-exit.ts';
import type { CaptureReport, Snapshot } from '../types/snapshot.ts';
import { createSnapshot, type CreateCommand } from './create-snapshot.ts';
import { diffSnapshot, type DiffCommand } from './diff-snapshot.ts';
import { pruneUserSnapshots, type PruneOptions } from './prune-snapshots.ts';
import { restoreSnapshot, type RestoreCommand } from './restore-snapshot.ts';
import { snapshotFailure } from './snapshot-failure.ts';
import { reportMissingSnapshot } from './snapshot-report.ts';
import { deleteSnapshot, listSnapshots, loadSnapshot } from './store.ts';

type ListCommand = {
  operation: 'list';
  json?: boolean;
};

type ExportCommand = {
  operation: 'export';
  name: string;
  out?: string;
};

type DeleteCommand = {
  operation: 'delete';
  name: string;
  json?: boolean;
};

type PruneCommand = {
  operation: 'prune';
  options: PruneOptions;
};

type SnapshotCommandInput =
  | CreateCommand
  | ListCommand
  | DiffCommand
  | ExportCommand
  | DeleteCommand
  | PruneCommand
  | RestoreCommand;

function readExactOptionalString(record: Record<string, unknown>, key: string): string | null {
  if (Object.hasOwn(record, key) == false) {
    return null;
  }

  const field = record[key];

  if (typeof field != 'string') {
    throw new Error(`Snapshot command ${key} must be a string.`);
  }

  return field;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const text = readExactOptionalString(record, key);

  if (text == null) {
    throw new Error(`Snapshot command ${key} is required.`);
  }

  return text;
}

function readExactOptionalBoolean(record: Record<string, unknown>, key: string): boolean | null {
  if (Object.hasOwn(record, key) == false) {
    return null;
  }

  const field = record[key];

  if (typeof field != 'boolean') {
    throw new Error(`Snapshot command ${key} must be a boolean.`);
  }

  return field;
}

function readPruneOptions(record: Record<string, unknown>): PruneOptions {
  const options = record['options'];

  const optionsObject = readPlainObject(options);

  if (optionsObject == null) {
    throw new Error('Snapshot command prune options are missing.');
  }

  const pruneOptions: PruneOptions = {};
  const keep = readExactOptionalString(optionsObject, 'keep');
  const olderThan = readExactOptionalString(optionsObject, 'olderThan');
  const yes = readExactOptionalBoolean(optionsObject, 'yes');
  const json = readExactOptionalBoolean(optionsObject, 'json');

  if (keep != null) {
    pruneOptions.keep = keep;
  }

  if (olderThan != null) {
    pruneOptions.olderThan = olderThan;
  }

  if (yes != null) {
    pruneOptions.yes = yes;
  }

  if (json != null) {
    pruneOptions.json = json;
  }

  return pruneOptions;
}

function decodeCreate(record: Record<string, unknown>): CreateCommand {
  const command: CreateCommand = { operation: 'create' };
  const name = readExactOptionalString(record, 'name');
  const app = readExactOptionalString(record, 'app');
  const json = readExactOptionalBoolean(record, 'json');

  if (name != null) {
    command.name = name;
  }

  if (app != null) {
    command.app = app;
  }

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeList(record: Record<string, unknown>): ListCommand {
  const command: ListCommand = { operation: 'list' };
  const json = readExactOptionalBoolean(record, 'json');

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeDiff(record: Record<string, unknown>): DiffCommand {
  const command: DiffCommand = {
    operation: 'diff',
    baseline: readRequiredString(record, 'baseline'),
    against: readRequiredString(record, 'against'),
  };
  const app = readExactOptionalString(record, 'app');
  const json = readExactOptionalBoolean(record, 'json');

  if (app != null) {
    command.app = app;
  }

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeExport(record: Record<string, unknown>): ExportCommand {
  const command: ExportCommand = {
    operation: 'export',
    name: readRequiredString(record, 'name'),
  };
  const out = readExactOptionalString(record, 'out');

  if (out != null) {
    command.out = out;
  }

  return command;
}

function decodeDelete(record: Record<string, unknown>): DeleteCommand {
  const command: DeleteCommand = {
    operation: 'delete',
    name: readRequiredString(record, 'name'),
  };
  const json = readExactOptionalBoolean(record, 'json');

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodePrune(record: Record<string, unknown>): PruneCommand {
  return { operation: 'prune', options: readPruneOptions(record) };
}

function decodeRestore(record: Record<string, unknown>): RestoreCommand {
  const command: RestoreCommand = {
    operation: 'restore',
    name: readRequiredString(record, 'name'),
  };
  const app = readExactOptionalString(record, 'app');
  const source = readExactOptionalString(record, 'source');
  const yes = readExactOptionalBoolean(record, 'yes');
  const json = readExactOptionalBoolean(record, 'json');

  if (app != null) {
    command.app = app;
  }

  if (source != null) {
    command.source = source;
  }

  if (yes != null) {
    command.yes = yes;
  }

  if (json != null) {
    command.json = json;
  }

  return command;
}

function decodeSnapshotCommandInput(rawCommand: unknown): SnapshotCommandInput {
  const rawCommandObject = readPlainObject(rawCommand);

  if (rawCommandObject == null) {
    throw new Error('Snapshot command input is malformed.');
  }

  const operation = rawCommandObject['operation'];

  if (operation == 'create') {
    return decodeCreate(rawCommandObject);
  }

  if (operation == 'list') {
    return decodeList(rawCommandObject);
  }

  if (operation == 'diff') {
    return decodeDiff(rawCommandObject);
  }

  if (operation == 'export') {
    return decodeExport(rawCommandObject);
  }

  if (operation == 'delete') {
    return decodeDelete(rawCommandObject);
  }

  if (operation == 'prune') {
    return decodePrune(rawCommandObject);
  }

  if (operation == 'restore') {
    return decodeRestore(rawCommandObject);
  }

  throw new Error('Snapshot command operation is unknown.');
}

export const SnapshotCommandInputSchema = decodeSnapshotCommandInput;

export function countEntities(snapshot: Snapshot): number {
  let entityCount = 0;

  for (const captureReport of snapshot.reports) {
    entityCount += capturedEntityCount(captureReport);
  }

  return entityCount;
}

function capturedEntityCount(captureReport: CaptureReport): number {
  if (captureReport.outcome.state != 'captured') {
    return 0;
  }

  let entityCount = 0;

  for (const appEntities of captureReport.outcome.apps) {
    entityCount += appEntities.entities.length;
  }

  return entityCount;
}

async function exportSnapshot(command: ExportCommand): Promise<void> {
  const logger = createLogger(false);
  const savedSnapshot = await loadSnapshot(command.name);

  if (savedSnapshot == null) {
    reportMissingSnapshot(logger, command.name);

    return;
  }

  const snapshotJson = JSON.stringify(savedSnapshot, null, 2);

  if (command.out == null) {
    logger.line(snapshotJson);

    return;
  }

  try {
    await writeFile(command.out, snapshotJson);
  } catch (cause) {
    throw snapshotFailure('write snapshot export', cause);
  }

  logger.note(`Exported "${command.name}" to ${command.out}`);
}

async function listSavedSnapshots(json: boolean | undefined): Promise<void> {
  const logger = createLogger(false);
  const savedSnapshots = await listSnapshots();

  if (json == true) {
    const serialized = JSON.stringify(
      savedSnapshots.map(function listEntry(savedSnapshot) {
        return {
          name: savedSnapshot.name,
          capturedAt: savedSnapshot.capturedAt,
          entityCount: countEntities(savedSnapshot),
        };
      }),
      null,
      2,
    );

    logger.line(serialized);

    return;
  }

  if (savedSnapshots.length == 0) {
    logger.note('No snapshots yet. Capture one with `launch-store snapshot create`.');

    return;
  }

  for (const savedSnapshot of savedSnapshots) {
    const entities = countEntities(savedSnapshot);

    logger.step(
      'snapshot',
      `${savedSnapshot.name} - ${savedSnapshot.capturedAt} - ${entities} item(s)`,
    );
  }
}

async function removeSnapshot(command: DeleteCommand): Promise<void> {
  const logger = createLogger(false);
  const savedSnapshot = await loadSnapshot(command.name);

  if (savedSnapshot == null) {
    reportMissingSnapshot(logger, command.name);

    return;
  }

  const deleted = await deleteSnapshot(command.name);

  if (command.json == true) {
    const serialized = JSON.stringify({ deleted, name: command.name }, null, 2);
    logger.line(serialized);

    return;
  }

  logger.note(`Deleted snapshot "${command.name}".`);
}

async function executeSnapshotCommand(command: SnapshotCommandInput): Promise<void> {
  switch (command.operation) {
    case 'create':
      await createSnapshot(command);
      return;
    case 'list':
      await listSavedSnapshots(command.json);
      return;
    case 'diff':
      await diffSnapshot(command);
      return;
    case 'export':
      await exportSnapshot(command);
      return;
    case 'delete':
      await removeSnapshot(command);
      return;
    case 'prune':
      await pruneUserSnapshots(command.options);
      return;
    case 'restore':
      await restoreSnapshot(command);
      return;
  }
}

export async function snapshotCommandProgram(rawCommand: unknown): Promise<void> {
  try {
    const command = decodeSnapshotCommandInput(rawCommand);
    await executeSnapshotCommand(command);
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isFailureTag(cause, 'SnapshotCommandFailure')) {
      throw cause;
    }

    throw snapshotFailure('run snapshot command', cause);
  }
}
