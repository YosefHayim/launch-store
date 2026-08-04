import type { Command } from 'commander';
import { snapshotCommandProgram } from '@core/snapshot/snapshotCommand.js';
import { runCliProgram } from '../runCliProgram.js';

const LIVE_SNAPSHOT = 'live';

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
export const registerSnapshotCommand = (program: Command): void => {
  const snapshotCommand = program
    .command('snapshot')
    .description('capture, diff, and export point-in-time copies of live store state (read-only)');
  snapshotCommand
    .command('create [name]')
    .description('capture live App Store + Play state into a named snapshot')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((name: string | undefined, commandOptions: CaptureOptions) => {
      if (name === undefined)
        return runCliProgram(snapshotCommandProgram({ operation: 'create', ...commandOptions }));
      return runCliProgram(
        snapshotCommandProgram({ operation: 'create', name, ...commandOptions }),
      );
    });
  snapshotCommand
    .command('list')
    .description('list saved snapshots, newest first')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((commandOptions: { json?: boolean }) =>
      runCliProgram(snapshotCommandProgram({ operation: 'list', ...commandOptions })),
    );
  snapshotCommand
    .command('diff <baseline> [against]')
    .description(
      'compare a saved snapshot against another saved snapshot or live state (default: live)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((baseline: string, against: string | undefined, commandOptions: CaptureOptions) => {
      let comparisonName = against;
      if (comparisonName === undefined) comparisonName = LIVE_SNAPSHOT;
      return runCliProgram(
        snapshotCommandProgram({
          operation: 'diff',
          baseline,
          against: comparisonName,
          ...commandOptions,
        }),
      );
    });
  snapshotCommand
    .command('export <name>')
    .description('print a saved snapshot as JSON, or write it to a file with --out')
    .option('--out <file>', 'write the snapshot JSON to this file instead of stdout')
    .action((name: string, commandOptions: { out?: string }) =>
      runCliProgram(snapshotCommandProgram({ operation: 'export', name, ...commandOptions })),
    );
  snapshotCommand
    .command('delete <name>')
    .description('delete a saved snapshot by name')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((name: string, commandOptions: { json?: boolean }) =>
      runCliProgram(snapshotCommandProgram({ operation: 'delete', name, ...commandOptions })),
    );
  snapshotCommand
    .command('prune')
    .description(
      'delete old user snapshots by count and/or age (auto pre-sync baselines are never touched)',
    )
    .option('--keep <n>', 'keep only the N newest snapshots')
    .option('--older-than <days>', 'delete snapshots older than N days')
    .option('--yes', 'actually delete (without it, a dry-run preview is shown)', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((commandOptions: PruneOptions) =>
      runCliProgram(snapshotCommandProgram({ operation: 'prune', options: commandOptions })),
    );
  snapshotCommand
    .command('restore <name>')
    .description(
      "restore a saved snapshot's App Store listing + Play catalog back to live (additive; --yes to apply)",
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--source <id>', 'restore only this source (e.g. apple-listing)')
    .option('--yes', 'actually apply the restore (without it, a dry-run plan is shown)', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((name: string, commandOptions: RestoreOptions) =>
      runCliProgram(snapshotCommandProgram({ operation: 'restore', name, ...commandOptions })),
    );
};
