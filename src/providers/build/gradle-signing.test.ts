import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runWithProgress } from '../../services/platform/progress.ts';
import { makeGradleBuildEngine } from './gradle.ts';

vi.mock(
  '../../services/platform/progress.ts',
  async function mockProgress(importOriginal: <T = unknown>() => Promise<T>) {
    return {
      ...(await importOriginal<typeof import('../../services/platform/progress.ts')>()),
      runWithProgress: vi.fn(() => Promise.reject(new Error('stop after invocation'))),
    };
  },
);
function describeGradleSigningTransport() {
  async function putsSigningPasswordsInTheEnvironmentNotArguments() {
    const systemTemporaryDirectory = tmpdir();
    const launchGradleSigningPath = join(systemTemporaryDirectory, 'launch-gradle-signing-');
    const directory = mkdtempSync(launchGradleSigningPath);

    try {
      const androidPath = join(directory, 'android');
      mkdirSync(androidPath);
      const gradlewPath = join(directory, 'android', 'gradlew');
      writeFileSync(gradlewPath, '');
      const buildContext = {
        platform: 'android' as const,
        app: {
          name: 'demo',
          dir: directory,
          configPath: join(directory, 'app.json'),
          packageName: 'com.example.demo',
        },
        profile: { name: 'production' },
        env: {},
        explain: false,
        dryRun: false,
        forceClean: false,
      };
      const buildCredentials = {
        platform: 'android' as const,
        serviceAccountJson: '',
        keystore: {
          path: '/keys/upload.jks',
          alias: 'upload',
          storePassword: 'store-secret',
          keyPassword: 'key-secret',
        },
      };
      const buildEngine = makeGradleBuildEngine();
      let stopped: unknown = null;

      try {
        await buildEngine.buildArtifact(buildContext, buildCredentials);
      } catch (error) {
        stopped = error;
      }

      expect(stopped).not.toBeNull();
      const invocation = vi.mocked(runWithProgress).mock.calls[0];
      expect(invocation).toBeDefined();
      expect(invocation?.[1].join(' ')).not.toContain('store-secret');
      expect(invocation?.[1].join(' ')).not.toContain('key-secret');
      expect(invocation?.[2]?.env).toMatchObject({
        'ORG_GRADLE_PROJECT_android.injected.signing.store.password': 'store-secret',
        'ORG_GRADLE_PROJECT_android.injected.signing.key.password': 'key-secret',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it(
    'puts signing passwords in the environment, not arguments',
    putsSigningPasswordsInTheEnvironmentNotArguments,
  );
}

describe('Gradle signing transport', describeGradleSigningTransport);
