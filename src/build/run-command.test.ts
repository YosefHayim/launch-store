import { describe, expect, it } from 'vitest';
import {
  adbInstallArgs,
  bundletoolBuildApksArgs,
  bundletoolInstallApksArgs,
  devicectlInstallArgs,
} from './run-command.ts';

describe('adbInstallArgs', () => {
  it('reinstalls without a serial when none is given', () => {
    const adbInstall = adbInstallArgs('/b/app.apk');
    expect(adbInstall).toEqual(['install', '-r', '/b/app.apk']);
  });

  it('scopes installation to one device serial', () => {
    const adbInstall = adbInstallArgs('/b/app.apk', 'emulator-5554');
    expect(adbInstall).toEqual(['-s', 'emulator-5554', 'install', '-r', '/b/app.apk']);
  });
});

describe('bundletool arguments', () => {
  it('creates a universal APK set', () => {
    const bundletoolBuildApks = bundletoolBuildApksArgs('/b/app.aab', '/tmp/app.apks');
    expect(bundletoolBuildApks).toEqual([
      'build-apks',
      '--bundle=/b/app.aab',
      '--output=/tmp/app.apks',
      '--mode=universal',
      '--overwrite',
    ]);
  });

  it('installs an APK set with an optional device serial', () => {
    const bundletoolInstallApks = bundletoolInstallApksArgs('/tmp/app.apks');
    expect(bundletoolInstallApks).toEqual(['install-apks', '--apks=/tmp/app.apks']);
    expect(bundletoolInstallApksArgs('/tmp/app.apks', 'emulator-5554')).toEqual([
      'install-apks',
      '--apks=/tmp/app.apks',
      '--device-id=emulator-5554',
    ]);
  });
});

describe('devicectlInstallArgs', () => {
  it('installs an application bundle with an optional device identifier', () => {
    const devicectlInstall = devicectlInstallArgs('/tmp/Payload/Demo.app');
    expect(devicectlInstall).toEqual([
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
