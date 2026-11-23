// Stores build artifacts on this machine and prunes copies that are no longer needed.

import { copyFile, mkdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathExists } from '../../path-exists.ts';
import {
  readArtifactIndex,
  runArtifactPrune,
  writeArtifactIndex,
} from '../../build/artifact-retention.ts';
import { resolveArtifactsDirectory } from '../../services/platform/paths.ts';
import type { BuildArtifact, PruneOptions } from '../../types/artifacts.ts';
import {
  makeProviderInputFailure,
  type StorageProvider,
  type StorageProviderOptions,
  type StorageProviderResolver,
} from '../../types/providers.ts';

function storageRoot(directoryOverride?: string): string {
  if (directoryOverride != null) {
    return directoryOverride;
  }

  return resolveArtifactsDirectory();
}

function isSafeObjectKey(objectKey: string): boolean {
  const isBlank = objectKey.length == 0;

  if (isBlank) {
    return false;
  }

  const hasForbiddenCharacter = /[:\\\x00]/.test(objectKey);

  if (hasForbiddenCharacter) {
    return false;
  }

  function isSafeSegment(segment: string): boolean {
    const isEmptySegment = segment.length == 0;

    if (isEmptySegment) {
      return false;
    }

    const isDot = segment == '.';

    if (isDot) {
      return false;
    }

    return segment != '..';
  }

  return objectKey.split('/').every(isSafeSegment);
}

function invalidObjectKeyFailure() {
  return makeProviderInputFailure({
    provider: 'local-storage',
    message: 'Object keys must remain inside the local objects directory.',
  });
}

async function readLinkTarget(filePath: string): Promise<string | null> {
  try {
    return await readlink(filePath);
  } catch (cause) {
    const isNotALink = cause != null;

    if (isNotALink) {
      return null;
    }

    throw cause;
  }
}

function isMissingFile(cause: unknown): boolean {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('code' in cause == false) {
    return false;
  }

  return cause.code == 'ENOENT';
}

function makeLocalStorageProvider(directoryOverride?: string): StorageProvider {
  const baseDirectory = storageRoot(directoryOverride);
  const objectsDirectory = join(baseDirectory, 'objects');
  const artifactIndexPath = join(baseDirectory, 'index.json');

  function objectPath(objectKey: string): string {
    return join(objectsDirectory, objectKey);
  }

  async function checkObjectPath(objectKey: string): Promise<string> {
    const keyIsSafe = isSafeObjectKey(objectKey);

    if (keyIsSafe == false) {
      throw invalidObjectKeyFailure();
    }

    await mkdir(objectsDirectory, { recursive: true });

    const canonicalRoot = await realpath(objectsDirectory);
    const destination = objectPath(objectKey);
    let existingAncestor = destination;

    while (existingAncestor != objectsDirectory) {
      const linkTarget = await readLinkTarget(existingAncestor);

      const isSymlink = linkTarget != null;

      if (isSymlink) {
        throw invalidObjectKeyFailure();
      }

      const ancestorExists = await pathExists(existingAncestor);

      if (ancestorExists) {
        break;
      }

      existingAncestor = dirname(existingAncestor);
    }

    const canonicalAncestor = await realpath(existingAncestor);
    const relativeAncestor = relative(canonicalRoot, canonicalAncestor);

    const escapesParent = relativeAncestor == '..';

    if (escapesParent) {
      throw invalidObjectKeyFailure();
    }

    const escapesPrefix = relativeAncestor.startsWith(`..${sep}`);

    if (escapesPrefix) {
      throw invalidObjectKeyFailure();
    }

    const isOutsideRoot = isAbsolute(relativeAncestor);

    if (isOutsideRoot) {
      throw invalidObjectKeyFailure();
    }

    return destination;
  }

  async function putArtifact(artifact: BuildArtifact) {
    await mkdir(baseDirectory, { recursive: true });

    const artifactId = `${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${extname(artifact.path)}`;
    const destination = join(baseDirectory, artifactId);

    await copyFile(artifact.path, destination);

    const artifactIndex = await readArtifactIndex(artifactIndexPath);

    await writeArtifactIndex(
      [{ ...artifact, path: destination }, ...artifactIndex],
      artifactIndexPath,
    );

    return { id: artifactId, location: destination };
  }

  async function locateArtifact(artifactId: string): Promise<string> {
    const fileName = basename(artifactId);
    const artifactPath = join(baseDirectory, fileName);

    const artifactExists = await pathExists(artifactPath);

    if (artifactExists) {
      return artifactPath;
    }

    throw makeProviderInputFailure({
      provider: 'local-storage',
      message: `No stored artifact with id "${artifactId}".`,
    });
  }

  async function putObject(
    objectKey: string,
    objectContents: Buffer | string,
    _contentType: string,
  ) {
    const destination = await checkObjectPath(objectKey);
    const parentDirectory = dirname(destination);

    await mkdir(parentDirectory, { recursive: true });
    await writeFile(destination, objectContents);

    return { id: objectKey, location: pathToFileURL(destination).href };
  }

  async function getObject(objectKey: string): Promise<Buffer | null> {
    const objectFilePath = await checkObjectPath(objectKey);

    try {
      const fileBytes = await readFile(objectFilePath);

      return Buffer.from(fileBytes);
    } catch (cause) {
      const isMissing = isMissingFile(cause);

      if (isMissing) {
        return null;
      }

      throw cause;
    }
  }

  function publicUrl(objectKey: string): string {
    const isDirectoryUrl = objectKey == '';

    if (isDirectoryUrl) {
      return pathToFileURL(objectsDirectory).href;
    }

    const keyIsSafe = isSafeObjectKey(objectKey);

    if (keyIsSafe == false) {
      return 'about:blank#invalid-storage-key';
    }

    return pathToFileURL(objectPath(objectKey)).href;
  }

  function prune(pruneOptions: PruneOptions) {
    return runArtifactPrune({ ...pruneOptions, indexPath: artifactIndexPath });
  }

  return {
    name: 'local',
    put: putArtifact,
    list: function listArtifacts() {
      return readArtifactIndex(artifactIndexPath);
    },
    prune,
    url: locateArtifact,
    putObject,
    getObject,
    publicUrl,
  };
}

export function makeLocalStorageProviderResolver(): StorageProviderResolver {
  return {
    name: 'local',
    resolveStorageProvider(providerOptions: StorageProviderOptions) {
      const localStorageProvider = makeLocalStorageProvider(providerOptions.artifactDirectory);
      return Promise.resolve(localStorageProvider);
    },
  };
}
