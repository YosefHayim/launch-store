/**
 * The `supabase` storage provider — uploads to a Supabase Storage bucket over its REST API.
 *
 * Deliberately dependency-free: Supabase Storage is a plain authenticated HTTP API, so this talks to
 * it with the built-in `fetch` rather than pulling `@supabase/storage-js`. That keeps the install lean
 * (the only cloud SDK Launch adds is `@aws-sdk/client-s3` for the SigV4-signed S3 path) and avoids a
 * dependency that would otherwise need lazy-loading anyway. Like the S3 provider it serves both the
 * build-artifact history and the raw keyed objects ad-hoc + OTA need, from the user's own project.
 *
 * Credentials: the service-role key resolves from `LAUNCH_SUPABASE_SERVICE_KEY` or the OS secret store
 * (`storage-supabase-service-key`) — never from committed config. The project URL is non-secret config.
 */

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { BuildArtifact, StorageConfig, StorageProvider, StoredArtifact } from "../../core/types.js";
import { getSecret } from "../../core/keychain.js";

/** Object key under which the build-artifact history index is kept, mirroring the local `index.json`. */
const INDEX_KEY = "artifacts/index.json";

/** Resolve the Supabase service-role key from env or the OS secret store, failing with an actionable message. */
async function resolveServiceKey(): Promise<string> {
  const key = process.env["LAUNCH_SUPABASE_SERVICE_KEY"] ?? (await getSecret("storage-supabase-service-key"));
  if (!key) {
    throw new Error(
      "No Supabase service key found. Set LAUNCH_SUPABASE_SERVICE_KEY or store it with `launch creds` " +
        "(account: storage-supabase-service-key).",
    );
  }
  return key;
}

/** Join two URL parts into a clean, single-slash URL. */
function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/**
 * Construct a Supabase Storage {@link StorageProvider} bound to one project + bucket. A factory (not a
 * singleton) because it captures the per-project {@link StorageConfig}; `core/storage.ts` builds it.
 */
export function createSupabaseStorageProvider(config: StorageConfig): StorageProvider {
  const projectUrl = config.supabaseUrl;
  if (!projectUrl)
    throw new Error('The "supabase" storage provider needs `storageConfig.supabaseUrl` in launch.config.ts.');
  /** REST endpoint for an object at `key` within the configured bucket. */
  const objectEndpoint = (key: string): string =>
    `${projectUrl.replace(/\/+$/, "")}/storage/v1/object/${config.bucket}/${key}`;
  const publicUrl = (key: string): string => joinUrl(config.publicBaseUrl, key);

  /** Upload bytes to a key (upsert), then return its public location. */
  async function upload(key: string, body: Buffer | string, contentType: string): Promise<StoredArtifact> {
    const serviceKey = await resolveServiceKey();
    const response = await fetch(objectEndpoint(key), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Supabase upload of ${key} failed (${response.status}): ${await response.text()}`);
    }
    return { id: key, location: publicUrl(key) };
  }

  /** Read the artifact index object, tolerating a not-yet-created index. */
  async function readIndex(): Promise<BuildArtifact[]> {
    const serviceKey = await resolveServiceKey();
    const response = await fetch(objectEndpoint(INDEX_KEY), { headers: { Authorization: `Bearer ${serviceKey}` } });
    if (!response.ok) return [];
    try {
      return JSON.parse(await response.text()) as BuildArtifact[];
    } catch {
      return [];
    }
  }

  return {
    name: "supabase",

    async put(artifact: BuildArtifact): Promise<StoredArtifact> {
      const key = `artifacts/${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${extname(artifact.path)}`;
      const stored = await upload(key, readFileSync(artifact.path), "application/octet-stream");
      const index = await readIndex();
      index.unshift({ ...artifact, path: stored.location });
      await upload(INDEX_KEY, JSON.stringify(index, null, 2), "application/json");
      return stored;
    },

    list(): Promise<BuildArtifact[]> {
      return readIndex();
    },

    async url(id: string): Promise<string> {
      return publicUrl(id.startsWith("artifacts/") ? id : `artifacts/${id}`);
    },

    putObject(key: string, body: Buffer | string, contentType: string): Promise<StoredArtifact> {
      return upload(key, body, contentType);
    },

    async getObject(key: string): Promise<Buffer | null> {
      const serviceKey = await resolveServiceKey();
      const response = await fetch(objectEndpoint(key), { headers: { Authorization: `Bearer ${serviceKey}` } });
      return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    },

    publicUrl,
  };
}
