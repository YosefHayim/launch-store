// Persists redacted native-build logs under Launch's local state directory.

import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { resolveLogsDirectory } from '../services/paths.js';
import { redactText } from '../services/redact.js';
import type { Platform } from '../types/app.js';

/** Natural-key fields that identify one build log. */
export type BuildLogKey = Readonly<{
  appName: string;
  version: string;
  buildNumber: number;
  platform: Platform;
}>;

/** Build a stable log identifier from a build's natural key. */
export const buildLogId = (buildKey: BuildLogKey): string =>
  `${buildKey.appName}-${buildKey.version}-${buildKey.buildNumber}-${buildKey.platform}`;

/** Resolve the persisted log path for a build identifier. */
export const buildLogPath = (buildIdentifier: string) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const logsDirectory = yield* resolveLogsDirectory();
    const safeIdentifier = buildIdentifier.replace(/[^A-Za-z0-9._-]/g, '-');
    return pathService.join(logsDirectory, `${safeIdentifier}.log`);
  });

/** Read and redact a persisted build log, returning null when it is unavailable. */
export const readBuildLog = (buildIdentifier: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const logPath = yield* buildLogPath(buildIdentifier);
    return yield* fileSystem.readFileString(logPath).pipe(
      Effect.map(redactText),
      Effect.catchAll(() => Effect.succeed(null)),
    );
  });

let activeBuildLog: string | null = null;

/** Begin a fresh per-build log and mark it as the active progress log. */
export const beginBuildLog = (buildIdentifier: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const logPath = yield* buildLogPath(buildIdentifier);
    yield* fileSystem.makeDirectory(pathService.dirname(logPath), { recursive: true });
    yield* fileSystem.writeFileString(logPath, '');
    activeBuildLog = logPath;
    return logPath;
  });

/** Stop routing progress output into a per-build log. */
export const endBuildLog = (): Effect.Effect<void> =>
  Effect.sync(() => {
    activeBuildLog = null;
  });

/** Return the current per-build log path, or null when no build owns one. */
export const currentBuildLog = (): string | null => activeBuildLog;
