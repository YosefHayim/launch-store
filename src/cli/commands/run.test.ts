import { describe, expect, it } from 'vitest';
import {
  adbInstallArgs,
  bundletoolBuildApksArgs,
  bundletoolInstallApksArgs,
  devicectlInstallArgs,
} from './run.js';

describe('adbInstallArgs', () => {
  it('reinstalls without a serial when none is given', () => {
    expect(adbInstallArgs('/b/app.apk')).toEqual(['install', '-r', '/b/app.apk']);
  });

  it('scopes to a device serial with -s', () => {
    expect(adbInstallArgs('/b/app.apk', 'emulator-5554')).toEqual([
      '-s',
      'emulator-5554',
      'install',
      '-r',
      '/b/app.apk',
    ]);
  });
});

describe('bundletool args', () => {
  it('builds a universal APK set, overwriting prior output', () => {
    expect(bundletoolBuildApksArgs('/b/app.aab', '/tmp/app.apks')).toEqual([
      'build-apks',
      '--bundle=/b/app.aab',
      '--output=/tmp/app.apks',
      '--mode=universal',
      '--overwrite',
    ]);
  });

  it('installs the APK set, optionally scoped to a device', () => {
    expect(bundletoolInstallApksArgs('/tmp/app.apks')).toEqual([
      'install-apks',
      '--apks=/tmp/app.apks',
    ]);
    expect(bundletoolInstallApksArgs('/tmp/app.apks', 'emulator-5554')).toEqual([
      'install-apks',
      '--apks=/tmp/app.apks',
      '--device-id=emulator-5554',
    ]);
  });
});

describe('devicectlInstallArgs', () => {
  it('installs a .app, targeting a device id when provided', () => {
    expect(devicectlInstallArgs('/tmp/Payload/Demo.app')).toEqual([
      'devicectl',
      'device',
      'install',
      'app',
      '/tmp/Payload/Demo.app',
    ]);
    expect(devicectlInstallArgs('/tmp/Payload/Demo.app', '00008110-XXX')).toEqual([
      'devicectl',
      'device',
      'install',
      'app',
      '--device',
      '00008110-XXX',
      '/tmp/Payload/Demo.app',
    ]);
  });
});
