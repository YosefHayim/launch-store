// Registers the command that submits the latest build to the public store track.

import type { Command } from '@/cli/command.js';
import { releaseCommandProgram, type ReleaseCommandOptions } from '@/release/release-command.js';
import { addEnvironmentFlags } from '@/cli/environment-flags.js';
import { runCliProgram, runJsonCliProgram } from '@/cli/run-cli-program.js';

/** Attach the public release command. */
export function registerReleaseCommand(program: Command): void {
  const releaseCommand = program
    .command('release')
    .description(
      "submit the latest build to the store's PUBLIC production track (with confirmation)",
    )
    .argument('<platform>', 'ios, android, tvos, macos, or visionos')
    .option('-a, --app <name>', 'app handle')
    .option('-p, --profile <name>', 'build profile', 'production')
    .option(
      '--account <id>',
      'iOS only - Apple account label or Key ID (default: ASC_ACCOUNT, then the active account)',
    )
    .option('--rollout <fraction>', 'Android only - staged-rollout fraction (default: 1.0)')
    .option(
      '--build <n>',
      'iOS only - promote an existing build number, or "latest", instead of uploading',
    )
    .option(
      '--upload',
      'iOS only - upload the latest local build (skip the upload-vs-promote picker)',
      false,
    )
    .option('--no-wait', 'iOS only - after uploading, return without waiting for processing/submit')
    .option('--manual', 'iOS only - hold the approved build for manual release', false)
    .option('--scheduled <iso>', 'iOS only - schedule the go-live at an ISO-8601 instant')
    .option('--phased', "iOS only - opt into Apple's 7-day phased rollout", false)
    .option(
      '--attach-only',
      'iOS only - attach the --build to the editable App Store version without submitting for review',
      false,
    )
    .option('--dry-run', 'print the release plan (touches nothing) and exit', false)
    .option(
      '--create-app',
      'iOS only - show the one-time App Store Connect setup checklist and exit',
      false,
    )
    .option('-y, --yes', 'skip the confirmation prompt (for CI/agents after approval)', false)
    .option('--explain', 'expand each step', false)
    .option(
      '--json',
      'stream progress as NDJSON events on stdout and end with one result line (never prompts)',
      false,
    );

  function runCommand(platformArgument: string, commandOptions: ReleaseCommandOptions) {
    function startRelease(): ReturnType<typeof releaseCommandProgram> {
      return releaseCommandProgram(platformArgument, commandOptions);
    }

    if (!commandOptions.json) return runCliProgram(startRelease());

    return runJsonCliProgram(
      {
        command: 'release',
        platform: platformArgument,
        dryRun: commandOptions.dryRun == true,
        profile: commandOptions.profile,
      },
      startRelease,
    );
  }

  addEnvironmentFlags(releaseCommand).action(runCommand);
}
