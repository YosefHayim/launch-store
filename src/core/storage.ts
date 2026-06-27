/**
 * Resolve the {@link StorageProvider} for a run from config.
 *
 * `local` is built per-run by its factory so it can be bound to the resolved `artifactDir` (the global
 * `~/.launch/artifacts` by default, or a project-local dir). The cloud providers (`s3`, `supabase`) are
 * likewise built per-run by their factories because they capture the project's {@link StorageConfig}
 * (bucket, endpoint, public URL) — config that isn't known at startup when the registry is populated. Any
 * other name falls through to the registry, so a user can still register a custom provider the usual way.
 *
 * This is the single entry point the pipeline and the ad-hoc/OTA commands call, so storage selection
 * lives in exactly one place.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { BuildArtifact, LaunchConfig, Platform, StorageProvider } from "./types.js";
import { getStorageProvider } from "./registry.js";
import { ARTIFACTS_DIR } from "./paths.js";
import { createLocalStorageProvider } from "../providers/storage/local.js";
import { createS3StorageProvider } from "../providers/storage/s3.js";
import { createSupabaseStorageProvider } from "../providers/storage/supabase.js";

/**
 * Resolve `config.artifactDir` to the absolute base directory the `local` provider writes into. A relative
 * path resolves against `projectRoot` (the `launch.config.ts` directory); a leading `~/` expands to home;
 * an absolute path is used as-is. Omitted → the global {@link ARTIFACTS_DIR} (`~/.launch/artifacts`), so an
 * existing project with no `artifactDir` is unaffected. Throws on an empty string (a likely config typo).
 */
export function resolveArtifactDir(artifactDir: string | undefined, projectRoot: string = process.cwd()): string {
  if (artifactDir === undefined) return ARTIFACTS_DIR;
  const raw = artifactDir.trim();
  if (raw === "") {
    throw new Error(
      "`artifactDir` in launch.config.ts must not be empty — set a path or omit it for ~/.launch/artifacts.",
    );
  }
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return resolve(homedir(), raw.slice(2));
  return isAbsolute(raw) ? raw : resolve(projectRoot, raw);
}

/**
 * Build (or look up) the storage provider named by `config.storage`, wiring in the resolved `artifactDir`
 * for `local` and `storageConfig` for cloud backends. `projectRoot` anchors a relative `artifactDir`; it
 * defaults to the current directory (the project root, since the config loads from there), so the many
 * read-path callers need not pass it.
 */
export function resolveStorageProvider(config: LaunchConfig, projectRoot: string = process.cwd()): StorageProvider {
  switch (config.storage) {
    case "local":
      return createLocalStorageProvider(resolveArtifactDir(config.artifactDir, projectRoot));
    case "s3":
    case "supabase": {
      const storageConfig = config.storageConfig;
      if (!storageConfig) {
        throw new Error(
          `storage "${config.storage}" needs a \`storageConfig\` block in launch.config.ts (bucket + publicBaseUrl).`,
        );
      }
      return config.storage === "s3"
        ? createS3StorageProvider(storageConfig)
        : createSupabaseStorageProvider(storageConfig);
    }
    default:
      return getStorageProvider(config.storage);
  }
}

/**
 * Whether the resolved storage can serve public HTTP(S) URLs — required for ad-hoc install links and
 * OTA manifests, which are useless behind a `file://` path. `local` is for build-artifact history only.
 */
export function isCloudStorage(config: LaunchConfig): boolean {
  return config.storage !== "local";
}

/**
 * Guard a promote/submit that reuses a stored binary. The newest build per app+platform is never
 * auto-pruned, so this normally passes — but a manually-deleted or pruned binary turns a deep submit
 * failure (an opaque fastlane/Play file error) into a clear "rebuild first" precondition message instead.
 * Shared by `launch release` and the release train so every promote path guards the artifact identically.
 */
export function ensureArtifactPresent(artifact: BuildArtifact, appName: string, platform: Platform): void {
  if (artifact.prunedAt || !existsSync(artifact.path)) {
    throw new Error(
      `The latest stored ${appName} ${platform} build was pruned to reclaim disk. ` +
        `Run \`launch build ${platform}\` to rebuild before releasing.`,
    );
  }
}
