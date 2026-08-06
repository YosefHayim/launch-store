import type { Command } from 'commander';
import { type MetadataCommandInput, metadataCommandProgram } from '@core/store/metadataCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type MetadataOptions = Readonly<{
  readonly platform?: string;
  readonly app?: string;
  readonly config?: string;
  readonly dryRun: boolean;
}>;

/** Map Commander options without materializing absent exact-optional properties. */
const metadataInputFromOptions = (
  operation: 'pull' | 'push',
  commandOptions: MetadataOptions,
): MetadataCommandInput => {
  let metadataInput: MetadataCommandInput = { operation, dryRun: commandOptions.dryRun };
  if (commandOptions.platform !== undefined) {
    metadataInput = { ...metadataInput, platform: commandOptions.platform };
  }
  if (commandOptions.app !== undefined) {
    metadataInput = { ...metadataInput, app: commandOptions.app };
  }
  if (commandOptions.config !== undefined) {
    metadataInput = { ...metadataInput, config: commandOptions.config };
  }
  return metadataInput;
};

/** Shared app / platform / config flags for pull and push. */
const attachMetadataSelectionOptions = (command: Command): Command =>
  command
    .option('--platform <p>', 'ios (default) or android')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to store.config.json (default: <app>/store.config.json)');

/** Attach the metadata pull and push commands. */
export const registerMetadataCommand = (program: Command): void => {
  const metadataCommand = program
    .command('metadata')
    .description(
      'sync the store listing (name, description, keywords, screenshots) via store.config.json',
    );
  attachMetadataSelectionOptions(
    metadataCommand
      .command('pull')
      .description('download the live store listing into store.config.json'),
  )
    .option('--dry-run', 'rehearse without contacting the store', false)
    .action((commandOptions: MetadataOptions) => {
      return runCliProgram(
        metadataCommandProgram(metadataInputFromOptions('pull', commandOptions)),
      );
    });
  attachMetadataSelectionOptions(
    metadataCommand
      .command('push')
      .description('upload store.config.json to the store listing (metadata only; no binary)'),
  )
    .option(
      '--dry-run',
      'rehearse: write the fastlane metadata folders and print the command, upload nothing',
      false,
    )
    .action((commandOptions: MetadataOptions) => {
      return runCliProgram(
        metadataCommandProgram(metadataInputFromOptions('push', commandOptions)),
      );
    });
};
