import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from './keyFiles.js';

const temporaryDirectories: string[] = [];

/** Run a path or filesystem credential-key Effect with the Node test services. */
const runKeyFileEffect = <Success, Failure>(
  program: Effect.Effect<Success, Failure, NodeContext.NodeContext>,
) => Effect.runPromise(program.pipe(Effect.provide(NodeContext.layer)));

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe('extractKeyId', () => {
  it('reads and normalizes the Apple key filename', async () => {
    await expect(runKeyFileEffect(extractKeyId('AuthKey_keyabc1234.p8'))).resolves.toBe(
      'KEYABC1234',
    );
  });

  it('rejects unrelated and undersized filenames', async () => {
    await expect(runKeyFileEffect(extractKeyId('other.p8'))).resolves.toBeNull();
    await expect(runKeyFileEffect(extractKeyId('AuthKey_short.p8'))).resolves.toBeNull();
  });
});

describe('findAuthKeyFiles', () => {
  it('returns only matching keys in stable reverse-name order', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-key-files-'));
    temporaryDirectories.push(temporaryDirectory);
    writeFileSync(join(temporaryDirectory, 'AuthKey_AAAAAAAA.p8'), 'first');
    writeFileSync(join(temporaryDirectory, 'AuthKey_ZZZZZZZZ.p8'), 'second');
    writeFileSync(join(temporaryDirectory, 'notes.txt'), 'ignore');
    await expect(runKeyFileEffect(findAuthKeyFiles(temporaryDirectory))).resolves.toEqual([
      join(temporaryDirectory, 'AuthKey_ZZZZZZZZ.p8'),
      join(temporaryDirectory, 'AuthKey_AAAAAAAA.p8'),
    ]);
  });

  it('returns an empty list for a missing directory', async () => {
    await expect(runKeyFileEffect(findAuthKeyFiles('/missing/launch-key-files'))).resolves.toEqual(
      [],
    );
  });
});

describe('reconcileKeyId', () => {
  it('prefers a matching explicit identifier', async () => {
    await expect(Effect.runPromise(reconcileKeyId('keyabc1234', 'KEYABC1234'))).resolves.toBe(
      'KEYABC1234',
    );
  });

  it('fails when the flag and filename identify different keys', async () => {
    await expect(
      Effect.runPromise(reconcileKeyId('WRONGKEY12', 'KEYABC1234').pipe(Effect.either)),
    ).resolves.toMatchObject({
      _tag: 'Left',
      left: { _tag: 'KeyIdentityFailure' },
    });
  });
});
