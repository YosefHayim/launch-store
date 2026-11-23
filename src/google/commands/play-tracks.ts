// Registers the commands that show, ship, and set testers on Google Play release tracks.

import type { Command } from '@/cli/command.js';
import {
  type PlayTracksPromoteInput,
  playTracksCommandProgram,
  type PlayTracksStatusInput,
  type PlayTracksTestersInput,
} from './play-tracks-command.ts';
import { RELEASE_STATUSES } from '@/google/store/play-tracks.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type StatusOptions = Readonly<{
  readonly app?: string;
  readonly json: boolean;
}>;

type PromoteOptions = Readonly<{
  readonly app?: string;
  readonly track: string;
  readonly versionCode?: string;
  readonly status?: string;
  readonly rollout?: string;
  readonly notes?: string;
  readonly name?: string;
  readonly yes: boolean;
}>;

type TestersOptions = Readonly<{
  readonly app?: string;
  readonly track: string;
  readonly groups?: string;
  readonly yes: boolean;
}>;

/** Map the track status flags without explicit undefined optionals. */
function readTrackStatus(commandOptions: StatusOptions): PlayTracksStatusInput {
  let commandInput: PlayTracksStatusInput = {
    operation: 'status',
    json: commandOptions.json,
  };

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  return commandInput;
}

/** Map the promotion flags without explicit undefined optionals. */
function readTrackPromote(commandOptions: PromoteOptions): PlayTracksPromoteInput {
  let commandInput: PlayTracksPromoteInput = {
    operation: 'promote',
    track: commandOptions.track,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  if (commandOptions.versionCode != null) {
    commandInput = { ...commandInput, versionCode: commandOptions.versionCode };
  }

  if (commandOptions.status != null) {
    commandInput = { ...commandInput, status: commandOptions.status };
  }

  if (commandOptions.rollout != null) {
    commandInput = { ...commandInput, rollout: commandOptions.rollout };
  }

  if (commandOptions.notes != null) {
    commandInput = { ...commandInput, notes: commandOptions.notes };
  }

  if (commandOptions.name != null) {
    commandInput = { ...commandInput, name: commandOptions.name };
  }

  return commandInput;
}

/** Map the tester flags without explicit undefined optionals. */
function readTrackTesters(commandOptions: TestersOptions): PlayTracksTestersInput {
  let commandInput: PlayTracksTestersInput = {
    operation: 'testers',
    track: commandOptions.track,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  if (commandOptions.groups != null) {
    commandInput = { ...commandInput, groups: commandOptions.groups };
  }

  return commandInput;
}

/** Attach the play-tracks command group. */
export function registerPlayTracksCommand(program: Command): void {
  const tracksCommand = program
    .command('play-tracks')
    .description('manage Google Play release tracks from the CLI');

  function runStatus(commandOptions: StatusOptions) {
    const trackStatus = readTrackStatus(commandOptions);
    const playTracksProgram = playTracksCommandProgram(trackStatus);
    return runCliProgram(playTracksProgram);
  }

  tracksCommand
    .command('status')
    .description("show each track's releases and country availability")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action(runStatus);

  function runPromote(commandOptions: PromoteOptions) {
    const trackPromote = readTrackPromote(commandOptions);
    const playTracksProgram = playTracksCommandProgram(trackPromote);
    return runCliProgram(playTracksProgram);
  }

  tracksCommand
    .command('promote')
    .description('ship a build to a track at a chosen status / rollout, with release notes')
    .requiredOption(
      '--track <track>',
      'target track (internal, alpha, beta, production, or a custom track)',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '--version-code <code>',
      'Play versionCode to ship (defaults to the latest uploaded; not the CLI package --version)',
    )
    .option(
      '--status <status>',
      `release status: ${RELEASE_STATUSES.join(', ')} (default: completed, or inProgress with --rollout)`,
    )
    .option('--rollout <fraction>', 'staged-rollout fraction 0-1 (implies --status inProgress)')
    .option('--notes <path>', 'path to a JSON file mapping language codes to release-note text')
    .option('--name <name>', 'release name (Play derives one from the version when omitted)')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runPromote);

  function runTesters(commandOptions: TestersOptions) {
    const trackTesters = readTrackTesters(commandOptions);
    const playTracksProgram = playTracksCommandProgram(trackTesters);
    return runCliProgram(playTracksProgram);
  }

  tracksCommand
    .command('testers')
    .description('read or set the Google Groups allowed to test a track')
    .requiredOption('--track <track>', 'the testing track (e.g. internal, alpha, beta)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--groups <emails>', 'comma-separated Google Group emails to set (omit to just read)')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runTesters);
}
