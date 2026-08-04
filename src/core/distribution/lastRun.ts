import { FileSystem, Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { resolveLastRunFilePath, type LaunchPathsService } from '../services/paths.js';
import type { BumpKind } from '../release/version.js';
import type { BuildLocation, Platform } from '../types/app.js';

type AppMemory = {
  bump?: BumpKind;
};

export type LastFlow = {
  platform: Platform;
  location: BuildLocation;
  sshTarget?: string;
  account?: string;
  profile: string;
  submit: boolean;
};

export type LastRunState = {
  lastApp?: string;
  apps: Record<string, AppMemory>;
  lastFlow?: LastFlow;
};

const BumpKindSchema = Schema.Literal('major', 'minor', 'patch', 'keep');
const AppMemorySchema: Schema.Schema<AppMemory> = Schema.mutable(
  Schema.Struct({
    bump: Schema.optionalWith(BumpKindSchema, { exact: true }),
  }),
);
const LastFlowSchema: Schema.Schema<LastFlow> = Schema.mutable(
  Schema.Struct({
    platform: Schema.Literal('ios', 'android', 'tvos', 'macos', 'visionos'),
    location: Schema.Literal('local', 'aws', 'ssh', 'eas'),
    sshTarget: Schema.optionalWith(Schema.String, { exact: true }),
    account: Schema.optionalWith(Schema.String, { exact: true }),
    profile: Schema.String,
    submit: Schema.Boolean,
  }),
);
const LastRunStateSchema: Schema.Schema<LastRunState> = Schema.mutable(
  Schema.Struct({
    lastApp: Schema.optionalWith(Schema.String, { exact: true }),
    apps: Schema.mutable(Schema.Record({ key: Schema.String, value: AppMemorySchema })),
    lastFlow: Schema.optionalWith(LastFlowSchema, { exact: true }),
  }),
);
type LastRunRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

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
    if (!memoryExists) return { apps: {} };
    return yield* fileSystem.readFileString(memoryFilePath).pipe(
      Effect.flatMap((memoryText) => Effect.try(() => JSON.parse(memoryText))),
      Effect.flatMap(Schema.decodeUnknown(LastRunStateSchema)),
      Effect.orElseSucceed(() => ({ apps: {} })),
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
  readLastRun(filePath).pipe(Effect.map((memory) => memory.apps[appName]?.bump));

/** Records one successful build's app and optional version bump. */
export const rememberLastRun = (
  appName: string,
  bump?: BumpKind,
  filePath?: string,
): Effect.Effect<void, unknown, LastRunRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const memoryFilePath = yield* resolveMemoryFilePath(filePath);
    const memory = yield* readLastRun(memoryFilePath);
    memory.lastApp = appName;
    if (bump !== undefined) memory.apps[appName] = { ...memory.apps[appName], bump };
    yield* fileSystem.makeDirectory(pathService.dirname(memoryFilePath), { recursive: true });
    yield* fileSystem.writeFileString(memoryFilePath, JSON.stringify(memory, null, 2));
  });

/** Reads the most recent wizard build flow. */
export const readLastFlow = (
  filePath?: string,
): Effect.Effect<LastFlow | undefined, never, LastRunRequirements> =>
  readLastRun(filePath).pipe(Effect.map((memory) => memory.lastFlow));

/** Records one successful wizard build flow without replacing bump memory. */
export const rememberLastFlow = (
  flow: LastFlow,
  filePath?: string,
): Effect.Effect<void, unknown, LastRunRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const memoryFilePath = yield* resolveMemoryFilePath(filePath);
    const memory = yield* readLastRun(memoryFilePath);
    memory.lastFlow = flow;
    yield* fileSystem.makeDirectory(pathService.dirname(memoryFilePath), { recursive: true });
    yield* fileSystem.writeFileString(memoryFilePath, JSON.stringify(memory, null, 2));
  });
