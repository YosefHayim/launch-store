import type { Command } from 'commander';
import {
  type PlayTracksPromoteInput,
  playTracksCommandProgram,
  type PlayTracksStatusInput,
  type PlayTracksTestersInput,
} from '@core/store/playTracksCommand.js';
import { RELEASE_STATUSES } from '@core/store/playTracks.js';
import { runCliProgram } from '../runCliProgram.js';

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
const toTrackStatusInput = (commandOptions: StatusOptions): PlayTracksStatusInput => {
  let commandInput: PlayTracksStatusInput = {
    operation: 'status',
    json: commandOptions.json,
  };
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  return commandInput;
};

/** Map the promotion flags without explicit undefined optionals. */
const toTrackPromoteInput = (commandOptions: PromoteOptions): PlayTracksPromoteInput => {
  let commandInput: PlayTracksPromoteInput = {
    operation: 'promote',
    track: commandOptions.track,
    yes: commandOptions.yes,
  };
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  if (commandOptions.versionCode !== undefined) {
    commandInput = { ...commandInput, versionCode: commandOptions.versionCode };
  }
  if (commandOptions.status !== undefined) {
    commandInput = { ...commandInput, status: commandOptions.status };
  }
  if (commandOptions.rollout !== undefined) {
    commandInput = { ...commandInput, rollout: commandOptions.rollout };
  }
  if (commandOptions.notes !== undefined) {
    commandInput = { ...commandInput, notes: commandOptions.notes };
  }
  if (commandOptions.name !== undefined) {
    commandInput = { ...commandInput, name: commandOptions.name };
  }
  return commandInput;
};

/** Map the tester flags without explicit undefined optionals. */
const toTrackTestersInput = (commandOptions: TestersOptions): PlayTracksTestersInput => {
  let commandInput: PlayTracksTestersInput = {
    operation: 'testers',
    track: commandOptions.track,
    yes: commandOptions.yes,
  };
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  if (commandOptions.groups !== undefined) {
    commandInput = { ...commandInput, groups: commandOptions.groups };
  }
  return commandInput;
};

/** Attach the play-tracks command group. */
export const registerPlayTracksCommand = (program: Command): void => {
  const tracksCommand = program
    .command('play-tracks')
    .description('manage Google Play release tracks from the CLI');
  tracksCommand
    .command('status')
    .description("show each track's releases and country availability")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: StatusOptions) =>
      runCliProgram(playTracksCommandProgram(toTrackStatusInput(commandOptions))),
    );
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
    .action((commandOptions: PromoteOptions) =>
      runCliProgram(playTracksCommandProgram(toTrackPromoteInput(commandOptions))),
    );
  tracksCommand
    .command('testers')
    .description('read or set the Google Groups allowed to test a track')
    .requiredOption('--track <track>', 'the testing track (e.g. internal, alpha, beta)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--groups <emails>', 'comma-separated Google Group emails to set (omit to just read)')
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: TestersOptions) =>
      runCliProgram(playTracksCommandProgram(toTrackTestersInput(commandOptions))),
    );
};
