import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect } from 'effect';
import type { MigrationResult } from '../types/migrate.js';

export type WriteOptions = Readonly<{
  readonly outDir: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}>;

export type WriteOutcome = Readonly<{
  readonly written: string[];
  readonly skipped: string[];
}>;

/** Write or classify migration artifacts under the requested output directory. */
export const writeArtifacts = (
  migration: MigrationResult,
  writeOptions: WriteOptions,
): Effect.Effect<WriteOutcome, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const writtenArtifacts: string[] = [];
    const skippedArtifacts: string[] = [];
    for (const migrationArtifact of migration.artifacts) {
      const artifactPath = pathService.join(writeOptions.outDir, migrationArtifact.path);
      const artifactExists = yield* fileSystem.exists(artifactPath);
      if (artifactExists && writeOptions.force !== true) {
        skippedArtifacts.push(migrationArtifact.path);
        continue;
      }
      if (writeOptions.dryRun !== true) {
        yield* fileSystem.writeFileString(artifactPath, migrationArtifact.contents);
      }
      writtenArtifacts.push(migrationArtifact.path);
    }
    return { written: writtenArtifacts, skipped: skippedArtifacts };
  });
