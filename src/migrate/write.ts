import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.js';
import type { MigrationResult } from '../types/migrate.js';

type WriteOptions = Readonly<{
  readonly outDir: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}>;

type WriteOutcome = Readonly<{
  readonly written: string[];
  readonly skipped: string[];
}>;

function shouldKeepExistingFile(artifactExists: boolean, isForced: boolean): boolean {
  if (artifactExists == false) {
    return false;
  }

  return isForced == false;
}

/** Write or classify migration artifacts under the requested output directory. */
export async function writeArtifacts(
  migration: MigrationResult,
  writeOptions: WriteOptions,
): Promise<WriteOutcome> {
  const writtenArtifacts: string[] = [];
  const skippedArtifacts: string[] = [];

  for (const migrationArtifact of migration.artifacts) {
    const artifactPath = join(writeOptions.outDir, migrationArtifact.path);
    const artifactExists = await pathExists(artifactPath);
    const isForced = writeOptions.force == true;
    const shouldKeepExisting = shouldKeepExistingFile(artifactExists, isForced);

    if (shouldKeepExisting) {
      skippedArtifacts.push(migrationArtifact.path);
      continue;
    }

    const isDryRun = writeOptions.dryRun == true;

    if (isDryRun == false) {
      await writeFile(artifactPath, migrationArtifact.contents);
    }

    writtenArtifacts.push(migrationArtifact.path);
  }

  return { written: writtenArtifacts, skipped: skippedArtifacts };
}
