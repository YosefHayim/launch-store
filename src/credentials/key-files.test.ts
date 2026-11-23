import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from './key-files.ts';

const temporaryDirectories: string[] = [];

function cleanup() {
  for (const temporaryDirectory of temporaryDirectories) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  temporaryDirectories.length = 0;
}

afterEach(cleanup);

function describeExtractKeyId() {
  function readsAndNormalizesTheAppleKeyFilename() {
    const keyId = extractKeyId('AuthKey_keyabc1234.p8');
    expect(keyId).toBe('KEYABC1234');
  }

  it('reads and normalizes the Apple key filename', readsAndNormalizesTheAppleKeyFilename);

  function rejectsUnrelatedAndUndersizedFilenames() {
    const keyId = extractKeyId('other.p8');
    expect(keyId).toBeNull();
    expect(extractKeyId('AuthKey_short.p8')).toBeNull();
  }

  it('rejects unrelated and undersized filenames', rejectsUnrelatedAndUndersizedFilenames);
}

describe('extractKeyId', describeExtractKeyId);

function describeFindAuthKeyFiles() {
  async function returnsOnlyMatchingKeysInStableReverseNameOrder() {
    const systemTemporaryDirectory = tmpdir();
    const launchKeyFilesPath = join(systemTemporaryDirectory, 'launch-key-files-');
    const temporaryDirectory = mkdtempSync(launchKeyFilesPath);

    temporaryDirectories.push(temporaryDirectory);

    const authkeyAaaaaaaaPath = join(temporaryDirectory, 'AuthKey_AAAAAAAA.p8');

    writeFileSync(authkeyAaaaaaaaPath, 'first');

    const authkeyZzzzzzzzPath = join(temporaryDirectory, 'AuthKey_ZZZZZZZZ.p8');

    writeFileSync(authkeyZzzzzzzzPath, 'second');

    const notesPath = join(temporaryDirectory, 'notes.txt');

    writeFileSync(notesPath, 'ignore');

    const authKeyFiles = findAuthKeyFiles(temporaryDirectory);
    const joinedPath = join(temporaryDirectory, 'AuthKey_ZZZZZZZZ.p8');

    await expect(authKeyFiles).resolves.toEqual([
      joinedPath,
      join(temporaryDirectory, 'AuthKey_AAAAAAAA.p8'),
    ]);
  }

  it(
    'returns only matching keys in stable reverse-name order',
    returnsOnlyMatchingKeysInStableReverseNameOrder,
  );

  async function returnsAnEmptyListForAMissingDirectory() {
    const authKeyFiles = findAuthKeyFiles('/missing/launch-key-files');
    await expect(authKeyFiles).resolves.toEqual([]);
  }

  it('returns an empty list for a missing directory', returnsAnEmptyListForAMissingDirectory);
}

describe('findAuthKeyFiles', describeFindAuthKeyFiles);

function describeReconcileKeyId() {
  function prefersAMatchingExplicitIdentifier() {
    expect(reconcileKeyId('keyabc1234', 'KEYABC1234')).toBe('KEYABC1234');
  }

  it('prefers a matching explicit identifier', prefersAMatchingExplicitIdentifier);

  function failsWhenTheFlagAndFilenameIdentifyDifferentKeys() {
    function callReconcileKeyId() {
      return reconcileKeyId('WRONGKEY12', 'KEYABC1234');
    }

    expect(callReconcileKeyId).toThrowError(
      expect.objectContaining({ _tag: 'KeyIdentityFailure' }),
    );
  }

  it(
    'fails when the flag and filename identify different keys',
    failsWhenTheFlagAndFilenameIdentifyDifferentKeys,
  );
}

describe('reconcileKeyId', describeReconcileKeyId);
