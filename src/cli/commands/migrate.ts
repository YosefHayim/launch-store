import type { Command } from 'commander';
import { migrateCommandProgram } from '@core/migrate/command.js';
import { runCliProgram } from '../runCliProgram.js';

type MigrateOptions = Readonly<{
  force: boolean;
  dryRun: boolean;
  out?: string;
}>;

export const registerMigrateCommand = (program: Command): void => {
  const migrateCommand = program
    .command('migrate')
    .description('import an existing EAS or fastlane setup into a Launch config');
  migrateCommand
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
    .action((commandOptions: MigrateOptions) =>
      runCliProgram(
        migrateCommandProgram({
          source: 'eas',
          force: commandOptions.force,
          dryRun: commandOptions.dryRun,
          out: commandOptions.out,
        }),
      ),
    );
  migrateCommand
    .command('fastlane')
    .description(
      'read fastlane config (Appfile/Fastfile/Matchfile...) and emit launch.config.ts, .env.example, store.config.json + a report',
    )
    .option('--force', 'overwrite files that already exist', false)
    .option('--dry-run', 'print what would be written without writing anything', false)
    .option(
      '--out <dir>',
      'write the migrated files to this directory (default: current directory)',
    )
    .action((commandOptions: MigrateOptions) =>
      runCliProgram(
        migrateCommandProgram({
          source: 'fastlane',
          force: commandOptions.force,
          dryRun: commandOptions.dryRun,
          out: commandOptions.out,
        }),
      ),
    );
};
