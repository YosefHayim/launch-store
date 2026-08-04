import type { Command } from 'commander';
import { testflightCommandProgram } from '@core/release/testflightCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type AppOption = Readonly<{ app?: string }>;

type GroupOption = Readonly<{
  app?: string;
  group?: string;
}>;

type TesterMutationOptions = Readonly<{
  app?: string;
  group?: string;
  dryRun: boolean;
  yes: boolean;
}>;

type AddTesterOptions = TesterMutationOptions &
  Readonly<{
    first?: string;
    last?: string;
    csv?: string;
  }>;

type ReleaseOptions = Readonly<{
  app?: string;
  build?: string;
  whatsNew?: string;
  locale: string;
  config: string;
  review: boolean;
  dryRun: boolean;
  yes: boolean;
}>;

type FeedbackOptions = Readonly<{
  app?: string;
  build?: string;
  type?: string;
  out?: string;
  json: boolean;
}>;

/** Attach TestFlight group, tester, release, and feedback commands to Commander. */
export const registerTestflightCommand = (program: Command): void => {
  const testflightCommand = program
    .command('testflight')
    .description('manage TestFlight beta groups and testers');

  testflightCommand
    .command('groups')
    .description("list the app's TestFlight beta groups")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .action((commandOptions: AppOption) =>
      runCliProgram(testflightCommandProgram({ operation: 'groups', app: commandOptions.app })),
    );

  testflightCommand
    .command('create-group')
    .description('create an external beta group testers can be invited into')
    .argument('<name>', 'the group name, e.g. "External Testers"')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .action((groupName: string, commandOptions: AppOption) =>
      runCliProgram(
        testflightCommandProgram({
          operation: 'create-group',
          groupName,
          app: commandOptions.app,
        }),
      ),
    );

  testflightCommand
    .command('testers')
    .description('list the testers in a beta group')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-g, --group <name>', "beta group (auto-selected if there's only one)")
    .action((commandOptions: GroupOption) =>
      runCliProgram(testflightCommandProgram({ operation: 'testers', ...commandOptions })),
    );

  testflightCommand
    .command('add')
    .description('invite/add testers to a beta group (sends a TestFlight invite to new emails)')
    .argument('[emails...]', 'tester emails to add')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '-g, --group <name>',
      "external beta group to add into (auto-selected if there's only one)",
    )
    .option('--first <name>', 'first name applied to bare emails')
    .option('--last <name>', 'last name applied to bare emails')
    .option('--csv <path>', 'import testers from a CSV (email,firstName,lastName per line)')
    .option('--dry-run', 'report what would change without inviting anyone', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action((emails: string[], commandOptions: AddTesterOptions) =>
      runCliProgram(
        testflightCommandProgram({
          operation: 'add',
          emails,
          app: commandOptions.app,
          group: commandOptions.group,
          firstName: commandOptions.first,
          lastName: commandOptions.last,
          csv: commandOptions.csv,
          dryRun: commandOptions.dryRun,
          yes: commandOptions.yes,
        }),
      ),
    );

  testflightCommand
    .command('rm')
    .description('remove testers from a beta group')
    .argument('<emails...>', 'tester emails to remove')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-g, --group <name>', "beta group to remove from (auto-selected if there's only one)")
    .option('--dry-run', 'report what would change without removing anyone', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action((emails: string[], commandOptions: TesterMutationOptions) =>
      runCliProgram(
        testflightCommandProgram({
          operation: 'remove',
          emails,
          ...commandOptions,
        }),
      ),
    );

  testflightCommand
    .command('release')
    .description('set a build\'s "What to Test" notes and submit it for Beta App Review')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '--build <version>',
      'target build by CFBundleVersion (default: the latest valid build)',
    )
    .option('--whats-new <text>', 'What to Test notes (for --locale); overrides the config file')
    .option('--locale <locale>', 'locale for --whats-new', 'en-US')
    .option(
      '--config <path>',
      'path to testflight.config.json (localized whatToTest)',
      'testflight.config.json',
    )
    .option('--no-review', "set the notes only; don't submit for Beta App Review")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: ReleaseOptions) =>
      runCliProgram(testflightCommandProgram({ operation: 'release', ...commandOptions })),
    );

  testflightCommand
    .command('feedback')
    .description(
      'list tester crash and screenshot feedback, newest first (download attachments with --out)',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--build <version>', 'only show feedback for this build (CFBundleVersion)')
    .option('--type <kind>', 'only show one kind: crash | screenshot')
    .option('--out <dir>', 'download screenshot attachments into this directory')
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: FeedbackOptions) =>
      runCliProgram(testflightCommandProgram({ operation: 'feedback', ...commandOptions })),
    );
};
