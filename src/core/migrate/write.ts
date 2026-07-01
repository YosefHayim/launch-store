/**
 * Persist a {@link MigrationResult}'s artifacts to disk — the one place `launch migrate` writes files,
 * shared across every migration source (EAS today, fastlane in #172). Honors the migration contract:
 * never overwrite an existing file unless `force` is set, so re-running a migration over a project you've
 * since hand-edited is safe. `dryRun` classifies without writing, so the command's `--dry-run` preview
 * and its real run share one code path (no second copy of the overwrite logic).
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MigrationResult } from '../types.js';

/** Where and how to persist artifacts. */
export interface WriteOptions {
  /** Directory the artifact paths are resolved against. */
  outDir: string;
  /** Overwrite files that already exist (default: keep them). */
  force?: boolean;
  /** Classify what would happen without writing anything (powers `--dry-run`). */
  dryRun?: boolean;
}

/** What a write run did: the artifact paths written versus those kept because they already exist. */
export interface WriteOutcome {
  written: string[];
  skipped: string[];
}

/**
 * Write (or, with `dryRun`, just classify) a result's artifacts under `outDir`. An artifact whose target
 * already exists is skipped unless `force` is set; everything else is written. Paths in the outcome are
 * output-relative (the artifact's own `path`), so they read the same in a report and on the CLI.
 */
export function writeArtifacts(result: MigrationResult, options: WriteOptions): WriteOutcome {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const artifact of result.artifacts) {
    if (existsSync(join(options.outDir, artifact.path)) && options.force !== true) {
      skipped.push(artifact.path);
      continue;
    }
    if (options.dryRun !== true)
      writeFileSync(join(options.outDir, artifact.path), artifact.contents);
    written.push(artifact.path);
  }
  return { written, skipped };
}
