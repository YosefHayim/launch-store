import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LaunchEnvironmentTest } from '@core/services/environment.js';
import { makeLaunchLoggerTest } from '@core/services/logger.js';
import { makeLaunchPathsTest } from '@core/services/paths.js';
import { runWithProgress } from '@core/services/progress.js';
import { makeGradleBuildEngine } from './gradle.js';

vi.mock('@core/services/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/services/progress.js')>()),
  runWithProgress: vi.fn(() => Effect.fail('stop after invocation')),
}));

describe('Gradle signing transport', () => {
  it('puts signing passwords in the environment, not arguments', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'launch-gradle-signing-'));
    try {
      mkdirSync(join(directory, 'android'));
      writeFileSync(join(directory, 'android', 'gradlew'), '');
      const context = {
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
      const credentials = {
        platform: 'android' as const,
        serviceAccountJson: '',
        keystore: {
          path: '/keys/upload.jks',
          alias: 'upload',
          storePassword: 'store-secret',
          keyPassword: 'key-secret',
        },
      };
      await Effect.runPromise(
        Effect.either(
          makeGradleBuildEngine().pipe(
            Effect.flatMap((engine) => engine.buildArtifact(context, credentials)),
            Effect.provide(LaunchEnvironmentTest),
            Effect.provide(makeLaunchLoggerTest([])),
            Effect.provide(makeLaunchPathsTest(directory, directory)),
            Effect.provide(NodeContext.layer),
          ),
        ),
      );
      const invocation = vi.mocked(runWithProgress).mock.calls[0];
      expect(invocation).toBeDefined();
      expect(invocation?.[1]).not.toContain('store-secret');
      expect(invocation?.[1]).not.toContain('key-secret');
      expect(invocation?.[2]?.env).toMatchObject({
        'ORG_GRADLE_PROJECT_android.injected.signing.store.password': 'store-secret',
        'ORG_GRADLE_PROJECT_android.injected.signing.key.password': 'key-secret',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
