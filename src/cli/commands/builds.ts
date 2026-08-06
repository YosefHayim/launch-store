import type { Command } from 'commander';
import { Effect } from 'effect';
import {
  BuildHistoryCommandServiceLive,
  buildHistoryCommandProgram,
  type BuildHistoryCommandInput,
  type PruneCommandOptions,
} from '@core/build/buildHistoryCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Provide the live build-history boundary and execute one command operation. */
const provideBuildHistoryCommand = (commandInput: BuildHistoryCommandInput) =>
  buildHistoryCommandProgram(commandInput).pipe(Effect.provide(BuildHistoryCommandServiceLive));

/** Attach the build-history command family. */
export const registerBuildsCommand = (program: Command): void => {
  const buildsCommand = program
    .command('builds')
    .description('inspect and trim local build history (the artifact index)');
  buildsCommand
    .command('list')
    .description('list past builds, newest first')
    .option('-a, --app <name>', 'only show builds for this app')
    .option(
      '--platform <platform>',
      'only show builds for one platform (ios/android/tvos/macos/visionos)',
    )
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: { app?: string; platform?: string; json: boolean }) =>
      runCliProgram(provideBuildHistoryCommand({ operation: 'list', ...commandOptions })),
    );
  buildsCommand
    .command('view')
    .description('show full detail for one build')
    .argument('<id|latest>', 'a build id from `builds list`, a build number, or `latest`')
    .option('--json', 'output machine-readable JSON', false)
    .action((reference: string, commandOptions: { json: boolean }) =>
      runCliProgram(
        provideBuildHistoryCommand({ operation: 'view', reference, json: commandOptions.json }),
      ),
    );
  buildsCommand
    .command('log')
    .description(
      "print a past build's full native log (secrets redacted), or open it in your editor",
    )
    .argument('<id|latest>', 'a build id from `builds list`, a build number, or `latest`')
    .option('--open', 'reveal the log in your editor / OS viewer instead of printing it', false)
    .action((reference: string, commandOptions: { open: boolean }) =>
      runCliProgram(
        provideBuildHistoryCommand({ operation: 'log', reference, open: commandOptions.open }),
      ),
    );
  buildsCommand
    .command('prune')
    .description(
      'delete build binaries older than the retention window (keeps the newest per app+platform)',
    )
    .option(
      '--days <n>',
      'retention window in days (default: config artifactRetentionDays, else 30)',
    )
    .option('-a, --app <name>', 'only prune builds for this app')
    .option(
      '--platform <platform>',
      'only prune builds for one platform (ios/android/tvos/macos/visionos)',
    )
    .option('--dry-run', 'show what would be deleted without deleting', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: PruneCommandOptions) =>
      runCliProgram(provideBuildHistoryCommand({ operation: 'prune', options: commandOptions })),
    );
};
