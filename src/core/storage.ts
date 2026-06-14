/**
 * Resolve the {@link StorageProvider} for a run from config.
 *
 * `local` is a registered singleton (no config needed). The cloud providers (`s3`, `supabase`) are
 * built per-run by their factories because they capture the project's {@link StorageConfig} (bucket,
 * endpoint, public URL) — config that isn't known at startup when the registry is populated. Any other
 * name falls through to the registry, so a user can still register a custom provider the usual way.
 *
 * This is the single entry point the pipeline and the ad-hoc/OTA commands call, so storage selection
 * lives in exactly one place.
 */

import type { LaunchConfig, StorageProvider } from "./types.js";
import { getStorageProvider } from "./registry.js";
import { createS3StorageProvider } from "../providers/storage/s3.js";
import { createSupabaseStorageProvider } from "../providers/storage/supabase.js";

/** Build (or look up) the storage provider named by `config.storage`, wiring in `storageConfig` for cloud backends. */
export function resolveStorageProvider(config: LaunchConfig): StorageProvider {
  switch (config.storage) {
    case "local":
      return getStorageProvider("local");
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
