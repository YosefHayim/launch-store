import type { Command } from 'commander';
import { buildCommandProgram } from '@core/build/buildCommandProgram.js';
import type { BuildCommandOptions } from '@core/build/buildCommandInput.js';
import { addEnvFlags } from '../options.js';
import { runCliProgram } from '../runCliProgram.js';
const addAppleBuildOptions = (command: Command): Command =>
  command
    .option(
      '--account <name>',
      'iOS only - Apple account to build with: label or Key ID (default: active)',
    )
    .option(
      '--remote [target]',
      "iOS only - build on a remote Mac: 'aws' (default) or user@host over SSH",
    )
    .option(
      '--bump <kind>',
      "iOS only - version bump: patch|minor|major|keep (default: last used, else prompt) or 'ask' to force the prompt",
    );
const addAndroidBuildOptions = (command: Command): Command =>
  command
    .option(
      '--track <track>',
      'Android only - Play track: internal|closed|open|production (default: internal)',
    )
    .option(
      '--rollout <fraction>',
      'Android only - staged-rollout fraction for production (default: 1.0)',
    );
const addSharedBuildOptions = (command: Command): Command =>
  command
    .option(
      '--distribution <mode>',
      'store (default, TestFlight/Play) or internal (ad-hoc install link)',
    )
    .option(
      '--size-budget <MB>',
      'override the profile soft size budget for this build only (MB, e.g. 250)',
    )
    .option('--budget <MB>', 'alias of --size-budget')
    .option(
      '--clean',
      'force a from-scratch build (default: fast incremental, clean only when native deps change)',
      false,
    )
    .option('--no-ccache', 'disable ccache for this build')
    .option('--dry-run', 'rehearse every step and print what it would do, changing nothing', false)
    .option('-y, --yes', 'skip the pre-upload size confirmation (auto-confirm)', false)
    .option(
      '-v, --verbose',
      'stream the full xcodebuild/gradle output instead of a progress spinner',
      false,
    );
export const registerBuildCommand = (program: Command): void => {
  const command = addSharedBuildOptions(
    addAndroidBuildOptions(
      addAppleBuildOptions(
        program
          .command('build')
          .description(
            'run the full pipeline and upload to the testing track (--no-submit to build only)',
          )
          .argument('<platform>', 'ios, android, tvos, macos, or visionos')
          .option('-p, --profile <name>', 'build profile', 'production')
          .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
          .option('--explain', 'expand each step into a plain-English teaching block', false)
          .option('--no-submit', 'build only; do not upload'),
      ),
    ),
  );
  addEnvFlags(command).action((platformArgument: string, commandOptions: BuildCommandOptions) =>
    runCliProgram(buildCommandProgram(platformArgument, commandOptions)),
  );
};
