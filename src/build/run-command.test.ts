import { describe, expect, it } from 'vitest';
import {
  adbInstallArgs,
  bundletoolBuildApksArgs,
  bundletoolInstallApksArgs,
  devicectlInstallArgs,
} from './run-command.ts';

function describeAdbInstallPiece() {
  function reinstallsWithoutASerialWhenNoneIsGiven() {
    const adbInstall = adbInstallArgs('/b/app.apk');
    expect(adbInstall).toEqual(['install', '-r', '/b/app.apk']);
  }

  it('reinstalls without a serial when none is given', reinstallsWithoutASerialWhenNoneIsGiven);

  function scopesInstallationToOneDeviceSerial() {
    const adbInstall = adbInstallArgs('/b/app.apk', 'emulator-5554');
    expect(adbInstall).toEqual(['-s', 'emulator-5554', 'install', '-r', '/b/app.apk']);
  }

  it('scopes installation to one device serial', scopesInstallationToOneDeviceSerial);
}

describe('adbInstallArgs', describeAdbInstallPiece);

function describeBundletoolArguments() {
  function createsAUniversalAPKSet() {
    const bundletoolBuildApks = bundletoolBuildApksArgs('/b/app.aab', '/tmp/app.apks');

    expect(bundletoolBuildApks).toEqual([
      'build-apks',
      '--bundle=/b/app.aab',
      '--output=/tmp/app.apks',
      '--mode=universal',
      '--overwrite',
    ]);
  }

  it('creates a universal APK set', createsAUniversalAPKSet);

  function installsAnAPKSetWithAnOptionalDeviceSerial() {
    const bundletoolInstallApks = bundletoolInstallApksArgs('/tmp/app.apks');

    expect(bundletoolInstallApks).toEqual(['install-apks', '--apks=/tmp/app.apks']);
    expect(bundletoolInstallApksArgs('/tmp/app.apks', 'emulator-5554')).toEqual([
      'install-apks',
      '--apks=/tmp/app.apks',
      '--device-id=emulator-5554',
    ]);
  }

  it(
    'installs an APK set with an optional device serial',
    installsAnAPKSetWithAnOptionalDeviceSerial,
  );
}

describe('bundletool arguments', describeBundletoolArguments);

function describeDevicectlInstallPiece() {
  function installsAnApplicationBundleWithAnOptionalDeviceIdentifier() {
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
  }

  it(
    'installs an application bundle with an optional device identifier',
    installsAnApplicationBundleWithAnOptionalDeviceIdentifier,
  );
}

describe('devicectlInstallArgs', describeDevicectlInstallPiece);
