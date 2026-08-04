import { describe, expect, it } from 'vitest';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import type { AppDescriptor, BuildProfile } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import type { NativeCar, OtaCar } from '../types/releaseTrain.js';
import { AppleStoreClientLive } from '../services/appleStoreClient.js';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { GoogleStoreClientLive } from '../services/googleStoreClient.js';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { LaunchSecretStoreTest } from '../services/secretStore.js';
import { buildTrainRuntime, type TrainRuntimeRequirements } from './builder.js';
/** A minimal config - `storage: "local"` so OTA is gated off; the engine never reaches a store client. */
const config = (overrides: Partial<LaunchConfig> = {}): LaunchConfig => {
  return {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...overrides,
  };
};
/** A minimal app; pass `bundleId` / `packageName` to declare a native platform. */
const app = (overrides: Partial<AppDescriptor> = {}): AppDescriptor => {
  return { name: 'Demo', dir: '/tmp/demo', configPath: '/tmp/demo/app.json', ...overrides };
};
const profile: BuildProfile = { name: 'production' };
const logger = Effect.runSync(createLogger(false).pipe(Effect.provide(makeLaunchLoggerTest([]))));
/** Construct an engine the same way the `release-train` command does, with the given app/config. */
const engineFor = (
  appOverrides: Partial<AppDescriptor>,
  configOverrides: Partial<LaunchConfig> = {},
) => {
  return buildTrainRuntime(config(configOverrides), app(appOverrides), profile, {}, false, logger)
    .engine;
};

/** Run one live-engine guard with deterministic platform services. */
const runEngineGuard = <Success, Failure>(
  engineOperation: Effect.Effect<Success, Failure, TrainRuntimeRequirements>,
): Promise<Success> =>
  Effect.runPromise(
    engineOperation.pipe(
      Effect.provide(AppleStoreClientLive),
      Effect.provide(GoogleStoreClientLive),
      Effect.provide(LaunchEnvironmentTest),
      Effect.provide(makeLaunchPathsTest('/tmp/launch-home', '/tmp/launch-workspace')),
      Effect.provide(LaunchSecretStoreTest),
      Effect.provide(NodeContext.layer),
    ),
  );
const iosCar: NativeCar = { kind: 'ios', state: 'building', updatedAt: '2026-06-25T00:00:00Z' };
const androidCar: NativeCar = {
  kind: 'android',
  state: 'building',
  updatedAt: '2026-06-25T00:00:00Z',
};
const otaCar: OtaCar = {
  kind: 'ota',
  platform: 'ios',
  channel: 'production',
  runtimeVersion: '1.0.0',
  state: 'pending',
  updatedAt: '2026-06-25T00:00:00Z',
};
describe('buildTrainRuntime - engine guards fail loudly before any store call', () => {
  it('rejects an iOS submit when the app declares no bundle id', async () => {
    await expect(
      runEngineGuard(engineFor({ packageName: 'com.demo' }).submitNative(iosCar)),
    ).rejects.toThrow('has no iOS bundle id');
  });
  it('rejects an Android submit when the app declares no package name', async () => {
    await expect(
      runEngineGuard(engineFor({ bundleId: 'com.demo' }).submitNative(androidCar)),
    ).rejects.toThrow('has no Android package');
  });
  it('rejects an OTA publish when storage is not a cloud provider', async () => {
    await expect(
      runEngineGuard(engineFor({ bundleId: 'com.demo' }, { storage: 'local' }).publishOta(otaCar)),
    ).rejects.toThrow('OTA needs a cloud storage provider');
  });
  it('keeps a native car put on read when its platform is undeclared (no client constructed)', async () => {
    expect(await runEngineGuard(engineFor({ packageName: 'com.demo' }).readNative(iosCar))).toBe(
      'building',
    );
    expect(await runEngineGuard(engineFor({ bundleId: 'com.demo' }).readNative(androidCar))).toBe(
      'building',
    );
  });
  it('is a no-op to release a non-iOS car or an iOS car with no bundle id', async () => {
    await expect(
      runEngineGuard(engineFor({ bundleId: 'com.demo' }).releaseNative(androidCar)),
    ).resolves.toBeUndefined();
    await expect(
      runEngineGuard(engineFor({ packageName: 'com.demo' }).releaseNative(iosCar)),
    ).resolves.toBeUndefined();
  });
});
