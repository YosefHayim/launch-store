import type { Command } from 'commander';
import { releaseTrainCommandProgram } from '@core/releaseTrain/command.js';
import { addEnvFlags, type EnvFlags } from '../options.js';
import { runCliProgram } from '../runCliProgram.js';

type ReleaseTrainOptions = EnvFlags &
  Readonly<{
    app?: string;
    profile: string;
    platform?: string;
    ota: boolean;
    hold?: boolean;
    channel: string;
    runtimeVersion?: string;
    watch?: boolean;
    json?: boolean;
  }>;

/** Attach the resumable release-train command family. */
export const registerReleaseTrainCommand = (program: Command): void => {
  const releaseTrainCommand = program
    .command('release-train')
    .description(
      "coordinate an app's iOS + Android + OTA release as one resumable record (ADR 0004)",
    )
    .argument('[action]', 'start | status | release | abort', 'status')
    .argument('[id]', 'train id (default: the latest train)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '-p, --profile <name>',
      'build profile whose env feeds the Android submit + OTA export',
      'production',
    )
    .option('--platform <p>', 'start: restrict to one native platform (ios or android)')
    .option('--no-ota', 'start: coordinate the native legs only (no OTA followers)')
    .option('--hold', 'start: hold every car until all are approved, then release together')
    .option('--channel <name>', 'start: OTA channel the followers publish to', 'production')
    .option(
      '--runtime-version <v>',
      'start: runtime version OTA followers target (default: from app config)',
    )
    .option('--watch', 'status: poll until the train settles', false)
    .option('--json', 'machine-readable output for CI/agents', false);
  addEnvFlags(releaseTrainCommand).action(
    (action: string, trainId: string | undefined, commandOptions: ReleaseTrainOptions) => {
      const optionalOptions: {
        app?: string;
        platform?: string;
        hold?: boolean;
        runtimeVersion?: string;
        watch?: boolean;
        json?: boolean;
      } = {};
      if (commandOptions.app !== undefined) optionalOptions.app = commandOptions.app;
      if (commandOptions.platform !== undefined) optionalOptions.platform = commandOptions.platform;
      if (commandOptions.hold !== undefined) optionalOptions.hold = commandOptions.hold;
      if (commandOptions.runtimeVersion !== undefined)
        optionalOptions.runtimeVersion = commandOptions.runtimeVersion;
      if (commandOptions.watch !== undefined) optionalOptions.watch = commandOptions.watch;
      if (commandOptions.json !== undefined) optionalOptions.json = commandOptions.json;
      const releaseTrainOptions = {
        profile: commandOptions.profile,
        ota: commandOptions.ota,
        channel: commandOptions.channel,
        env: commandOptions.env,
        includeLocal: commandOptions.includeLocal,
        ...optionalOptions,
      };
      if (trainId === undefined) {
        return runCliProgram(releaseTrainCommandProgram({ action, options: releaseTrainOptions }));
      }
      return runCliProgram(
        releaseTrainCommandProgram({ action, id: trainId, options: releaseTrainOptions }),
      );
    },
  );
};
