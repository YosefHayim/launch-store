import type { Command } from '@/cli/command.js';
import { updatesCommandProgram } from '@/config/updates-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

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

function provideUpdatesCommand(
  commandInput: Parameters<typeof updatesCommandProgram>[0],
): Promise<void> {
  return updatesCommandProgram(commandInput);
}

/** Attach the update-history command family. */
export function registerUpdatesCommand(program: Command): void {
  const updatesCommand = program
    .command('updates')
    .description('inspect and roll back published OTA updates');

  function runList(commandOptions: ListOptions) {
    return runCliProgram(provideUpdatesCommand({ operation: 'list', ...commandOptions }));
  }

  updatesCommand
    .command('list')
    .description('list published updates, newest first')
    .option('--channel <name>', 'release channel to read', 'production')
    .option('--platform <platform>', 'only show ios or android updates')
    .option('--runtime-version <v>', 'only show updates for this runtime version')
    .option('--json', 'output machine-readable JSON', false)
    .action(runList);

  function runView(reference: string, commandOptions: ViewOptions) {
    return runCliProgram(
      provideUpdatesCommand({ operation: 'view', reference, ...commandOptions }),
    );
  }

  updatesCommand
    .command('view')
    .description('show full detail for one published update')
    .argument('<id|latest>', 'an update id from `updates list`, a short id prefix, or `latest`')
    .option('--channel <name>', 'release channel to read', 'production')
    .option('--json', 'output machine-readable JSON', false)
    .action(runView);

  function runRollback(commandOptions: RollbackOptions) {
    return runCliProgram(provideUpdatesCommand({ operation: 'rollback', ...commandOptions }));
  }

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
    .action(runRollback);
}
