// Shows Google Play release tracks, ships a build to one, and sets its testers.

import { readFile } from 'node:fs/promises';
import { errorMessage } from '../services/platform/error-message.ts';
import type { PlayCountryAvailability } from '../types/google/edits-country-availability.ts';
import type { PlayRelease } from '../types/google/edits-tracks.ts';
import {
  confirmGoogleStoreWrite,
  loadActiveGoogleStore,
  readGoogleStoreApp,
} from './google-store-command.ts';
import {
  buildRelease,
  isReleaseStatus,
  parseReleaseNotesJson,
  parseRollout,
  type PlayReleaseStatus,
  RELEASE_STATUSES,
  type ReleaseInput,
  type ReleaseNote,
} from './play-tracks.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Command } from '../cli/command.ts';
import { runCliProgram } from '../cli/run-cli-program.ts';
import { redactText } from '../services/platform/redact.ts';

export type PlayTracksStatusInput = {
  operation: 'status';
  app?: string;
  json: boolean;
};

export type PlayTracksPromoteInput = {
  operation: 'promote';
  app?: string;
  track: string;
  versionCode?: string;
  status?: string;
  rollout?: string;
  notes?: string;
  name?: string;
  yes: boolean;
};

export type PlayTracksTestersInput = {
  operation: 'testers';
  app?: string;
  track: string;
  groups?: string;
  yes: boolean;
};

type PlayTracksCommandInput =
  | PlayTracksStatusInput
  | PlayTracksPromoteInput
  | PlayTracksTestersInput;

type TrackWithCountries = {
  track: string;
  releases: readonly PlayRelease[];
  countryAvailability: PlayCountryAvailability | null;
};

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readRequiredString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  if (Object.hasOwn(record, fieldName) == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function assignOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
  assign: (text: string) => void,
): void {
  const text = readExactOptionalString(record, fieldName);

  if (text == null) {
    return;
  }

  assign(text);
}

function decodeStatusInput(record: Record<string, unknown>): PlayTracksStatusInput {
  const commandInput: PlayTracksStatusInput = {
    operation: 'status',
    json: readRequiredBoolean(record, 'json'),
  };

  assignOptionalString(record, 'app', function assignApp(appName: string) {
    commandInput.app = appName;
  });

  return commandInput;
}

function decodePromoteInput(record: Record<string, unknown>): PlayTracksPromoteInput {
  const commandInput: PlayTracksPromoteInput = {
    operation: 'promote',
    track: readRequiredString(record, 'track'),
    yes: readRequiredBoolean(record, 'yes'),
  };

  assignOptionalString(record, 'app', function assignApp(appName: string) {
    commandInput.app = appName;
  });
  assignOptionalString(record, 'versionCode', function assignVersionCode(versionCode: string) {
    commandInput.versionCode = versionCode;
  });
  assignOptionalString(record, 'status', function assignStatus(releaseStatus: string) {
    commandInput.status = releaseStatus;
  });
  assignOptionalString(record, 'rollout', function assignRollout(rollout: string) {
    commandInput.rollout = rollout;
  });
  assignOptionalString(record, 'notes', function assignNotes(notesPath: string) {
    commandInput.notes = notesPath;
  });
  assignOptionalString(record, 'name', function assignName(releaseName: string) {
    commandInput.name = releaseName;
  });

  return commandInput;
}

function decodeTestersInput(record: Record<string, unknown>): PlayTracksTestersInput {
  const commandInput: PlayTracksTestersInput = {
    operation: 'testers',
    track: readRequiredString(record, 'track'),
    yes: readRequiredBoolean(record, 'yes'),
  };

  assignOptionalString(record, 'app', function assignApp(appName: string) {
    commandInput.app = appName;
  });
  assignOptionalString(record, 'groups', function assignGroups(groups: string) {
    commandInput.groups = groups;
  });

  return commandInput;
}

function decodePlayTracksCommandInput(rawCommandInput: unknown): PlayTracksCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Play tracks command input must be an object.');
  }

  const operation = rawCommandInputObject['operation'];

  if (operation == 'status') {
    return decodeStatusInput(rawCommandInputObject);
  }

  if (operation == 'promote') {
    return decodePromoteInput(rawCommandInputObject);
  }

  if (operation == 'testers') {
    return decodeTestersInput(rawCommandInputObject);
  }

  throw new Error('Play tracks operation must be status, promote, or testers.');
}

export const PlayTracksCommandInputSchema = decodePlayTracksCommandInput;

function versionCodeLabel(playRelease: PlayRelease): string {
  const versionCodes = playRelease.versionCodes;

  if (versionCodes == null) {
    return 'no builds';
  }

  if (versionCodes.length == 0) {
    return 'no builds';
  }

  return `v${versionCodes.join(', v')}`;
}

function releaseNotesLabel(playRelease: PlayRelease): string | null {
  const releaseNotes = playRelease.releaseNotes;

  if (releaseNotes == null) {
    return null;
  }

  if (releaseNotes.length == 0) {
    return null;
  }

  return `${releaseNotes.length} note(s)`;
}

/** Describe one Play release in the human-readable track status view. */
export function describePlayRelease(playRelease: PlayRelease): string {
  let releaseStatus = 'unknown';

  if (playRelease.status != null) {
    releaseStatus = playRelease.status;
  }

  const releaseDetails = [releaseStatus, versionCodeLabel(playRelease)];

  if (playRelease.userFraction != null) {
    releaseDetails.push(`${Math.round(playRelease.userFraction * 100)}% rollout`);
  }

  const notesLabel = releaseNotesLabel(playRelease);

  if (notesLabel != null) {
    releaseDetails.push(notesLabel);
  }

  return releaseDetails.join('  ');
}

function chosenReleaseStatus(commandInput: PlayTracksPromoteInput): string {
  if (commandInput.status != null) {
    return commandInput.status;
  }

  if (commandInput.rollout != null) {
    return 'inProgress';
  }

  return 'completed';
}

function readReleaseStatus(commandInput: PlayTracksPromoteInput): PlayReleaseStatus {
  const releaseStatus = chosenReleaseStatus(commandInput);

  if (isReleaseStatus(releaseStatus)) {
    return releaseStatus;
  }

  throw new Error(
    `--status must be one of ${RELEASE_STATUSES.join(', ')} (got "${releaseStatus}").`,
    { cause: releaseStatus },
  );
}

function countryCodeOf(country: { countryCode: string }): string {
  return country.countryCode;
}

function coversRestOfWorld(countryAvailability: PlayCountryAvailability | null): boolean {
  if (countryAvailability == null) {
    return false;
  }

  return countryAvailability.restOfWorld == true;
}

async function showTrackStatus(commandInput: PlayTracksStatusInput): Promise<void> {
  const selectedApp = await readGoogleStoreApp(commandInput.app);
  const googleStore = await loadActiveGoogleStore(selectedApp.packageName, selectedApp.appName);
  const trackCatalog = await googleStore.listTracks(selectedApp.packageName);

  async function readTrackCountries(trackDetails: {
    track: string;
    releases: readonly PlayRelease[];
  }): Promise<TrackWithCountries> {
    try {
      const countryAvailability = await googleStore.getCountryAvailability(
        selectedApp.packageName,
        trackDetails.track,
      );

      return { ...trackDetails, countryAvailability };
    } catch (error) {
      // Country availability is best-effort; a failed lookup still shows the track.
      const lookupFailed = error != null;

      if (lookupFailed) {
        return { ...trackDetails, countryAvailability: null };
      }

      return { ...trackDetails, countryAvailability: null };
    }
  }

  const countryReads = trackCatalog.map(readTrackCountries);
  const tracksWithCountries = await Promise.all(countryReads);
  if (commandInput.json) {
    const serialized = JSON.stringify(tracksWithCountries, null, 2);
    console.log(redactText(serialized));
    return;
  }

  if (tracksWithCountries.length == 0) {
    console.log(
      redactText(
        'No tracks yet. Upload a build (`launch-store submit --platform android`) to populate a track.',
      ),
    );
    return;
  }

  for (const trackDetails of tracksWithCountries) {
    console.log(redactText(`\n${trackDetails.track}`));

    if (trackDetails.releases.length == 0) {
      console.log(redactText('  (no releases)'));
    }

    for (const playRelease of trackDetails.releases) {
      console.log(redactText(`  - ${describePlayRelease(playRelease)}`));
    }

    let countryCodes: string[] = [];
    const countryAvailability = trackDetails.countryAvailability;

    if (countryAvailability != null) {
      countryCodes = countryAvailability.countries.map(countryCodeOf);
    }

    let countryScope = `${countryCodes.length} countr(ies)`;

    if (coversRestOfWorld(countryAvailability)) {
      countryScope = 'rest of world';
    }

    if (countryCodes.length == 0) {
      countryScope = '-';
    }

    console.log(redactText(`  countries: ${countryScope}`));
  }
}

async function readReleaseNotes(
  notesPath: string | undefined,
): Promise<readonly ReleaseNote[] | undefined> {
  if (notesPath == null) {
    return undefined;
  }

  const releaseNotesText = await readFile(notesPath, 'utf8');

  return parseReleaseNotesJson(releaseNotesText);
}

async function promoteTrackRelease(commandInput: PlayTracksPromoteInput): Promise<void> {
  const selectedApp = await readGoogleStoreApp(commandInput.app);
  const googleStore = await loadActiveGoogleStore(selectedApp.packageName, selectedApp.appName);
  let versionCode = commandInput.versionCode;

  if (versionCode == null) {
    const latestVersionCode = await googleStore.getLatestVersionCode(selectedApp.packageName);

    if (latestVersionCode == 0) {
      throw new Error(
        'No uploaded build to promote. Run `launch-store submit --platform android` first, or pass --version-code.',
        { cause: 'missing-build' },
      );
    }

    versionCode = String(latestVersionCode);
  }

  const releaseStatus = readReleaseStatus(commandInput);
  let rolloutFraction: number | undefined;
  const rolloutText = commandInput.rollout;

  if (rolloutText != null) {
    rolloutFraction = parseRollout(rolloutText);
  }

  const releaseNotes = await readReleaseNotes(commandInput.notes);
  let releaseInput: ReleaseInput = { versionCodes: [versionCode], status: releaseStatus };

  if (rolloutFraction != null) {
    releaseInput = { ...releaseInput, userFraction: rolloutFraction };
  }

  if (commandInput.name != null) {
    releaseInput = { ...releaseInput, name: commandInput.name };
  }

  if (releaseNotes != null) {
    releaseInput = { ...releaseInput, releaseNotes };
  }

  const playRelease = buildRelease(releaseInput);
  let rolloutDescription = '';

  if (playRelease.userFraction != null) {
    rolloutDescription = ` at ${Math.round(playRelease.userFraction * 100)}%`;
  }

  const confirmed = await confirmGoogleStoreWrite(
    `Promote v${versionCode} to "${commandInput.track}" as ${releaseStatus}${rolloutDescription}?`,
    commandInput.yes,
    'Refusing to write without confirmation. Re-run with --yes (non-interactive).',
    'Aborted - no changes made.',
  );

  if (confirmed == false) {
    return;
  }

  await googleStore.setTrackReleases(selectedApp.packageName, commandInput.track, [playRelease]);
  console.log(
    redactText(
      `promoted - v${versionCode} -> ${commandInput.track} (${releaseStatus}${rolloutDescription})`,
    ),
  );
}

function trimGroupEmail(groupEmail: string): string {
  return groupEmail.trim();
}

function isPresentGroup(groupEmail: string): boolean {
  return groupEmail.length > 0;
}

function formatTesterGroup(groupEmail: string): string {
  return `- ${groupEmail}`;
}

async function manageTrackTesters(commandInput: PlayTracksTestersInput): Promise<void> {
  const selectedApp = await readGoogleStoreApp(commandInput.app);
  const googleStore = await loadActiveGoogleStore(selectedApp.packageName, selectedApp.appName);
  if (commandInput.groups == null) {
    const testerGroups = await googleStore.getTesters(selectedApp.packageName, commandInput.track);

    if (testerGroups.length == 0) {
      console.log(redactText('No tester groups set.'));
      return;
    }

    console.log(redactText(testerGroups.map(formatTesterGroup).join('\n')));

    return;
  }

  const testerGroups = commandInput.groups.split(',').map(trimGroupEmail).filter(isPresentGroup);
  const confirmed = await confirmGoogleStoreWrite(
    `Set ${testerGroups.length} tester group(s) on "${commandInput.track}"?`,
    commandInput.yes,
    'Refusing to write without confirmation. Re-run with --yes (non-interactive).',
    'Aborted - no changes made.',
  );

  if (confirmed == false) {
    return;
  }

  await googleStore.setTesters(selectedApp.packageName, commandInput.track, testerGroups);
  console.log(redactText(`testers set - ${testerGroups.length} group(s) on ${commandInput.track}`));
}

async function runPlayTracksOperation(commandInput: PlayTracksCommandInput): Promise<void> {
  if (commandInput.operation == 'status') {
    await showTrackStatus(commandInput);
    return;
  }

  if (commandInput.operation == 'promote') {
    await promoteTrackRelease(commandInput);
    return;
  }

  await manageTrackTesters(commandInput);
}

/** Run one schema-decoded Play tracks operation. */
export async function playTracksCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    var commandInput = decodePlayTracksCommandInput(rawCommandInput);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  try {
    await runPlayTracksOperation(commandInput);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }
}

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
