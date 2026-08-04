import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import type { MigrationNote, MigrationResult } from '../types/migrate.js';
import { migrateEas } from './eas.js';
import { migrateFastlane } from './fastlane.js';
import { renderReport } from './report.js';
import { writeArtifacts } from './write.js';

const REPORT_FILE = 'migration-report.md';

export const MigrateCommandInputSchema = Schema.Struct({
  source: Schema.Literal('eas', 'fastlane'),
  force: Schema.Boolean,
  dryRun: Schema.Boolean,
  out: Schema.optional(Schema.String),
});

export type MigrateCommandInput = Schema.Schema.Type<typeof MigrateCommandInputSchema>;

export type MigrateCommandFailure = Readonly<{
  readonly _tag: 'MigrateCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeMigrateCommandFailure =
  Data.tagged<MigrateCommandFailure>('MigrateCommandFailure');

type MigrateCommandRequirements = FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path;

const readMigration = (
  source: MigrateCommandInput['source'],
  workingDirectory: string,
  apps: Parameters<typeof migrateEas>[1],
) => {
  switch (source) {
    case 'eas':
      return migrateEas(workingDirectory, apps);
    case 'fastlane':
      return migrateFastlane(workingDirectory, apps);
  }
};

const printMigrationNotes = (
  logger: Logger,
  notes: MigrationNote[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    for (const migrationNote of notes) {
      switch (migrationNote.level) {
        case 'mapped':
          yield* logger.ok(migrationNote.message);
          break;
        case 'manual':
          yield* logger.warn(migrationNote.message);
          break;
        case 'skipped':
          yield* logger.skip(migrationNote.message);
          break;
        case 'info':
          yield* logger.note(migrationNote.message);
          break;
      }
    }
  });

const previewMigration = (
  migration: MigrationResult,
  outputDirectory: string,
  force: boolean,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Logger | Path.Path> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const writeOutcome = yield* writeArtifacts(migration, {
      outDir: outputDirectory,
      force,
      dryRun: true,
    });
    for (const writtenPath of writeOutcome.written) {
      yield* logger.step('would write', writtenPath);
    }
    for (const skippedPath of writeOutcome.skipped) {
      yield* logger.tip(`${skippedPath} exists - re-run with --force to overwrite`);
    }
    yield* logger.note(`Dry run - nothing written. ${REPORT_FILE} would summarize this migration.`);
  });

const persistMigration = (
  migration: MigrationResult,
  outputDirectory: string,
  force: boolean,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Logger | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const logger = yield* createLogger(false);
    yield* fileSystem.makeDirectory(outputDirectory, { recursive: true });
    const writeOutcome = yield* writeArtifacts(migration, {
      outDir: outputDirectory,
      force,
      dryRun: false,
    });
    const reportMarkdown = yield* renderReport(migration);
    yield* fileSystem.writeFileString(
      pathService.join(outputDirectory, REPORT_FILE),
      reportMarkdown,
    );
    const receiptLines = [
      ...writeOutcome.written.map((writtenPath) => `[OK] wrote ${writtenPath}`),
      ...writeOutcome.skipped.map(
        (skippedPath) => `[SKIP] kept ${skippedPath} (exists - use --force to overwrite)`,
      ),
      `[OK] wrote ${REPORT_FILE}`,
    ];
    let receiptTitle = 'Migrated';
    if (writeOutcome.skipped.length > 0) receiptTitle = 'Migrated (some files kept)';
    yield* logger.box(receiptTitle, receiptLines);
    yield* logger.tip('Review the files, then run `launch doctor` to check your setup.');
  });

export const migrateCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, MigrateCommandFailure, MigrateCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(MigrateCommandInputSchema)(rawCommandInput);
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const migration = yield* readMigration(
      commandInput.source,
      launchPaths.workingDirectory,
      loadedConfiguration.apps,
    );
    const logger = yield* createLogger(false);
    yield* printMigrationNotes(logger, migration.notes);
    yield* logger.gap();
    let outputDirectory = launchPaths.workingDirectory;
    if (commandInput.out !== undefined) outputDirectory = commandInput.out;
    if (commandInput.dryRun) {
      return yield* previewMigration(migration, outputDirectory, commandInput.force);
    }
    return yield* persistMigration(migration, outputDirectory, commandInput.force);
  }).pipe(
    Effect.mapError((cause) => {
      return makeMigrateCommandFailure({
        operation: 'migrate project configuration',
        message: errorMessage(cause),
        cause,
      });
    }),
  );
