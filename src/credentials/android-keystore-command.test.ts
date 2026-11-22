import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { createLogger } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { captureCommandOutput } from '../services/platform/exec.ts';
import { ensureUploadKeystore } from './android-keystore-assets.ts';
vi.mock('../services/platform/exec.ts', () => ({
  captureCommandOutput: vi.fn(function writeDummyKeystore(
    _executable: string,
    arguments_: readonly string[],
  ) {
    const keystoreIndex = arguments_.indexOf('-keystore');
    const keystorePath = arguments_[keystoreIndex + 1];

    if (keystorePath != null) {
      writeFileSync(keystorePath, 'dummy keystore');
    }

    return Promise.resolve('');
  }),
}));

describe('Android signing command secret transport', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    resetLaunchDirectories();
    resetSecretStore();

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }

    vi.clearAllMocks();
  });

  it('passes keytool password variable names, not the generated secret, in argv', async () => {
    const home = mkdtempSync(join(tmpdir(), 'launch-keytool-test-'));

    temporaryDirectories.push(home);
    useLaunchDirectories({ homeDirectory: home, workingDirectory: home });
    useSecretStore(new Map());

    await ensureUploadKeystore({
      appName: 'Demo',
      packageName: 'com.example.demo',
      log: createLogger(false),
      dryRun: false,
      confirmCreate: function confirmCreate() {
        return Promise.resolve(true);
      },
    });

    const invocation = vi.mocked(captureCommandOutput).mock.calls[0];

    expect(invocation?.[0]).toBe('keytool');
    expect(invocation?.[1]).toContain('LAUNCH_KEYSTORE_STORE_PASSWORD');
    expect(invocation?.[1]).toContain('LAUNCH_KEYSTORE_KEY_PASSWORD');

    const storePassword = invocation?.[2]?.environmentOverrides?.['LAUNCH_KEYSTORE_STORE_PASSWORD'];
    const keyPassword = invocation?.[2]?.environmentOverrides?.['LAUNCH_KEYSTORE_KEY_PASSWORD'];

    expect(invocation?.[1]).not.toContain(storePassword);
    expect(invocation?.[1]).not.toContain(keyPassword);
    expect(invocation?.[2]?.environmentOverrides?.['LAUNCH_KEYSTORE_STORE_PASSWORD']).toMatch(
      /^[a-f0-9]+$/,
    );
    expect(invocation?.[2]?.environmentOverrides?.['LAUNCH_KEYSTORE_KEY_PASSWORD']).toMatch(
      /^[a-f0-9]+$/,
    );
  });
});
