/**
 * The `s3` storage provider — one S3-compatible adapter covering AWS S3, Cloudflare R2, Backblaze B2,
 * and self-hosted MinIO (whichever the `endpoint`/`region` in `storageConfig` points at).
 *
 * It backs two needs at once: the build-artifact history ({@link StorageProvider.put}/`list`/`url`,
 * with a small `artifacts/index.json` object standing in for the local index) and the raw keyed
 * objects ad-hoc install links + OTA manifests upload ({@link StorageProvider.putObject}/`publicUrl`).
 * Files are served from {@link StorageConfig.publicBaseUrl} (an R2 custom domain, a CloudFront dist,
 * etc.), so the user owns the hosting — Launch never runs a server (the locked "BYO bucket" decision).
 *
 * Why `@aws-sdk/client-s3` (optional, lazy): SigV4 request signing can't be done with plain `fetch`,
 * and the v3 client speaks to every S3-compatible backend via one `endpoint`/`forcePathStyle` switch.
 * It's an optional dependency, dynamic-imported here so a `local`-storage install never pulls it.
 * Credentials resolve from env vars or the OS secret store (never from committed config); with neither
 * set and no custom endpoint, the AWS default credential chain applies (the plain-AWS-S3 case).
 */

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { BuildArtifact, StorageConfig, StorageProvider, StoredArtifact } from "../../core/types.js";
import { requireOptional } from "../../core/optionalDep.js";
import { getSecret } from "../../core/keychain.js";

/** The optional AWS S3 SDK module shape; type-only so the import stays erased + lazy. */
type S3Module = typeof import("@aws-sdk/client-s3");
type S3Client = InstanceType<S3Module["S3Client"]>;

const INSTALL_HINT = "npm install @aws-sdk/client-s3";
/** Object key under which the build-artifact history index is kept, mirroring the local `index.json`. */
const INDEX_KEY = "artifacts/index.json";

/** Lazy-load the S3 client module with an actionable hint when the optional package is absent. */
const loadS3 = (): Promise<S3Module> =>
  requireOptional("Cloud artifact storage (S3/R2/B2)", INSTALL_HINT, () => import("@aws-sdk/client-s3"));

/**
 * Resolve S3 credentials: explicit env vars first, then the OS secret store. Returns null when neither
 * is set — fine for plain AWS S3 (the SDK falls back to its default chain), but an explicit endpoint
 * (R2/B2/MinIO) has no such chain, so a null there surfaces as the SDK's own "no credentials" error.
 */
async function resolveCredentials(): Promise<{ accessKeyId: string; secretAccessKey: string } | null> {
  const accessKeyId = process.env["LAUNCH_S3_ACCESS_KEY_ID"] ?? (await getSecret("storage-s3-access-key-id"));
  const secretAccessKey =
    process.env["LAUNCH_S3_SECRET_ACCESS_KEY"] ?? (await getSecret("storage-s3-secret-access-key"));
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

/** Build a configured S3 client for the target bucket's endpoint/region, resolving credentials lazily. */
async function makeClient(config: StorageConfig): Promise<{ s3: S3Module; client: S3Client }> {
  const s3 = await loadS3();
  const credentials = await resolveCredentials();
  const client = new s3.S3Client({
    region: config.region ?? "auto",
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    ...(credentials ? { credentials } : {}),
  });
  return { s3, client };
}

/** Join the public base URL and an object key into a clean, single-slash URL. */
function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/**
 * Construct an S3-compatible {@link StorageProvider} bound to one bucket. A factory (not a singleton)
 * because it captures the per-project {@link StorageConfig}; `core/storage.ts` builds it from config.
 */
export function createS3StorageProvider(config: StorageConfig): StorageProvider {
  const publicUrl = (key: string): string => joinUrl(config.publicBaseUrl, key);

  /** Upload bytes to a key, then return its public location. */
  async function upload(key: string, body: Buffer | string, contentType: string): Promise<StoredArtifact> {
    const { s3, client } = await makeClient(config);
    await client.send(
      new s3.PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { id: key, location: publicUrl(key) };
  }

  /** Read the artifact index object, tolerating a not-yet-created (404) index. */
  async function readIndex(): Promise<BuildArtifact[]> {
    const { s3, client } = await makeClient(config);
    try {
      const response = await client.send(new s3.GetObjectCommand({ Bucket: config.bucket, Key: INDEX_KEY }));
      const text = await response.Body?.transformToString();
      return text ? (JSON.parse(text) as BuildArtifact[]) : [];
    } catch {
      return [];
    }
  }

  return {
    name: "s3",

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
      const { s3, client } = await makeClient(config);
      try {
        const response = await client.send(new s3.GetObjectCommand({ Bucket: config.bucket, Key: key }));
        const bytes = await response.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch {
        return null;
      }
    },

    publicUrl,
  };
}
