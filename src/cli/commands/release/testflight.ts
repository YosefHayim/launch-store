import type { Command } from '../../command.ts';
import { testflightCommandProgram } from '../../../release/testflight-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

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
export function registerTestflightCommand(program: Command): void {
  const testflightCommand = program
    .command('testflight')
    .description('manage TestFlight beta groups and testers');
  function runGroups(commandOptions: AppOption) {
    const testflightProgram = testflightCommandProgram({
      operation: 'groups',
      app: commandOptions.app,
    });
    return runCliProgram(testflightProgram);
  }

  testflightCommand
    .command('groups')
    .description("list the app's TestFlight beta groups")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .action(runGroups);
  function runCreateGroup(groupName: string, commandOptions: AppOption) {
    const testflightProgram = testflightCommandProgram({
      operation: 'create-group',
      groupName,
      app: commandOptions.app,
    });
    return runCliProgram(testflightProgram);
  }

  testflightCommand
    .command('create-group')
    .description('create an external beta group testers can be invited into')
    .argument('<name>', 'the group name, e.g. "External Testers"')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .action(runCreateGroup);
  function runTesters(commandOptions: GroupOption) {
    const testflightProgram = testflightCommandProgram({
      operation: 'testers',
      ...commandOptions,
    });
    return runCliProgram(testflightProgram);
  }

  testflightCommand
    .command('testers')
    .description('list the testers in a beta group')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-g, --group <name>', "beta group (auto-selected if there's only one)")
    .action(runTesters);
  function runAdd(emails: readonly string[], commandOptions: AddTesterOptions) {
    const testflightProgram = testflightCommandProgram({
      operation: 'add',
      emails,
      app: commandOptions.app,
      group: commandOptions.group,
      firstName: commandOptions.first,
      lastName: commandOptions.last,
      csv: commandOptions.csv,
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
    });
    return runCliProgram(testflightProgram);
  }

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
    .action(runAdd);
  function runRm(emails: readonly string[], commandOptions: TesterMutationOptions) {
    const testflightProgram = testflightCommandProgram({
      operation: 'remove',
      emails,
      ...commandOptions,
    });
    return runCliProgram(testflightProgram);
  }

  testflightCommand
    .command('rm')
    .description('remove testers from a beta group')
    .argument('<emails...>', 'tester emails to remove')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-g, --group <name>', "beta group to remove from (auto-selected if there's only one)")
    .option('--dry-run', 'report what would change without removing anyone', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action(runRm);
  function runRelease(commandOptions: ReleaseOptions) {
    const testflightProgram = testflightCommandProgram({
      operation: 'release',
      ...commandOptions,
    });
    return runCliProgram(testflightProgram);
  }

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
    .action(runRelease);
  function runFeedback(commandOptions: FeedbackOptions) {
    const testflightProgram = testflightCommandProgram({
      operation: 'feedback',
      ...commandOptions,
    });
    return runCliProgram(testflightProgram);
  }

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
    .action(runFeedback);
}
