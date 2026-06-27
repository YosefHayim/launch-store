/**
 * The OTA publish core: assemble + sign + upload one platform's update manifest, lifted out of
 * `cli/commands/update.ts` so both `launch update` and `launch release-train` (ADR 0004 D4) publish JS
 * the exact same way — no duplicated upload logic. Behavior-preserving: same export-metadata reading,
 * same key layout, same history record, same rollback-clear as the original command body.
 *
 * Dependency-injected (the resolved {@link StorageProvider} and an optional {@link CodeSigner} come in as
 * parameters) so it's unit-testable against an in-memory bucket and the train can hand it an already-
 * resolved storage provider.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageProvider } from './types.js';
import type { Logger } from './logger.js';
import type { CodeSigner } from './codeSign.js';
import {
  assembleManifest,
  contentTypeFor,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  type ManifestAsset,
} from './otaManifest.js';
import { clearRollbackDirective, recordPublish } from './updateHistory.js';

/** The subset of `expo export`'s `metadata.json` Launch reads: per-platform bundle + asset paths. */
export interface ExportMetadata {
  fileMetadata: Record<string, { bundle: string; assets: { path: string; ext: string }[] }>;
}

/** Read and parse `metadata.json` from an `expo export` output directory. */
export function readExportMetadata(distDir: string): ExportMetadata {
  const path = join(distDir, 'metadata.json');
  if (!existsSync(path))
    throw new Error(`No metadata.json in ${distDir} — did \`expo export\` run?`);
  return JSON.parse(readFileSync(path, 'utf8')) as ExportMetadata;
}

/** Everything {@link publishOtaPlatform} needs to publish one platform's manifest. */
export interface OtaPublishInput {
  /** The resolved artifact store the manifest + assets upload to. */
  storage: StorageProvider;
  /** The `expo export` output directory holding the bundle + assets named by {@link metadata}. */
  distDir: string;
  /** The parsed `metadata.json` from that export. */
  metadata: ExportMetadata;
  /** Which platform's bundle to publish. */
  platform: 'ios' | 'android';
  /** The release channel to publish under. */
  channel: string;
  /** The runtime version this update targets. */
  runtimeVersion: string;
  /** A resolved signer to code-sign the manifest, or `null` to publish unsigned (`--no-sign`). */
  signer: CodeSigner | null;
}

/** What a successful platform publish produced — enough for the caller to log and for a train to record. */
export interface OtaPublishResult {
  /** Whether a bundle for this platform existed in the export (false ⇒ nothing published). */
  published: boolean;
  /** The published manifest's UUID (absent when `published` is false). */
  manifestId?: string;
  /** ISO-8601 publish timestamp (absent when `published` is false). */
  createdAt?: string;
  /** Number of non-bundle assets uploaded. */
  assetCount: number;
  /** The `updates/<channel>/<platform>/<runtimeVersion>` prefix the manifest now lives under. */
  prefix: string;
}

/**
 * Publish one platform's manifest: upload the bundle + assets, assemble + (optionally) sign the manifest,
 * upload it with an immutable history snapshot, record the publish, and clear any prior rollback directive
 * for this runtime version. A no-op (returns `published: false`) when the export has no bundle for the
 * platform, matching the command's original skip-with-warning.
 */
export async function publishOtaPlatform(
  input: OtaPublishInput,
  log: Logger,
): Promise<OtaPublishResult> {
  const { storage, distDir, metadata, platform, channel, runtimeVersion, signer } = input;
  const prefix = `updates/${channel}/${platform}/${runtimeVersion}`;

  const platformMeta = metadata.fileMetadata[platform];
  if (!platformMeta) {
    log.warn(`No ${platform} bundle in the export — skipping.`);
    return { published: false, assetCount: 0, prefix };
  }

  /** Upload one exported file and return its manifest asset entry. */
  const upload = async (relativePath: string, ext?: string): Promise<ManifestAsset> => {
    const key = `${prefix}/${relativePath}`;
    await storage.putObject(
      key,
      readFileSync(join(distDir, relativePath)),
      contentTypeFor(relativePath),
    );
    const base: ManifestAsset = {
      key: relativePath,
      contentType: contentTypeFor(relativePath),
      url: storage.publicUrl(key),
    };
    return ext ? { ...base, fileExtension: `.${ext}` } : base;
  };

  const launchAsset = await upload(platformMeta.bundle);
  const assets = await Promise.all(
    platformMeta.assets.map((asset) => upload(asset.path, asset.ext)),
  );

  const manifest = assembleManifest({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion,
    launchAsset,
    assets,
  });
  const body = JSON.stringify(manifest);
  await storage.putObject(manifestKey(channel, platform, runtimeVersion), body, 'application/json');
  // Immutable snapshot so `launch updates view`/`rollback` can read this exact manifest back later.
  await storage.putObject(
    historySnapshotKey(channel, platform, runtimeVersion, manifest.id),
    body,
    'application/json',
  );

  if (signer) {
    await storage.putObject(
      manifestSignatureKey(channel, platform, runtimeVersion),
      signer.sign(body),
      'text/plain',
    );
  }

  await recordPublish(storage, channel, platform, {
    id: manifest.id,
    runtimeVersion,
    createdAt: manifest.createdAt,
    active: true,
    signed: signer !== null,
    kind: 'publish',
  });
  // A fresh publish supersedes any prior `--to-embedded` rollback for this runtime version.
  await clearRollbackDirective(storage, channel, platform, runtimeVersion);
  log.step('update', `${platform} · ${assets.length} asset(s) → ${prefix}/`, 'ota-update');

  return {
    published: true,
    manifestId: manifest.id,
    createdAt: manifest.createdAt,
    assetCount: assets.length,
    prefix,
  };
}
