// Shows Google Play release tracks, ships a build to one, and sets its testers.

import { readFile } from 'node:fs/promises';
import { hasMessage } from '@/services/platform/error-message.js';
import { createLogger } from '@/services/platform/logger.js';
import type { PlayCountryAvailability, PlayRelease } from '@/types/google-play.js';
import {
  confirmGoogleStoreWrite,
  loadActiveGoogleStore,
  resolveGoogleStoreApp,
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
} from '@/store/google/play-tracks.js';
import { readPlainObject } from '@/services/platform/plain-object.js';

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

type PlayTracksCommandFailure = Readonly<{
  readonly _tag: 'PlayTracksCommandFailure';
  readonly operation: PlayTracksCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;

type TrackWithCountries = {
  track: string;
  releases: readonly PlayRelease[];
  countryAvailability: PlayCountryAvailability | null;
};

function makePlayTracksCommandFailure(fields: {
  operation: PlayTracksCommandInput['operation'];
  message: string;
  cause: unknown;
}): PlayTracksCommandFailure {
  return { _tag: 'PlayTracksCommandFailure', ...fields };
}

function tracksFailure(
  operation: PlayTracksCommandInput['operation'],
  cause: unknown,
): PlayTracksCommandFailure {
  let message = `Play tracks ${operation} failed.`;

  if (typeof cause == 'string') {
    const isBlank = cause.length == 0;

    if (isBlank == false) {
      message = cause;
    }
  }

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return makePlayTracksCommandFailure({ operation, message, cause });
}

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

function resolveReleaseStatus(commandInput: PlayTracksPromoteInput): PlayReleaseStatus {
  const releaseStatus = chosenReleaseStatus(commandInput);

  if (isReleaseStatus(releaseStatus)) {
    return releaseStatus;
  }

  throw makePlayTracksCommandFailure({
    operation: 'promote',
    message: `--status must be one of ${RELEASE_STATUSES.join(', ')} (got "${releaseStatus}").`,
    cause: releaseStatus,
  });
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
  const selectedApp = await resolveGoogleStoreApp(commandInput.app);
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
  const logger = createLogger(false);

  if (commandInput.json) {
    const serialized = JSON.stringify(tracksWithCountries, null, 2);
    logger.line(serialized);
    return;
  }

  if (tracksWithCountries.length == 0) {
    logger.line(
      'No tracks yet. Upload a build (`launch-store submit --platform android`) to populate a track.',
    );
    return;
  }

  for (const trackDetails of tracksWithCountries) {
    logger.line(`\n${trackDetails.track}`);

    if (trackDetails.releases.length == 0) {
      logger.line('  (no releases)');
    }

    for (const playRelease of trackDetails.releases) {
      logger.line(`  - ${describePlayRelease(playRelease)}`);
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

    logger.line(`  countries: ${countryScope}`);
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
  const selectedApp = await resolveGoogleStoreApp(commandInput.app);
  const googleStore = await loadActiveGoogleStore(selectedApp.packageName, selectedApp.appName);
  let versionCode = commandInput.versionCode;

  if (versionCode == null) {
    const latestVersionCode = await googleStore.getLatestVersionCode(selectedApp.packageName);

    if (latestVersionCode == 0) {
      throw makePlayTracksCommandFailure({
        operation: 'promote',
        message:
          'No uploaded build to promote. Run `launch-store submit --platform android` first, or pass --version-code.',
        cause: 'missing-build',
      });
    }

    versionCode = String(latestVersionCode);
  }

  const releaseStatus = resolveReleaseStatus(commandInput);
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

  const logger = createLogger(false);

  logger.step(
    'promoted',
    `v${versionCode} -> ${commandInput.track} (${releaseStatus}${rolloutDescription})`,
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
  const selectedApp = await resolveGoogleStoreApp(commandInput.app);
  const googleStore = await loadActiveGoogleStore(selectedApp.packageName, selectedApp.appName);
  const logger = createLogger(false);

  if (commandInput.groups == null) {
    const testerGroups = await googleStore.getTesters(selectedApp.packageName, commandInput.track);

    if (testerGroups.length == 0) {
      logger.line('No tester groups set.');
      return;
    }

    logger.line(testerGroups.map(formatTesterGroup).join('\n'));

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
  logger.step('testers set', `${testerGroups.length} group(s) on ${commandInput.track}`);
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
  let commandInput: PlayTracksCommandInput;

  try {
    commandInput = decodePlayTracksCommandInput(rawCommandInput);
  } catch (cause) {
    throw tracksFailure('status', cause);
  }

  try {
    await runPlayTracksOperation(commandInput);
  } catch (cause) {
    throw tracksFailure(commandInput.operation, cause);
  }
}
