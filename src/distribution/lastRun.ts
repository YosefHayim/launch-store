import { FileSystem, Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { resolveLastRunFilePath, type LaunchPathsService } from '../services/platform/paths.js';
import type { BumpKind } from '../release/version.js';

type AppMemory = {
  bump?: BumpKind;
};

type LastRunState = {
  lastApp?: string;
  apps: Record<string, AppMemory>;
};

const BumpKindSchema = Schema.Literal('major', 'minor', 'patch', 'keep');
const AppMemorySchema: Schema.Schema<AppMemory> = Schema.mutable(
  Schema.Struct({
    bump: Schema.optionalWith(BumpKindSchema, { exact: true }),
  }),
);
const LastRunStateSchema: Schema.Schema<LastRunState> = Schema.mutable(
  Schema.Struct({
    lastApp: Schema.optionalWith(Schema.String, { exact: true }),
    apps: Schema.mutable(Schema.Record({ key: Schema.String, value: AppMemorySchema })),
  }),
);

type LastRunRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

const emptyLastRunState = (): LastRunState => ({ apps: {} });

const resolveMemoryFilePath = (
  filePath: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> => {
  if (filePath !== undefined) return Effect.succeed(filePath);
  return resolveLastRunFilePath();
};

/** Reads remembered build choices, treating absent or malformed state as empty. */
export const readLastRun = (
  filePath?: string,
): Effect.Effect<LastRunState, never, LastRunRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const memoryFilePath = yield* resolveMemoryFilePath(filePath);
    const memoryExists = yield* fileSystem
      .exists(memoryFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!memoryExists) return emptyLastRunState();
    return yield* fileSystem
      .readFileString(memoryFilePath)
      .pipe(
        Effect.flatMap(Schema.decodeUnknown(Schema.parseJson(LastRunStateSchema))),
        Effect.orElseSucceed(emptyLastRunState),
      );
  });

/** Reads the most recently built app name. */
export const readLastApp = (
  filePath?: string,
): Effect.Effect<string | undefined, never, LastRunRequirements> =>
  readLastRun(filePath).pipe(Effect.map((memory) => memory.lastApp));

/** Reads the last version bump selected for an app. */
export const readLastBump = (
  appName: string,
  filePath?: string,
): Effect.Effect<BumpKind | undefined, never, LastRunRequirements> =>
  readLastRun(filePath).pipe(
    Effect.map((memory) => {
      const appMemory = memory.apps[appName];
      if (appMemory === undefined) return undefined;
      return appMemory.bump;
    }),
  );

/** Write last-run memory with parent directories created as needed. */
const writeLastRun = (
  memoryFilePath: string,
  memory: LastRunState,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fileSystem.makeDirectory(pathService.dirname(memoryFilePath), { recursive: true });
    yield* fileSystem.writeFileString(memoryFilePath, JSON.stringify(memory, null, 2));
  });

/** Records one successful build's app and optional version bump. */
export const rememberLastRun = (
  appName: string,
  bump?: BumpKind,
  filePath?: string,
): Effect.Effect<void, unknown, LastRunRequirements> =>
  Effect.gen(function* () {
    const memoryFilePath = yield* resolveMemoryFilePath(filePath);
    const memory = yield* readLastRun(memoryFilePath);
    let nextApps = memory.apps;
    if (bump !== undefined) {
      const priorAppMemory = memory.apps[appName];
      if (priorAppMemory === undefined) {
        nextApps = { ...memory.apps, [appName]: { bump } };
      } else {
        nextApps = { ...memory.apps, [appName]: { ...priorAppMemory, bump } };
      }
    }
    const nextMemory: LastRunState = {
      ...memory,
      lastApp: appName,
      apps: nextApps,
    };
    yield* writeLastRun(memoryFilePath, nextMemory);
  });
