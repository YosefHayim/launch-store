/**
 * The `local` storage provider — v1's only artifact backend.
 *
 * Copies each built artifact into `~/.launch/artifacts` and records it in a newest-first JSON index,
 * giving you a local build history with retrievable paths. It's deliberately shaped after the S3
 * object-store model ({@link StorageProvider}: put/list/url) so an R2/S3/Supabase provider is a
 * thin drop-in later — the pipeline calls these three methods regardless of where bytes land.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { BuildArtifact, StorageProvider, StoredArtifact } from "../../core/types.js";
import { ARTIFACT_INDEX, ARTIFACTS_DIR, ensureDir } from "../../core/paths.js";

/** Read the artifact index, tolerating a missing or empty file. */
function readIndex(): BuildArtifact[] {
  if (!existsSync(ARTIFACT_INDEX)) return [];
  try {
    return JSON.parse(readFileSync(ARTIFACT_INDEX, "utf8")) as BuildArtifact[];
  } catch {
    return [];
  }
}

export const localStorageProvider: StorageProvider = {
  name: "local",

  async put(artifact: BuildArtifact): Promise<StoredArtifact> {
    ensureDir(ARTIFACTS_DIR);
    const id = `${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${extname(artifact.path)}`;
    const dest = join(ARTIFACTS_DIR, id);
    copyFileSync(artifact.path, dest);
    const index = readIndex();
    index.unshift({ ...artifact, path: dest });
    writeFileSync(ARTIFACT_INDEX, JSON.stringify(index, null, 2));
    return { id, location: dest };
  },

  async list(): Promise<BuildArtifact[]> {
    return readIndex();
  },

  async url(id: string): Promise<string> {
    const path = join(ARTIFACTS_DIR, basename(id));
    if (!existsSync(path)) throw new Error(`No stored artifact with id "${id}".`);
    return path;
  },
};
