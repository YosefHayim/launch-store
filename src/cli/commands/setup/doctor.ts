// Registers the command that checks the local build tools and the saved store account.

import type { Command } from '@/cli/command.js';
import { type DoctorCommandInput, doctorCommandProgram } from '@/doctor/command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type DoctorOptions = Readonly<{
  readonly platform?: string;
  readonly app?: string;
  readonly fix: boolean;
  readonly yes: boolean;
  readonly json: boolean;
}>;

/** Map doctor options without explicit undefined fields. */
function readDoctorCommand(commandOptions: DoctorOptions): DoctorCommandInput {
  let commandInput: DoctorCommandInput = {
    fix: commandOptions.fix,
    yes: commandOptions.yes,
    json: commandOptions.json,
  };

  if (commandOptions.platform != null) {
    commandInput = { ...commandInput, platform: commandOptions.platform };
  }

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  return commandInput;
}

/** Attach the doctor command. */
export function registerDoctorCommand(program: Command): void {
  function runDoctor(commandOptions: DoctorOptions) {
    const doctorCommand = readDoctorCommand(commandOptions);
    const doctorProgram = doctorCommandProgram(doctorCommand);
    return runCliProgram(doctorProgram);
  }

  program
    .command('doctor')
    .description('check that the local toolchain and store account are ready')
    .option('--platform <p>', 'ios (default), android, tvos, macos, or visionos')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option(
      '--fix',
      'install any missing build tools (Apple platforms only; asks for consent first)',
      false,
    )
    .option('--yes', 'skip prompts and proceed with installs (CI/agents)', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runDoctor);
}
