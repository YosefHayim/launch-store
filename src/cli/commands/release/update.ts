import type { Command } from '../../command.ts';
import { updateCommandProgram } from '../../../config/update-command.ts';
import { addEnvironmentFlags, type EnvironmentFlags } from '../../environment-flags.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type UpdateOptions = EnvironmentFlags &
  Readonly<{
    channel: string;
    platform: string;
    app?: string;
    profile: string;
    runtimeVersion?: string;
    sign: boolean;
    dryRun: boolean;
  }>;

/** Attach the over-the-air update publishing command. */
export function registerUpdateCommand(program: Command): void {
  const updateCommand = program
    .command('update')
    .description('publish an over-the-air JS update (Expo Updates protocol) to your own bucket')
    .option('--channel <name>', 'release channel testers/builds map to', 'production')
    .option('--platform <p>', 'ios, android, or all', 'all')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '-p, --profile <name>',
      'build profile whose env is baked into the bundle',
      'production',
    )
    .option(
      '--runtime-version <v>',
      'runtime version this update targets (default: from app config)',
    )
    .option(
      '--no-sign',
      'publish unsigned (lower security floor - anyone who can write the bucket can push JS)',
    )
    .option(
      '--dry-run',
      'rehearse: print the layout, worker, and app config without exporting or uploading',
      false,
    );

  function runCommand(commandOptions: UpdateOptions) {
    const requiredCommandInput = {
      channel: commandOptions.channel,
      platform: commandOptions.platform,
      profile: commandOptions.profile,
      sign: commandOptions.sign,
      dryRun: commandOptions.dryRun,
      env: commandOptions.env,
      includeLocal: commandOptions.includeLocal,
      printEnv: commandOptions.printEnv,
    };
    const commandInput: typeof requiredCommandInput & { app?: string; runtimeVersion?: string } = {
      ...requiredCommandInput,
    };

    if (commandOptions.app != null) commandInput.app = commandOptions.app;

    if (commandOptions.runtimeVersion != null) {
      commandInput.runtimeVersion = commandOptions.runtimeVersion;
    }

    const updateProgram = updateCommandProgram(commandInput);

    return runCliProgram(updateProgram);
  }

  addEnvironmentFlags(updateCommand).action(runCommand);
}
