import type { Command } from 'commander';
import { Effect } from 'effect';
import {
  releaseCommandProgram,
  ReleaseCommandServiceLive,
  shouldNudgeRelease,
  type ReleaseCommandOptions,
} from '@core/release/releaseCommand.js';
import { addEnvFlags } from '../options.js';
import { runCliProgram } from '../runCliProgram.js';

export { shouldNudgeRelease };

/** Attach the public release command. */
export const registerReleaseCommand = (program: Command): void => {
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
    .option('--dry-run', 'iOS only - print the release plan (touches nothing) and exit', false)
    .option(
      '--create-app',
      'iOS only - show the one-time App Store Connect setup checklist and exit',
      false,
    )
    .option('-y, --yes', 'skip the confirmation prompt (for CI/agents after approval)', false)
    .option('--explain', 'expand each step', false);
  addEnvFlags(releaseCommand).action(
    (platformArgument: string, commandOptions: ReleaseCommandOptions) =>
      runCliProgram(
        releaseCommandProgram(platformArgument, commandOptions).pipe(
          Effect.provide(ReleaseCommandServiceLive),
        ),
      ),
  );
};
