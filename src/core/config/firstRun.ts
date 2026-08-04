import { FileSystem, type Path } from '@effect/platform';
import { Clock, Effect, Schema } from 'effect';
import {
  resolveLaunchHomeDirectory,
  resolveStateFilePath,
  type LaunchPathsService,
} from '../services/paths.js';

export type FirstRunState = {
  tourSeenAt?: string;
  ccacheOfferDeclinedAt?: string;
};

const FirstRunStateSchema: Schema.Schema<FirstRunState> = Schema.mutable(
  Schema.Struct({
    tourSeenAt: Schema.optionalWith(Schema.String, { exact: true }),
    ccacheOfferDeclinedAt: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

type FirstRunRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

/** Reads first-run state, treating absent or malformed state as empty. */
export const readFirstRunState = (): Effect.Effect<FirstRunState, never, FirstRunRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateFilePath = yield* resolveStateFilePath();
    const stateExists = yield* fileSystem
      .exists(stateFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!stateExists) return {};
    return yield* fileSystem.readFileString(stateFilePath).pipe(
      Effect.flatMap((stateText) => Effect.try(() => JSON.parse(stateText))),
      Effect.flatMap(Schema.decodeUnknown(FirstRunStateSchema)),
      Effect.orElseSucceed(() => ({})),
    );
  });

/** Merges one first-run flag without replacing unrelated state. */
const patchFirstRunState = (
  statePatch: Partial<FirstRunState>,
): Effect.Effect<void, unknown, FirstRunRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const launchHomeDirectory = yield* resolveLaunchHomeDirectory();
    const stateFilePath = yield* resolveStateFilePath();
    const currentState = yield* readFirstRunState();
    yield* fileSystem.makeDirectory(launchHomeDirectory, { recursive: true });
    yield* fileSystem.writeFileString(
      stateFilePath,
      JSON.stringify({ ...currentState, ...statePatch }, null, 2),
    );
  });

/** Reports whether the first-run tour has already been shown. */
export const hasSeenTour = (): Effect.Effect<boolean, never, FirstRunRequirements> =>
  readFirstRunState().pipe(Effect.map((state) => state.tourSeenAt !== undefined));

/** Records that the first-run tour has been shown. */
export const markTourSeen = (): Effect.Effect<void, unknown, FirstRunRequirements> =>
  Effect.gen(function* () {
    const epochMilliseconds = yield* Clock.currentTimeMillis;
    yield* patchFirstRunState({ tourSeenAt: new Date(epochMilliseconds).toISOString() });
  });

/** Reports whether the inline ccache offer was declined. */
export const ccacheOfferDeclined = (): Effect.Effect<boolean, never, FirstRunRequirements> =>
  readFirstRunState().pipe(Effect.map((state) => state.ccacheOfferDeclinedAt !== undefined));

/** Records that the inline ccache offer was declined. */
export const markCcacheOfferDeclined = (): Effect.Effect<void, unknown, FirstRunRequirements> =>
  Effect.gen(function* () {
    const epochMilliseconds = yield* Clock.currentTimeMillis;
    yield* patchFirstRunState({ ccacheOfferDeclinedAt: new Date(epochMilliseconds).toISOString() });
  });
