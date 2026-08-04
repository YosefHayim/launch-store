import type { Command } from 'commander';
import { Effect } from 'effect';
import { UpdatesCommandServiceLive, updatesCommandProgram } from '@core/config/updatesCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type ListOptions = Readonly<{
  channel: string;
  platform?: string;
  runtimeVersion?: string;
  json: boolean;
}>;

type ViewOptions = Readonly<{ channel: string; json: boolean }>;

type RollbackOptions = Readonly<{
  channel: string;
  platform?: string;
  to?: string;
  toEmbedded: boolean;
  runtimeVersion?: string;
  app?: string;
  yes: boolean;
}>;

/** Provide the live update boundary to one command operation. */
const provideUpdatesCommand = (commandInput: Parameters<typeof updatesCommandProgram>[0]) =>
  updatesCommandProgram(commandInput).pipe(Effect.provide(UpdatesCommandServiceLive));

/** Attach the update-history command family. */
export const registerUpdatesCommand = (program: Command): void => {
  const updatesCommand = program
    .command('updates')
    .description('inspect and roll back published OTA updates');
  updatesCommand
    .command('list')
    .description('list published updates, newest first')
    .option('--channel <name>', 'release channel to read', 'production')
    .option('--platform <platform>', 'only show ios or android updates')
    .option('--runtime-version <v>', 'only show updates for this runtime version')
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: ListOptions) =>
      runCliProgram(provideUpdatesCommand({ operation: 'list', ...commandOptions })),
    );
  updatesCommand
    .command('view')
    .description('show full detail for one published update')
    .argument('<id|latest>', 'an update id from `updates list`, a short id prefix, or `latest`')
    .option('--channel <name>', 'release channel to read', 'production')
    .option('--json', 'output machine-readable JSON', false)
    .action((reference: string, commandOptions: ViewOptions) =>
      runCliProgram(provideUpdatesCommand({ operation: 'view', reference, ...commandOptions })),
    );
  updatesCommand
    .command('rollback')
    .description('republish a prior update, or roll clients back to the embedded bundle')
    .option('--channel <name>', 'release channel to roll back', 'production')
    .option('--platform <platform>', 'limit to ios or android (default: both)')
    .option('--to <id>', 'republish a specific update id (skips the picker)')
    .option('--to-embedded', 'roll clients back to the bundle embedded in the binary', false)
    .option('--runtime-version <v>', 'runtime version for --to-embedded (default: from app config)')
    .option(
      '-a, --app <name>',
      'app handle (used to resolve the runtime version for --to-embedded)',
    )
    .option('-y, --yes', 'skip the confirmation prompt (for CI/agents)', false)
    .action((commandOptions: RollbackOptions) =>
      runCliProgram(provideUpdatesCommand({ operation: 'rollback', ...commandOptions })),
    );
};
