import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { LaunchLogger, makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';

vi.mock('../services/exec.js', () => ({
  captureCommandOutput: vi.fn((_executable: string, arguments_: readonly string[]) =>
    Effect.sync(() => {
      const keystoreIndex = arguments_.indexOf('-keystore');
      const keystorePath = arguments_[keystoreIndex + 1];
      if (keystorePath !== undefined) writeFileSync(keystorePath, 'dummy keystore');
      return '';
    }),
  ),
}));

import { captureCommandOutput } from '../services/exec.js';
import { ensureUploadKeystore } from './androidKeystore.js';

describe('Android signing command secret transport', () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('passes keytool password variable names, not the generated secret, in argv', async () => {
    const home = mkdtempSync(join(tmpdir(), 'launch-keytool-test-'));
    temporaryDirectories.push(home);
    await Effect.runPromise(
      Effect.gen(function* () {
        const log = yield* LaunchLogger;
        return yield* ensureUploadKeystore({
          appName: 'Demo',
          log,
          dryRun: false,
          confirmCreate: () => Effect.succeed(true),
        });
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(LaunchEnvironmentTest),
        Effect.provide(makeLaunchPathsTest(home, home)),
        Effect.provide(makeLaunchSecretStoreTest()),
        Effect.provide(makeLaunchLoggerTest([])),
      ),
    );
    const invocation = vi.mocked(captureCommandOutput).mock.calls[0];
    expect(invocation?.[0]).toBe('keytool');
    expect(invocation?.[1]).toContain('LAUNCH_KEYSTORE_STORE_PASSWORD');
    expect(invocation?.[1]).toContain('LAUNCH_KEYSTORE_KEY_PASSWORD');
    expect(invocation?.[1]).not.toContain('dummy');
    expect(invocation?.[2]?.environmentOverrides?.['LAUNCH_KEYSTORE_STORE_PASSWORD']).toMatch(
      /^[a-f0-9]+$/,
    );
    expect(invocation?.[2]?.environmentOverrides?.['LAUNCH_KEYSTORE_KEY_PASSWORD']).toMatch(
      /^[a-f0-9]+$/,
    );
  });
});
