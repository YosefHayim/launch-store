import { describe, expect, it } from 'vitest';
import { createLogger } from '../services/platform/logger.ts';
import type { AppDescriptor, BuildProfile } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { NativeCar, OtaCar } from '../types/release-train.ts';
import {
  createTrainRuntime,
  isStoredAndroidBuild,
  isUsableIosStoreBuild,
  marketingVersionMissingMessage,
  usableMarketingVersion,
} from './builder.ts';

function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
    ...overrides,
  };
}

function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'Demo',
    dir: '/tmp/demo',
    configPath: '/tmp/demo/app.json',
    ...overrides,
  };
}

const profile: BuildProfile = { name: 'production' };
const logger = createLogger(false);

function engineFor(
  appOverrides: Partial<AppDescriptor>,
  configOverrides: Partial<LaunchConfig> = {},
) {
  return createTrainRuntime(config(configOverrides), app(appOverrides), profile, {}, false, logger)
    .engine;
}

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

describe('createTrainRuntime pure helpers', () => {
  it('accepts only processed, non-expired App Store builds', () => {
    expect(isUsableIosStoreBuild({ processingState: 'VALID', expired: false })).toBe(true);
    expect(isUsableIosStoreBuild({ processingState: 'VALID', expired: true })).toBe(false);
    expect(isUsableIosStoreBuild({ processingState: 'PROCESSING', expired: false })).toBe(false);
  });

  it('matches stored Android builds by app name and platform', () => {
    expect(isStoredAndroidBuild({ appName: 'Demo', platform: 'android' }, 'Demo')).toBe(true);
    expect(isStoredAndroidBuild({ appName: 'Demo', platform: 'ios' }, 'Demo')).toBe(false);
    expect(isStoredAndroidBuild({ appName: 'Other', platform: 'android' }, 'Demo')).toBe(false);
  });

  it('names the marketing-version fix in the failure message', () => {
    expect(marketingVersionMissingMessage('Demo')).toContain('Demo');
    expect(marketingVersionMissingMessage('Demo')).toContain('version');
  });

  it('keeps only non-empty marketing versions', () => {
    expect(usableMarketingVersion(undefined)).toBeNull();
    expect(usableMarketingVersion('')).toBeNull();
    expect(usableMarketingVersion('1.2.3')).toBe('1.2.3');
  });
});

describe('createTrainRuntime - engine guards fail loudly before any store call', () => {
  it('rejects an iOS submit when the app declares no bundle id', async () => {
    await expect(engineFor({ packageName: 'com.demo' }).submitNative(iosCar)).rejects.toMatchObject(
      {
        _tag: 'TrainRuntimeFailure',
        message: expect.stringContaining('has no iOS bundle id'),
      },
    );
  });

  it('rejects an Android submit when the app declares no package name', async () => {
    await expect(
      engineFor({ bundleId: 'com.demo' }).submitNative(androidCar),
    ).rejects.toMatchObject({
      _tag: 'TrainRuntimeFailure',
      message: expect.stringContaining('has no Android package'),
    });
  });

  it('rejects an OTA publish when storage is not a cloud provider', async () => {
    await expect(
      engineFor({ bundleId: 'com.demo' }, { storage: 'local' }).publishOta(otaCar),
    ).rejects.toMatchObject({
      _tag: 'TrainRuntimeFailure',
      message: expect.stringContaining('OTA needs a cloud storage provider'),
    });
  });

  it('keeps a native car put on read when its platform is undeclared (no client constructed)', async () => {
    expect(await engineFor({ packageName: 'com.demo' }).readNative(iosCar)).toBe('building');
    expect(await engineFor({ bundleId: 'com.demo' }).readNative(androidCar)).toBe('building');
  });

  it('is a no-op to release a non-iOS car or an iOS car with no bundle id', async () => {
    await expect(
      engineFor({ bundleId: 'com.demo' }).releaseNative(androidCar),
    ).resolves.toBeUndefined();
    await expect(
      engineFor({ packageName: 'com.demo' }).releaseNative(iosCar),
    ).resolves.toBeUndefined();
  });
});
