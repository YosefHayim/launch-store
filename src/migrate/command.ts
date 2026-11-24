// Imports an Expo Application Services or Fastlane project into Launch files.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config/config.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { MigrationNote, MigrationNoteLevel, MigrationResult } from '../types/migrate.ts';
import { migrateEas } from './expo-application-services.ts';
import { migrateFastlane } from './fastlane.ts';
import { renderReport } from './report.ts';
import { writeArtifacts } from './write.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

const REPORT_FILE = 'migration-report.md';

type MigrateCommandInput = {
  source: 'eas' | 'fastlane';
  force: boolean;
  dryRun: boolean;
  out?: string;
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

  if (typeof field == 'undefined') {
    return null;
  }

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function readMigrationSource(record: Record<string, unknown>): MigrateCommandInput['source'] {
  const field = record['source'];

  const isEas = field == 'eas';

  if (isEas) {
    return 'eas';
  }

  const isFastlane = field == 'fastlane';

  if (isFastlane) {
    return 'fastlane';
  }

  throw new Error('source must be eas or fastlane');
}

function decodeMigrateCommandInput(rawCommandInput: unknown): MigrateCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Migrate command input must be an object.');
  }

  const commandInput: MigrateCommandInput = {
    source: readMigrationSource(rawCommandInputObject),
    force: readRequiredBoolean(rawCommandInputObject, 'force'),
    dryRun: readRequiredBoolean(rawCommandInputObject, 'dryRun'),
  };
  const outputDirectory = readOptionalString(rawCommandInputObject, 'out');

  if (outputDirectory != null) {
    commandInput.out = outputDirectory;
  }

  return commandInput;
}

export const MigrateCommandInputSchema = decodeMigrateCommandInput;

async function readMigration(
  source: MigrateCommandInput['source'],
  workingDirectory: string,
  apps: AppDescriptor[],
): Promise<MigrationResult> {
  if (source == 'eas') {
    return migrateEas(workingDirectory, apps);
  }

  return migrateFastlane(workingDirectory, apps);
}

function printNote(logger: Logger, migrationNote: MigrationNote): void {
  const level: MigrationNoteLevel = migrationNote.level;

  if (level == 'mapped') {
    logger.ok(migrationNote.message);
    return;
  }

  if (level == 'manual') {
    logger.warn(migrationNote.message);
    return;
  }

  if (level == 'skipped') {
    logger.skip(migrationNote.message);
    return;
  }

  logger.note(migrationNote.message);
}

function printMigrationNotes(logger: Logger, notes: readonly MigrationNote[]): void {
  for (const migrationNote of notes) {
    printNote(logger, migrationNote);
  }
}

async function previewMigration(
  logger: Logger,
  migration: MigrationResult,
  outputDirectory: string,
  force: boolean,
): Promise<void> {
  const writeOutcome = await writeArtifacts(migration, {
    outDir: outputDirectory,
    force,
    dryRun: true,
  });

  for (const writtenPath of writeOutcome.written) {
    logger.step('would write', writtenPath);
  }

  for (const skippedPath of writeOutcome.skipped) {
    logger.tip(`${skippedPath} exists - re-run with --force to overwrite`);
  }

  logger.note(`Dry run - nothing written. ${REPORT_FILE} would summarize this migration.`);
}

function wroteLine(writtenPath: string): string {
  return `[OK] wrote ${writtenPath}`;
}

function keptLine(skippedPath: string): string {
  return `[SKIP] kept ${skippedPath} (exists - use --force to overwrite)`;
}

async function persistMigration(
  logger: Logger,
  migration: MigrationResult,
  outputDirectory: string,
  force: boolean,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });

  const writeOutcome = await writeArtifacts(migration, {
    outDir: outputDirectory,
    force,
    dryRun: false,
  });
  const reportMarkdown = renderReport(migration);

  const joinedPath = join(outputDirectory, REPORT_FILE);

  await writeFile(joinedPath, reportMarkdown);

  const receiptLines = [
    ...writeOutcome.written.map(wroteLine),
    ...writeOutcome.skipped.map(keptLine),
    `[OK] wrote ${REPORT_FILE}`,
  ];
  let receiptTitle = 'Migrated';

  const keptExistingFiles = writeOutcome.skipped.length > 0;

  if (keptExistingFiles) {
    receiptTitle = 'Migrated (some files kept)';
  }

  logger.box(receiptTitle, receiptLines);
  logger.tip('Review the files, then run a build when the setup looks right.');
}

export async function migrateCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeMigrateCommandInput(rawCommandInput);
    const launchPaths = readLaunchDirectories();
    const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
    const migration = await readMigration(
      commandInput.source,
      launchPaths.workingDirectory,
      loadedConfiguration.apps,
    );
    const logger = createLogger(false);

    printMigrationNotes(logger, migration.notes);
    logger.gap();

    let outputDirectory = launchPaths.workingDirectory;

    if (commandInput.out != null) {
      outputDirectory = commandInput.out;
    }

    if (commandInput.dryRun) {
      await previewMigration(logger, migration, outputDirectory, commandInput.force);
      return;
    }

    await persistMigration(logger, migration, outputDirectory, commandInput.force);
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    throw new Error(failureMessage, { cause });
  }
}
