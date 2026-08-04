import { FileSystem, type Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPromptService } from '../services/prompt.js';
import type { PlayCountryAvailability, PlayRelease } from '../types/googlePlay.js';
import {
  confirmGoogleStoreWrite,
  loadActiveGoogleStore,
  type ActiveGoogleStoreRequirements,
  resolveGoogleStorePackageName,
} from './googleStoreCommand.js';
import {
  buildRelease,
  isReleaseStatus,
  parseReleaseNotesJson,
  parseRollout,
  type PlayReleaseStatus,
  RELEASE_STATUSES,
  type ReleaseInput,
  type ReleaseNote,
} from './playTracks.js';
import type { StoreAppSelectionRequirements } from './selectStoreApp.js';

const PlayTracksStatusInputSchema = Schema.Struct({
  operation: Schema.Literal('status'),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  json: Schema.Boolean,
});

const PlayTracksPromoteInputSchema = Schema.Struct({
  operation: Schema.Literal('promote'),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  track: Schema.String,
  version: Schema.optionalWith(Schema.String, { exact: true }),
  status: Schema.optionalWith(Schema.String, { exact: true }),
  rollout: Schema.optionalWith(Schema.String, { exact: true }),
  notes: Schema.optionalWith(Schema.String, { exact: true }),
  name: Schema.optionalWith(Schema.String, { exact: true }),
  yes: Schema.Boolean,
});

const PlayTracksTestersInputSchema = Schema.Struct({
  operation: Schema.Literal('testers'),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  track: Schema.String,
  groups: Schema.optionalWith(Schema.String, { exact: true }),
  yes: Schema.Boolean,
});

export const PlayTracksCommandInputSchema = Schema.Union(
  PlayTracksStatusInputSchema,
  PlayTracksPromoteInputSchema,
  PlayTracksTestersInputSchema,
);

export type PlayTracksCommandInput = Schema.Schema.Type<typeof PlayTracksCommandInputSchema>;
export type PlayTracksStatusInput = Schema.Schema.Type<typeof PlayTracksStatusInputSchema>;
export type PlayTracksPromoteInput = Schema.Schema.Type<typeof PlayTracksPromoteInputSchema>;
export type PlayTracksTestersInput = Schema.Schema.Type<typeof PlayTracksTestersInputSchema>;

/** A Play tracks command step failed. */
export type PlayTracksCommandFailure = Readonly<{
  readonly _tag: 'PlayTracksCommandFailure';
  readonly operation: PlayTracksCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;
export const makePlayTracksCommandFailure = Data.tagged<PlayTracksCommandFailure>(
  'PlayTracksCommandFailure',
);

type PlayTracksCommandRequirements =
  | ActiveGoogleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

/** Convert a dependency failure into the Play tracks command channel. */
const tracksFailure = (
  operation: PlayTracksCommandInput['operation'],
  cause: unknown,
): PlayTracksCommandFailure => {
  let message = `Play tracks ${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makePlayTracksCommandFailure({ operation, message, cause });
};

/** Describe one Play release in the human-readable track status view. */
export const describePlayRelease = (playRelease: PlayRelease): string => {
  let releaseStatus = 'unknown';
  if (playRelease.status !== undefined) releaseStatus = playRelease.status;
  let buildDescription = 'no builds';
  if (playRelease.versionCodes !== undefined && playRelease.versionCodes.length > 0) {
    buildDescription = `v${playRelease.versionCodes.join(', v')}`;
  }
  const releaseDetails = [releaseStatus, buildDescription];
  if (playRelease.userFraction !== undefined) {
    releaseDetails.push(`${Math.round(playRelease.userFraction * 100)}% rollout`);
  }
  if (playRelease.releaseNotes !== undefined && playRelease.releaseNotes.length > 0) {
    releaseDetails.push(`${playRelease.releaseNotes.length} note(s)`);
  }
  return releaseDetails.join('  ');
};

/** Resolve the release status, including the rollout-based default. */
const resolveReleaseStatus = (
  commandInput: PlayTracksPromoteInput,
): Effect.Effect<PlayReleaseStatus, PlayTracksCommandFailure> => {
  let releaseStatus = commandInput.status;
  if (releaseStatus === undefined) releaseStatus = 'completed';
  if (commandInput.status === undefined && commandInput.rollout !== undefined) {
    releaseStatus = 'inProgress';
  }
  if (isReleaseStatus(releaseStatus)) return Effect.succeed(releaseStatus);
  return Effect.fail(
    makePlayTracksCommandFailure({
      operation: 'promote',
      message: `--status must be one of ${RELEASE_STATUSES.join(', ')} (got "${releaseStatus}").`,
      cause: releaseStatus,
    }),
  );
};

/** Decode an optional release-notes JSON file through its exact string-map schema. */
const readReleaseNotes = (
  notesPath: string | undefined,
): Effect.Effect<
  readonly ReleaseNote[] | undefined,
  PlayTracksCommandFailure,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (notesPath === undefined) return undefined;
    const fileSystem = yield* FileSystem.FileSystem;
    const releaseNotesText = yield* fileSystem
      .readFileString(notesPath)
      .pipe(Effect.mapError((cause) => tracksFailure('promote', cause)));
    return yield* parseReleaseNotesJson(releaseNotesText).pipe(
      Effect.mapError((cause) => tracksFailure('promote', cause)),
    );
  });

/** List all Play tracks with best-effort country availability. */
const showTrackStatus = (
  commandInput: PlayTracksStatusInput,
): Effect.Effect<void, PlayTracksCommandFailure, PlayTracksCommandRequirements> =>
  Effect.gen(function* () {
    const packageName = yield* resolveGoogleStorePackageName(commandInput.app);
    const googleStore = yield* loadActiveGoogleStore();
    const trackCatalog = yield* googleStore.listTracks(packageName);
    const tracksWithCountries = yield* Effect.forEach(
      trackCatalog,
      (trackDetails) =>
        googleStore.getCountryAvailability(packageName, trackDetails.track).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
          Effect.map((countryAvailability) => ({ ...trackDetails, countryAvailability })),
        ),
      { concurrency: 'unbounded' },
    );
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger.line(JSON.stringify(tracksWithCountries, null, 2));
      return;
    }
    if (tracksWithCountries.length === 0) {
      yield* logger.line(
        'No tracks yet. Upload a build (`launch submit --platform android`) to populate a track.',
      );
      return;
    }
    for (const trackDetails of tracksWithCountries) {
      yield* logger.line(`\n${trackDetails.track}`);
      if (trackDetails.releases.length === 0) yield* logger.line('  (no releases)');
      for (const playRelease of trackDetails.releases) {
        yield* logger.line(`  - ${describePlayRelease(playRelease)}`);
      }
      const countryCodes: string[] = [];
      const countryAvailability: PlayCountryAvailability | null = trackDetails.countryAvailability;
      if (countryAvailability !== null) {
        countryCodes.push(...countryAvailability.countries.map((country) => country.countryCode));
      }
      let countryScope = `${countryCodes.length} countr(ies)`;
      if (countryAvailability !== null && countryAvailability.restOfWorld === true) {
        countryScope = 'rest of world';
      }
      if (countryCodes.length === 0) countryScope = '-';
      yield* logger.line(`  countries: ${countryScope}`);
    }
  }).pipe(Effect.mapError((cause) => tracksFailure('status', cause)));

/** Resolve, confirm, and promote one release to a Play track. */
const promoteTrackRelease = (
  commandInput: PlayTracksPromoteInput,
): Effect.Effect<void, PlayTracksCommandFailure, PlayTracksCommandRequirements> =>
  Effect.gen(function* () {
    const packageName = yield* resolveGoogleStorePackageName(commandInput.app);
    const googleStore = yield* loadActiveGoogleStore();
    let versionCode = commandInput.version;
    if (versionCode === undefined) {
      const latestVersionCode = yield* googleStore.getLatestVersionCode(packageName);
      if (latestVersionCode === 0) {
        return yield* Effect.fail(
          makePlayTracksCommandFailure({
            operation: 'promote',
            message:
              'No uploaded build to promote. Run `launch submit --platform android` first, or pass --version.',
            cause: 'missing-build',
          }),
        );
      }
      versionCode = String(latestVersionCode);
    }
    const releaseStatus = yield* resolveReleaseStatus(commandInput);
    let rolloutFraction: number | undefined;
    const rolloutText = commandInput.rollout;
    if (rolloutText !== undefined) {
      rolloutFraction = yield* parseRollout(rolloutText).pipe(
        Effect.mapError((cause) => tracksFailure('promote', cause)),
      );
    }
    const releaseNotes = yield* readReleaseNotes(commandInput.notes);
    let releaseInput: ReleaseInput = { versionCodes: [versionCode], status: releaseStatus };
    if (rolloutFraction !== undefined) {
      releaseInput = { ...releaseInput, userFraction: rolloutFraction };
    }
    if (commandInput.name !== undefined) {
      releaseInput = { ...releaseInput, name: commandInput.name };
    }
    if (releaseNotes !== undefined) {
      releaseInput = { ...releaseInput, releaseNotes };
    }
    const playRelease = yield* buildRelease(releaseInput).pipe(
      Effect.mapError((cause) => tracksFailure('promote', cause)),
    );
    let rolloutDescription = '';
    if (playRelease.userFraction !== undefined) {
      rolloutDescription = ` at ${Math.round(playRelease.userFraction * 100)}%`;
    }
    const confirmed = yield* confirmGoogleStoreWrite(
      `Promote v${versionCode} to "${commandInput.track}" as ${releaseStatus}${rolloutDescription}?`,
      commandInput.yes,
      'Refusing to write without confirmation. Re-run with --yes (non-interactive).',
      'Aborted - no changes made.',
    );
    if (!confirmed) return;
    yield* googleStore.setTrackReleases(packageName, commandInput.track, [playRelease]);
    const logger = yield* createLogger(false);
    yield* logger.step(
      'promoted',
      `v${versionCode} -> ${commandInput.track} (${releaseStatus}${rolloutDescription})`,
    );
  }).pipe(Effect.mapError((cause) => tracksFailure('promote', cause)));

/** Read or replace the tester groups attached to a Play track. */
const manageTrackTesters = (
  commandInput: PlayTracksTestersInput,
): Effect.Effect<void, PlayTracksCommandFailure, PlayTracksCommandRequirements> =>
  Effect.gen(function* () {
    const packageName = yield* resolveGoogleStorePackageName(commandInput.app);
    const googleStore = yield* loadActiveGoogleStore();
    const logger = yield* createLogger(false);
    if (commandInput.groups === undefined) {
      const testerGroups = yield* googleStore.getTesters(packageName, commandInput.track);
      if (testerGroups.length === 0) {
        yield* logger.line('No tester groups set.');
        return;
      }
      yield* logger.line(testerGroups.map((groupEmail) => `- ${groupEmail}`).join('\n'));
      return;
    }
    const testerGroups = commandInput.groups
      .split(',')
      .map((groupEmail) => groupEmail.trim())
      .filter((groupEmail) => groupEmail.length > 0);
    const confirmed = yield* confirmGoogleStoreWrite(
      `Set ${testerGroups.length} tester group(s) on "${commandInput.track}"?`,
      commandInput.yes,
      'Refusing to write without confirmation. Re-run with --yes (non-interactive).',
      'Aborted - no changes made.',
    );
    if (!confirmed) return;
    yield* googleStore.setTesters(packageName, commandInput.track, testerGroups);
    yield* logger.step('testers set', `${testerGroups.length} group(s) on ${commandInput.track}`);
  }).pipe(Effect.mapError((cause) => tracksFailure('testers', cause)));

/** Dispatch one decoded Play tracks operation. */
const runPlayTracksOperation = (
  commandInput: PlayTracksCommandInput,
): Effect.Effect<void, PlayTracksCommandFailure, PlayTracksCommandRequirements> => {
  switch (commandInput.operation) {
    case 'status':
      return showTrackStatus(commandInput);
    case 'promote':
      return promoteTrackRelease(commandInput);
    case 'testers':
      return manageTrackTesters(commandInput);
  }
};

/** Run one schema-decoded Play tracks operation. */
export const playTracksCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, PlayTracksCommandFailure, PlayTracksCommandRequirements> =>
  Schema.decodeUnknown(PlayTracksCommandInputSchema)(rawCommandInput).pipe(
    Effect.mapError((cause) => tracksFailure('status', cause)),
    Effect.flatMap(runPlayTracksOperation),
  );
