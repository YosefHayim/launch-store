import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from './keyFiles.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  temporaryDirectories.length = 0;
});

describe('extractKeyId', () => {
  it('reads and normalizes the Apple key filename', () => {
    expect(extractKeyId('AuthKey_keyabc1234.p8')).toBe('KEYABC1234');
  });

  it('rejects unrelated and undersized filenames', () => {
    expect(extractKeyId('other.p8')).toBeNull();
    expect(extractKeyId('AuthKey_short.p8')).toBeNull();
  });
});

describe('findAuthKeyFiles', () => {
  it('returns only matching keys in stable reverse-name order', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-key-files-'));
    temporaryDirectories.push(temporaryDirectory);
    writeFileSync(join(temporaryDirectory, 'AuthKey_AAAAAAAA.p8'), 'first');
    writeFileSync(join(temporaryDirectory, 'AuthKey_ZZZZZZZZ.p8'), 'second');
    writeFileSync(join(temporaryDirectory, 'notes.txt'), 'ignore');

    await expect(findAuthKeyFiles(temporaryDirectory)).resolves.toEqual([
      join(temporaryDirectory, 'AuthKey_ZZZZZZZZ.p8'),
      join(temporaryDirectory, 'AuthKey_AAAAAAAA.p8'),
    ]);
  });

  it('returns an empty list for a missing directory', async () => {
    await expect(findAuthKeyFiles('/missing/launch-key-files')).resolves.toEqual([]);
  });
});

describe('reconcileKeyId', () => {
  it('prefers a matching explicit identifier', () => {
    expect(reconcileKeyId('keyabc1234', 'KEYABC1234')).toBe('KEYABC1234');
  });

  it('fails when the flag and filename identify different keys', () => {
    expect(() => reconcileKeyId('WRONGKEY12', 'KEYABC1234')).toThrowError(
      expect.objectContaining({ _tag: 'KeyIdentityFailure' }),
    );
  });
});
