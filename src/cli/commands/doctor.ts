import type { Command } from 'commander';
import {
  type DoctorCommandInput,
  doctorCommandProgram,
  runDoctorProgram,
} from '@core/doctor/command.js';
import type { DoctorPlatform } from '@core/types/doctor.js';
import { runCliProgram } from '../runCliProgram.js';

type DoctorOptions = Readonly<{
  readonly platform?: string;
  readonly app?: string;
  readonly fix: boolean;
  readonly yes: boolean;
  readonly json: boolean;
}>;

type RunDoctorOptions = Readonly<{
  readonly platform: DoctorPlatform;
  readonly app?: string;
  readonly fix?: boolean;
  readonly yes?: boolean;
}>;

/** Map doctor options without explicit undefined fields. */
const toDoctorCommandInput = (commandOptions: DoctorOptions): DoctorCommandInput => {
  let commandInput: DoctorCommandInput = {
    fix: commandOptions.fix,
    yes: commandOptions.yes,
    json: commandOptions.json,
  };
  if (commandOptions.platform !== undefined) {
    commandInput = { ...commandInput, platform: commandOptions.platform };
  }
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  return commandInput;
};

/** Run doctor from the guided setup without assigning a process exit code. */
export const runDoctor = (runOptions: RunDoctorOptions) => {
  const commandOptions: DoctorOptions = {
    platform: runOptions.platform,
    fix: runOptions.fix === true,
    yes: runOptions.yes === true,
    json: false,
  };
  let commandInput = toDoctorCommandInput(commandOptions);
  if (runOptions.app !== undefined) commandInput = { ...commandInput, app: runOptions.app };
  return runCliProgram(runDoctorProgram(commandInput));
};

/** Attach the doctor command. */
export const registerDoctorCommand = (program: Command): void => {
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
    .action((commandOptions: DoctorOptions) =>
      runCliProgram(doctorCommandProgram(toDoctorCommandInput(commandOptions))),
    );
};
