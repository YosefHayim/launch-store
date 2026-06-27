/**
 * `launch migrate` — onboard an existing Expo/EAS (later: fastlane) project by reading its config files
 * and emitting the equivalent Launch setup. The file-based counterpart to `launch adopt` (which imports
 * from a *live* App Store Connect account): `migrate` reads `eas.json`/`app.json` off disk and is
 * read-only against both stores. The strongest adoption hook — "run one command, get the equivalent
 * Launch config + a report of what to finish by hand."
 *
 * Thin glue over `core/migrate`: discover apps → run the source's migrate → render notes → write the
 * artifacts (overwrite-guarded) + the report. A second source (fastlane, #172) adds a sibling subcommand
 * here and reuses `report.ts`/`write.ts` unchanged. See issue #171.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import type { Logger } from '../../core/logger.js';
import { migrateEas } from '../../core/migrate/eas.js';
import { migrateFastlane } from '../../core/migrate/fastlane.js';
import { renderReport } from '../../core/migrate/report.js';
import { writeArtifacts } from '../../core/migrate/write.js';
import type { AppDescriptor } from '../../core/types.js';
import type {
  MigrationNote,
  MigrationNoteLevel,
  MigrationResult,
} from '../../core/migrate/types.js';

/** The generated report's filename, always (re)written — it's a regenerable summary, not a user file. */
const REPORT_FILE = 'migration-report.md';

/** Leading glyph per note level for terminal output, matching the report's vocabulary. */
const NOTE_GLYPH: Record<MigrationNoteLevel, string> = {
  mapped: '✓',
  manual: '~',
  skipped: '•',
  info: 'ⓘ',
};

/** CLI options for the migrate subcommands. */
interface MigrateOptions {
  /** Overwrite files that already exist (default: keep them, report them as kept). */
  force?: boolean;
  /** Print what would be written without writing anything. */
  dryRun?: boolean;
  /** Write the migrated files here instead of the current directory. */
  out?: string;
}

/** Print the migration notes: manual items as warnings (they need action), everything else as info. */
function renderNotes(log: Logger, notes: MigrationNote[]): void {
  for (const note of notes) {
    if (note.level === 'manual') log.warn(note.message);
    else log.info(`${NOTE_GLYPH[note.level]} ${note.message}`);
  }
}

/** A source's migrate function: read its config files at `cwd` and return the artifacts + report. */
type Migrator = (cwd: string, apps: AppDescriptor[]) => MigrationResult | Promise<MigrationResult>;

/**
 * Run one migration source end to end: discover apps, run its migrator, print the notes, then either
 * preview (`--dry-run`) or write the artifacts + report. Shared by every subcommand — `eas` and
 * `fastlane` differ only by the `migrate` they pass in. A missing/invalid source config exits non-zero
 * with the migrator's own message.
 */
async function runMigration(migrate: Migrator, options: MigrateOptions): Promise<void> {
  const log = createLogger(false);
  const cwd = process.cwd();
  const { apps } = await loadConfig();

  let result: MigrationResult;
  try {
    result = await migrate(cwd, apps);
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const outDir = options.out ?? cwd;
  const force = options.force ?? false;
  renderNotes(log, result.notes);
  log.gap();

  if (options.dryRun === true) {
    const { written, skipped } = writeArtifacts(result, { outDir, force, dryRun: true });
    for (const path of written) log.step('would write', path);
    for (const path of skipped) log.tip(`${path} exists — re-run with --force to overwrite`);
    log.info(`Dry run — nothing written. ${REPORT_FILE} would summarize this migration.`);
    return;
  }

  const { written, skipped } = writeArtifacts(result, { outDir, force });
  writeFileSync(join(outDir, REPORT_FILE), renderReport(result));

  const rows = [
    ...written.map((path) => `✓ wrote ${path}`),
    ...skipped.map((path) => `• kept ${path} (exists — use --force to overwrite)`),
    `✓ wrote ${REPORT_FILE}`,
  ];
  log.box(skipped.length > 0 ? 'Migrated (some files kept)' : 'Migrated', rows);
  log.tip('Review the files, then run `launch doctor` to check your setup.');
}

/** Attach the `migrate` command group and its per-source subcommands (`eas`, `fastlane`) to the program. */
export function registerMigrateCommand(program: Command): void {
  const migrate = program
    .command('migrate')
    .description('import an existing EAS or fastlane setup into a Launch config');

  migrate
    .command('eas')
    .description(
      'read eas.json/app.json and emit launch.config.ts, .env.example, store.config.json + a report',
    )
    .option('--force', 'overwrite files that already exist', false)
    .option('--dry-run', 'print what would be written without writing anything', false)
    .option(
      '--out <dir>',
      'write the migrated files to this directory (default: current directory)',
    )
    .action(async (options: MigrateOptions) => {
      await runMigration(migrateEas, options);
    });

  migrate
    .command('fastlane')
    .description(
      'read fastlane config (Appfile/Fastfile/Matchfile…) and emit launch.config.ts, .env.example, store.config.json + a report',
    )
    .option('--force', 'overwrite files that already exist', false)
    .option('--dry-run', 'print what would be written without writing anything', false)
    .option(
      '--out <dir>',
      'write the migrated files to this directory (default: current directory)',
    )
    .action(async (options: MigrateOptions) => {
      await runMigration(migrateFastlane, options);
    });
}
