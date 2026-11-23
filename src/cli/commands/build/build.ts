// Registers the command that builds an app and uploads it to the testing track.

import type { Command } from '@/cli/command.js';
import { buildCommandProgram } from '@/build/build-command-program.js';
import type { BuildCommandOptions } from '@/build/build-command-input.js';
import { addEnvironmentFlags } from '@/cli/environment-flags.js';
import { runCliProgram, runJsonCliProgram } from '@/cli/run-cli-program.js';

function addAppleBuildOptions(command: Command): Command {
  return command
    .option(
      '--account <name>',
      'iOS only - Apple account to build with: label or Key ID (default: active)',
    )
    .option('--remote [target]', 'iOS only - build on another Mac over SSH, as user@host')
    .option(
      '--bump <kind>',
      "iOS only - version bump: patch|minor|major|keep (default: last used, else prompt) or 'ask' to force the prompt",
    );
}

function addAndroidBuildOptions(command: Command): Command {
  return command
    .option(
      '--track <track>',
      'Android only - Play track: internal|closed|open|production (default: internal)',
    )
    .option(
      '--rollout <fraction>',
      'Android only - staged-rollout fraction for production (default: 1.0)',
    )
    .option(
      '--notes <path>',
      'Android only - JSON file mapping language codes to Play release notes (Whats new); overrides config when set',
    );
}

function addSharedBuildOptions(command: Command): Command {
  return command
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
    )
    .option(
      '--json',
      'stream progress as NDJSON events on stdout and end with one result line (never prompts)',
      false,
    );
}

export function registerBuildCommand(program: Command): void {
  const buildCommand = program
    .command('build')
    .description(
      'run the full pipeline and upload to the testing track (--no-submit to build only)',
    )
    .argument('<platform>', 'ios, android, tvos, macos, or visionos')
    .option('-p, --profile <name>', 'build profile', 'production')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--explain', 'expand each step into a plain-English teaching block', false)
    .option('--no-submit', 'build only; do not upload');
  const appleBuildCommand = addAppleBuildOptions(buildCommand);
  const androidBuildCommand = addAndroidBuildOptions(appleBuildCommand);
  const command = addSharedBuildOptions(androidBuildCommand);

  function runCommand(platformArgument: string, commandOptions: BuildCommandOptions) {
    function startBuild(): ReturnType<typeof buildCommandProgram> {
      return buildCommandProgram(platformArgument, commandOptions);
    }

    if (!commandOptions.json) {
      const buildProgram = startBuild();
      return runCliProgram(buildProgram);
    }

    return runJsonCliProgram(
      {
        command: 'build',
        platform: platformArgument,
        dryRun: commandOptions.dryRun,
        profile: commandOptions.profile,
      },
      startBuild,
    );
  }

  addEnvironmentFlags(command).action(runCommand);
}
