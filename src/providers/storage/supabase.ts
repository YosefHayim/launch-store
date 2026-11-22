import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { readLaunchEnvironment } from '../../services/platform/environment.ts';
import { LaunchSecretStore } from '../../services/credentials/secret-store.ts';
import { decodeArtifactIndex } from './s3.ts';

import type { BuildArtifact, StoredArtifact } from '../../types/artifacts.ts';
import type { StorageConfig } from '../../types/config.ts';
import {
  makeProviderInputFailure,
  type StorageProvider,
  type StorageProviderResolver,
} from '../../types/providers.ts';

const INDEX_OBJECT_KEY = 'artifacts/index.json';

function joinPublicUrl(publicBaseUrl: string, objectKey: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${objectKey.replace(/^\/+/, '')}`;
}

function isSuccessStatus(status: number): boolean {
  const isBelowSuccess = status < 200;

  if (isBelowSuccess) {
    return false;
  }

  return status < 300;
}

async function resolveServiceKey(): Promise<string> {
  const environment = readLaunchEnvironment();
  let serviceKey = await LaunchSecretStore.readSecret('storage-supabase-service-key');

  if (environment.values.supabaseServiceKey != null) {
    serviceKey = environment.values.supabaseServiceKey;
  }

  if (serviceKey == null) {
    throw makeProviderInputFailure({
      provider: 'supabase-storage',
      message:
        'No Supabase service key found. Set LAUNCH_SUPABASE_SERVICE_KEY or store account storage-supabase-service-key with `launch-store creds`.',
    });
  }

  if (serviceKey == '') {
    throw makeProviderInputFailure({
      provider: 'supabase-storage',
      message:
        'No Supabase service key found. Set LAUNCH_SUPABASE_SERVICE_KEY or store account storage-supabase-service-key with `launch-store creds`.',
    });
  }

  return serviceKey;
}

function requireSuccessfulRead(status: number, objectKey: string): void {
  if (isSuccessStatus(status)) {
    return;
  }

  throw makeProviderInputFailure({
    provider: 'supabase-storage',
    message: `Supabase read of ${objectKey} failed (${status}).`,
  });
}

export async function makeSupabaseStorageProvider(
  storageConfig: StorageConfig,
): Promise<StorageProvider> {
  if (storageConfig.supabaseUrl == null) {
    throw makeProviderInputFailure({
      provider: 'supabase-storage',
      message:
        'The "supabase" storage provider needs storageConfig.supabaseUrl in launch.config.ts.',
    });
  }

  const projectUrl = storageConfig.supabaseUrl;

  function objectEndpoint(objectKey: string): string {
    return `${projectUrl.replace(/\/+$/, '')}/storage/v1/object/${storageConfig.bucket}/${objectKey}`;
  }

  function publicUrl(objectKey: string): string {
    return joinPublicUrl(storageConfig.publicBaseUrl, objectKey);
  }

  async function upload(
    objectKey: string,
    objectContents: Buffer | string,
    contentType: string,
  ): Promise<StoredArtifact> {
    const serviceKey = await resolveServiceKey();
    const uploadReply = await fetch(objectEndpoint(objectKey), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: objectContents,
    });

    if (isSuccessStatus(uploadReply.status) == false) {
      const failureDetail = await uploadReply.text();

      throw makeProviderInputFailure({
        provider: 'supabase-storage',
        message: `Supabase upload of ${objectKey} failed (${uploadReply.status}): ${failureDetail}`,
      });
    }

    return { id: objectKey, location: publicUrl(objectKey) };
  }

  async function readIndex(): Promise<BuildArtifact[]> {
    const serviceKey = await resolveServiceKey();
    const indexReply = await fetch(objectEndpoint(INDEX_OBJECT_KEY), {
      headers: { Authorization: `Bearer ${serviceKey}` },
    });

    if (indexReply.status == 404) {
      return [];
    }

    requireSuccessfulRead(indexReply.status, INDEX_OBJECT_KEY);
    const indexText = await indexReply.text();

    return decodeArtifactIndex(indexText);
  }

  async function putArtifact(artifact: BuildArtifact): Promise<StoredArtifact> {
    const objectKey = `artifacts/${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${extname(artifact.path)}`;
    const artifactBytes = await readFile(artifact.path);
    const uploadedArtifact = await upload(objectKey, artifactBytes, 'application/octet-stream');
    const artifactIndex = await readIndex();

    artifactIndex.unshift({ ...artifact, path: uploadedArtifact.location });
    const serialized = JSON.stringify(artifactIndex, null, 2);
    await upload(INDEX_OBJECT_KEY, serialized, 'application/json');

    return uploadedArtifact;
  }

  async function locateArtifact(artifactId: string): Promise<string> {
    let objectKey = artifactId;

    if (objectKey.startsWith('artifacts/') == false) {
      objectKey = `artifacts/${objectKey}`;
    }

    return publicUrl(objectKey);
  }

  async function getObject(objectKey: string): Promise<Buffer | null> {
    const serviceKey = await resolveServiceKey();
    const objectReply = await fetch(objectEndpoint(objectKey), {
      headers: { Authorization: `Bearer ${serviceKey}` },
    });

    if (objectReply.status == 404) {
      return null;
    }

    requireSuccessfulRead(objectReply.status, objectKey);
    const objectBytes = await objectReply.arrayBuffer();

    return Buffer.from(objectBytes);
  }

  return {
    name: 'supabase',
    put: putArtifact,
    list: readIndex,
    url: locateArtifact,
    putObject: upload,
    getObject,
    publicUrl,
  };
}

export function makeSupabaseStorageProviderResolver(): StorageProviderResolver {
  return {
    name: 'supabase',
    resolveStorageProvider(providerOptions) {
      if (providerOptions.storageConfig == null) {
        const makeProviderFailure = makeProviderInputFailure({
          provider: 'supabase',
          message:
            'Storage "supabase" needs a storageConfig block in launch.config.ts (bucket + publicBaseUrl).',
        });
        return Promise.reject(makeProviderFailure);
      }

      return makeSupabaseStorageProvider(providerOptions.storageConfig);
    },
  };
}
