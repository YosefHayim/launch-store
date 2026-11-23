// Registers commands that save, compare, and restore live App Store and Google Play state.

import type { Command } from '../../command.ts';
import { snapshotCommandProgram } from '../../../snapshot/snapshot-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type CaptureOptions = Readonly<{ app?: string; json?: boolean }>;

type PruneOptions = Readonly<{
  keep?: string;
  olderThan?: string;
  yes?: boolean;
  json?: boolean;
}>;

type RestoreOptions = Readonly<{
  app?: string;
  source?: string;
  yes?: boolean;
  json?: boolean;
}>;

/** Attach the snapshot command family. */
export function registerSnapshotCommand(program: Command): void {
  const snapshotCommand = program
    .command('snapshot')
    .description('capture, diff, and export point-in-time copies of live store state (read-only)');

  function runCreateName(name: string | undefined, commandOptions: CaptureOptions) {
    if (name == null) {
      const snapshotProgram = snapshotCommandProgram({ operation: 'create', ...commandOptions });
      return runCliProgram(snapshotProgram);
    }

    const snapshotProgram = snapshotCommandProgram({
      operation: 'create',
      name,
      ...commandOptions,
    });

    return runCliProgram(snapshotProgram);
  }

  snapshotCommand
    .command('create [name]')
    .description('capture live App Store + Play state into a named snapshot')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runCreateName);

  function runList(commandOptions: { json?: boolean }) {
    const snapshotProgram = snapshotCommandProgram({ operation: 'list', ...commandOptions });
    return runCliProgram(snapshotProgram);
  }

  snapshotCommand
    .command('list')
    .description('list saved snapshots, newest first')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runList);

  function runDiffBaselineAgainst(
    baseline: string,
    against: string | undefined,
    commandOptions: CaptureOptions,
  ) {
    let comparisonName = against;

    if (comparisonName == null) comparisonName = 'live';

    const snapshotProgram = snapshotCommandProgram({
      operation: 'diff',
      baseline,
      against: comparisonName,
      ...commandOptions,
    });

    return runCliProgram(snapshotProgram);
  }

  snapshotCommand
    .command('diff <baseline> [against]')
    .description(
      'compare a saved snapshot against another saved snapshot or live state (default: live)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runDiffBaselineAgainst);

  function runExportName(name: string, commandOptions: { out?: string }) {
    const snapshotProgram = snapshotCommandProgram({
      operation: 'export',
      name,
      ...commandOptions,
    });

    return runCliProgram(snapshotProgram);
  }

  snapshotCommand
    .command('export <name>')
    .description('print a saved snapshot as JSON, or write it to a file with --out')
    .option('--out <file>', 'write the snapshot JSON to this file instead of stdout')
    .action(runExportName);

  function runDeleteName(name: string, commandOptions: { json?: boolean }) {
    const snapshotProgram = snapshotCommandProgram({
      operation: 'delete',
      name,
      ...commandOptions,
    });

    return runCliProgram(snapshotProgram);
  }

  snapshotCommand
    .command('delete <name>')
    .description('delete a saved snapshot by name')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runDeleteName);

  function runPrune(commandOptions: PruneOptions) {
    const snapshotProgram = snapshotCommandProgram({
      operation: 'prune',
      options: commandOptions,
    });

    return runCliProgram(snapshotProgram);
  }

  snapshotCommand
    .command('prune')
    .description(
      'delete old user snapshots by count and/or age (auto pre-sync baselines are never touched)',
    )
    .option('--keep <n>', 'keep only the N newest snapshots')
    .option('--older-than <days>', 'delete snapshots older than N days')
    .option('--yes', 'actually delete (without it, a dry-run preview is shown)', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runPrune);

  function runRestoreName(name: string, commandOptions: RestoreOptions) {
    const snapshotProgram = snapshotCommandProgram({
      operation: 'restore',
      name,
      ...commandOptions,
    });

    return runCliProgram(snapshotProgram);
  }

  snapshotCommand
    .command('restore <name>')
    .description(
      "restore a saved snapshot's App Store listing + Play catalog back to live (additive; --yes to apply)",
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--source <id>', 'restore only this source (e.g. apple-listing)')
    .option('--yes', 'actually apply the restore (without it, a dry-run plan is shown)', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runRestoreName);
}
