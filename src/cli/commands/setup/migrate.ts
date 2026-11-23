// Registers the commands that import an Expo or fastlane project into the Launch config.

import type { Command } from '@/cli/command.js';
import { migrateCommandProgram } from '@/migrate/command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type MigrateOptions = Readonly<{
  force: boolean;
  dryRun: boolean;
  out?: string;
}>;

export function registerMigrateCommand(program: Command): void {
  const migrateCommand = program
    .command('migrate')
    .description('import an existing EAS or fastlane setup into a Launch config');

  function runEas(commandOptions: MigrateOptions) {
    const migrateProgram = migrateCommandProgram({
      source: 'eas',
      force: commandOptions.force,
      dryRun: commandOptions.dryRun,
      out: commandOptions.out,
    });

    return runCliProgram(migrateProgram);
  }

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
    .action(runEas);

  function runFastlane(commandOptions: MigrateOptions) {
    const migrateProgram = migrateCommandProgram({
      source: 'fastlane',
      force: commandOptions.force,
      dryRun: commandOptions.dryRun,
      out: commandOptions.out,
    });

    return runCliProgram(migrateProgram);
  }

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
    .action(runFastlane);
}
