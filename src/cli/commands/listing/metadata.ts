// Registers the commands that download and upload the store listing through a config file.

import type { Command } from '@/cli/command.js';
import {
  type MetadataCommandInput,
  metadataCommandProgram,
} from '@/store/shared/metadata-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type MetadataOptions = Readonly<{
  readonly platform?: string;
  readonly app?: string;
  readonly config?: string;
  readonly dryRun: boolean;
}>;

/** Map Commander options without materializing absent exact-optional properties. */
function metadataInputFromOptions(
  operation: 'pull' | 'push',
  commandOptions: MetadataOptions,
): MetadataCommandInput {
  let metadataInput: MetadataCommandInput = { operation, dryRun: commandOptions.dryRun };

  if (commandOptions.platform != null) {
    metadataInput = { ...metadataInput, platform: commandOptions.platform };
  }

  if (commandOptions.app != null) {
    metadataInput = { ...metadataInput, app: commandOptions.app };
  }

  if (commandOptions.config != null) {
    metadataInput = { ...metadataInput, config: commandOptions.config };
  }

  return metadataInput;
}

/** Shared app / platform / config flags for pull and push. */
function attachMetadataSelectionOptions(command: Command): Command {
  return command
    .option('--platform <p>', 'ios (default) or android')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to store.config.json (default: <app>/store.config.json)');
}

/** Attach the metadata pull and push commands. */
export function registerMetadataCommand(program: Command): void {
  const metadataCommand = program
    .command('metadata')
    .description('sync the store listing (name, description, keywords) via store.config.json');
  const pullCommand = metadataCommand
    .command('pull')
    .description('download the live store listing into store.config.json');

  function runCommand(commandOptions: MetadataOptions) {
    const metadataFrom = metadataInputFromOptions('pull', commandOptions);
    const metadataProgram = metadataCommandProgram(metadataFrom);
    return runCliProgram(metadataProgram);
  }

  attachMetadataSelectionOptions(pullCommand)
    .option('--dry-run', 'read the store and report what would be written, write nothing', false)
    .action(runCommand);

  const pushCommand = metadataCommand
    .command('push')
    .description('upload store.config.json to the store listing (metadata only; no binary)');

  function runCommand2(commandOptions: MetadataOptions) {
    const metadataFrom = metadataInputFromOptions('push', commandOptions);
    const metadataProgram = metadataCommandProgram(metadataFrom);
    return runCliProgram(metadataProgram);
  }

  attachMetadataSelectionOptions(pushCommand)
    .option('--dry-run', 'rehearse: print the planned changes, write nothing to the store', false)
    .action(runCommand2);
}
