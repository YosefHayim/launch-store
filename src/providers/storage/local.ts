/**
 * The `local` storage provider — v1's only artifact backend.
 *
 * Copies each built artifact into a base directory (the global `~/.launch/artifacts` by default, or a
 * project-local dir when `artifactDir` is set) and records it in a newest-first JSON index, giving you a
 * local build history with retrievable paths. It's deliberately shaped after the S3 object-store model
 * ({@link StorageProvider}: put/list/url) so an R2/S3/Supabase provider is a thin drop-in later — the
 * pipeline calls these methods regardless of where bytes land.
 *
 * A factory (not a singleton) because the base directory is per-project: `core/storage.ts` resolves
 * `artifactDir` and builds the provider bound to it, mirroring the `s3` factory. The history index stays
 * GLOBAL (`~/.launch/artifacts/index.json`, absolute paths) — read/written via
 * {@link import("../../core/artifactRetention.js")}, shared with the retention sweep so both agree on the
 * on-disk format — so `dashboard`/list/retention work across projects no matter where the binaries land.
 * `prune` here is the only provider that implements it (cloud stores trim via their own bucket lifecycle).
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, dirname, extname, join } from "node:path";
import type { BuildArtifact, PruneOptions, PruneResult, StorageProvider, StoredArtifact } from "../../core/types.js";
import { ARTIFACTS_DIR, ensureDir } from "../../core/paths.js";
import { readArtifactIndex, runArtifactPrune, writeArtifactIndex } from "../../core/artifactRetention.js";

/**
 * Build a `local` {@link StorageProvider} that writes binaries (and raw objects under `<baseDir>/objects`)
 * into `baseDir`. Defaults to the global {@link ARTIFACTS_DIR} so the registered built-in and any
 * unconfigured run behave exactly as before; `core/storage.ts` passes a resolved `artifactDir` to relocate
 * the bytes into the project. The index is global regardless, so `list`/`prune` are unaffected by `baseDir`.
 */
export function createLocalStorageProvider(baseDir: string = ARTIFACTS_DIR): StorageProvider {
  const objectsDir = join(baseDir, "objects");
  /** Resolve a forward-slash object key to an absolute path under this provider's objects dir. */
  const objectPath = (key: string): string => join(objectsDir, ...key.split("/"));

  return {
    name: "local",

    async put(artifact: BuildArtifact): Promise<StoredArtifact> {
      ensureDir(baseDir);
      const id = `${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${extname(artifact.path)}`;
      const dest = join(baseDir, id);
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
      const path = join(baseDir, basename(id));
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
}

/** The default-dir (`~/.launch/artifacts`) local provider registered as a built-in for name-based lookup. */
export const localStorageProvider: StorageProvider = createLocalStorageProvider();
