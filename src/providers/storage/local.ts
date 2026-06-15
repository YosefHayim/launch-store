/**
 * The `local` storage provider — v1's only artifact backend.
 *
 * Copies each built artifact into `~/.launch/artifacts` and records it in a newest-first JSON index,
 * giving you a local build history with retrievable paths. It's deliberately shaped after the S3
 * object-store model ({@link StorageProvider}: put/list/url) so an R2/S3/Supabase provider is a
 * thin drop-in later — the pipeline calls these methods regardless of where bytes land. Index read/write
 * lives in {@link import("../../core/artifactRetention.js")}, shared with the retention sweep so both
 * agree on the on-disk format; `prune` here is the only provider that implements it (cloud stores trim via
 * their own bucket lifecycle).
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, dirname, extname, join } from "node:path";
import type { BuildArtifact, PruneOptions, PruneResult, StorageProvider, StoredArtifact } from "../../core/types.js";
import { ARTIFACTS_DIR, ensureDir } from "../../core/paths.js";
import { readArtifactIndex, runArtifactPrune, writeArtifactIndex } from "../../core/artifactRetention.js";

/** Where raw keyed objects (install plists, OTA manifests/bundles) land under the local store. */
const OBJECTS_DIR = join(ARTIFACTS_DIR, "objects");

/** Resolve a forward-slash object key to an absolute path under {@link OBJECTS_DIR}. */
function objectPath(key: string): string {
  return join(OBJECTS_DIR, ...key.split("/"));
}

export const localStorageProvider: StorageProvider = {
  name: "local",

  async put(artifact: BuildArtifact): Promise<StoredArtifact> {
    ensureDir(ARTIFACTS_DIR);
    const id = `${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${extname(artifact.path)}`;
    const dest = join(ARTIFACTS_DIR, id);
    copyFileSync(artifact.path, dest);
    const index = readArtifactIndex();
    index.unshift({ ...artifact, path: dest });
    writeArtifactIndex(index);
    return { id, location: dest };
  },

  async list(): Promise<BuildArtifact[]> {
    return readArtifactIndex();
  },

  /** Trim binaries older than the window, keeping the newest per app+platform. See {@link runArtifactPrune}. */
  async prune(options: PruneOptions): Promise<PruneResult> {
    return runArtifactPrune(options);
  },

  async url(id: string): Promise<string> {
    const path = join(ARTIFACTS_DIR, basename(id));
    if (!existsSync(path)) throw new Error(`No stored artifact with id "${id}".`);
    return path;
  },

  async putObject(key: string, body: Buffer | string, _contentType: string): Promise<StoredArtifact> {
    const dest = objectPath(key);
    ensureDir(dirname(dest));
    writeFileSync(dest, body);
    return { id: key, location: pathToFileURL(dest).href };
  },

  async getObject(key: string): Promise<Buffer | null> {
    const path = objectPath(key);
    return existsSync(path) ? readFileSync(path) : null;
  },

  publicUrl(key: string): string {
    return pathToFileURL(objectPath(key)).href;
  },
};
