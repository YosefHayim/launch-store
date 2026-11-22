import { describe, expect, it } from 'vitest';
import type { AppDescriptor, OpenTarget } from '../types/app.ts';
import {
  buildConsoleUrl,
  parseOpenTarget,
  resolveOpenPlatform,
  selectOpenApp,
} from './consoleLinks.ts';
import { buildPlayPaymentsProfileUrl, buildPlayUsersAndPermissionsUrl } from './playConsoleUrls.ts';

const APP_ID = '1490000000';

/** Build a minimal app descriptor for console-link selection. */
const appDescriptor = (
  name: string,
  identifierFields: Pick<AppDescriptor, 'bundleId' | 'packageName'> = {},
): AppDescriptor => ({
  name,
  dir: `/repo/${name}`,
  configPath: `/repo/${name}/app.json`,
  ...identifierFields,
});

describe('buildConsoleUrl - iOS deep links with a resolved app id', () => {
  const targetCases: readonly [OpenTarget, string][] = [
    ['asc', `https://appstoreconnect.apple.com/apps/${APP_ID}`],
    ['app-record', `https://appstoreconnect.apple.com/apps/${APP_ID}`],
    ['testflight', `https://appstoreconnect.apple.com/apps/${APP_ID}/testflight/ios`],
    ['listing', `https://appstoreconnect.apple.com/apps/${APP_ID}/appstore`],
    ['reviews', `https://appstoreconnect.apple.com/apps/${APP_ID}/ratings-and-reviews/ios`],
    ['agreements', 'https://appstoreconnect.apple.com/agreements/'],
    ['play', 'https://play.google.com/console'],
  ];
  it.each(targetCases)('%s -> %s', (target, expectedUrl) => {
    expect(buildConsoleUrl(target, 'ios', APP_ID)).toBe(expectedUrl);
  });
});

describe('buildConsoleUrl - iOS without a resolved app id', () => {
  const appTargets: OpenTarget[] = ['asc', 'app-record', 'testflight', 'listing', 'reviews'];
  it.each(appTargets)('%s falls back to the apps list', (target) => {
    expect(buildConsoleUrl(target, 'ios', undefined)).toBe(
      'https://appstoreconnect.apple.com/apps',
    );
  });
  it('keeps agreements at account level', () => {
    expect(buildConsoleUrl('agreements', 'ios', undefined)).toBe(
      'https://appstoreconnect.apple.com/agreements/',
    );
  });
});

describe('buildConsoleUrl - Android', () => {
  const targetCases: OpenTarget[] = [
    'asc',
    'play',
    'testflight',
    'listing',
    'reviews',
    'agreements',
    'app-record',
  ];
  it.each(targetCases)('%s -> Play Console', (target) => {
    expect(buildConsoleUrl(target, 'android', APP_ID)).toBe('https://play.google.com/console');
    expect(buildConsoleUrl(target, 'android', undefined)).toBe('https://play.google.com/console');
    expect(buildPlayUsersAndPermissionsUrl()).toBe(
      'https://play.google.com/console/developers/users-and-permissions',
    );
    expect(buildPlayPaymentsProfileUrl()).toBe(
      'https://play.google.com/console/developers/paymentssettings',
    );
    expect(buildPlayUsersAndPermissionsUrl('123456789')).toBe(
      'https://play.google.com/console/u/0/developers/123456789/users-and-permissions',
    );
    expect(buildPlayPaymentsProfileUrl('123456789')).toBe(
      'https://play.google.com/console/u/0/developers/123456789/paymentssettings',
    );
  });
});

function thrownCause(read: () => void): unknown {
  try {
    read();
  } catch (cause) {
    return cause;
  }

  return null;
}

describe('parseOpenTarget', () => {
  it('defaults to asc when no target is given', () => {
    expect(parseOpenTarget(undefined)).toBe('asc');
  });
  it('accepts every documented target', () => {
    for (const target of [
      'asc',
      'play',
      'testflight',
      'listing',
      'reviews',
      'agreements',
      'app-record',
    ]) {
      expect(parseOpenTarget(target)).toBe(target);
    }
  });
  it('rejects an unknown target with the valid list', () => {
    const targetAttempt = thrownCause(function readTarget() {
      parseOpenTarget('dashboard');
    });
    expect(targetAttempt).toMatchObject({
      message: expect.stringMatching(/Unknown target "dashboard"/),
    });
  });
});

describe('resolveOpenPlatform', () => {
  it('honors an explicit platform flag', () => {
    expect(resolveOpenPlatform('asc', 'android')).toBe('android');
    expect(resolveOpenPlatform('play', 'ios')).toBe('ios');
  });
  it('infers android for the play target', () => {
    expect(resolveOpenPlatform('play', undefined)).toBe('android');
  });
  it('defaults to ios for every other target', () => {
    expect(resolveOpenPlatform('asc', undefined)).toBe('ios');
    expect(resolveOpenPlatform('testflight', undefined)).toBe('ios');
  });
  it('rejects an invalid platform', () => {
    const platformAttempt = thrownCause(function readPlatform() {
      resolveOpenPlatform('asc', 'web');
    });
    expect(platformAttempt).toMatchObject({
      message: expect.stringMatching(/Unknown platform "web"/),
    });
  });
});

describe('selectOpenApp', () => {
  const discoveredApps = [
    appDescriptor('alpha', { bundleId: 'com.acme.alpha' }),
    appDescriptor('beta', { packageName: 'com.acme.beta' }),
    appDescriptor('gamma', {
      bundleId: 'com.acme.gamma',
      packageName: 'com.acme.gamma',
    }),
  ];
  it('picks the first iOS app with a bundle id', async () => {
    const selectedApp = await selectOpenApp(discoveredApps, 'ios', undefined);
    expect(selectedApp.name).toBe('alpha');
  });
  it('picks the first Android app with a package name', async () => {
    const selectedApp = await selectOpenApp(discoveredApps, 'android', undefined);
    expect(selectedApp.name).toBe('beta');
  });
  it('narrows to the named app', async () => {
    const selectedApp = await selectOpenApp(discoveredApps, 'ios', 'gamma');
    expect(selectedApp.name).toBe('gamma');
  });
  it('rejects a named app without the platform id', async () => {
    await expect(selectOpenApp(discoveredApps, 'ios', 'beta')).rejects.toMatchObject({
      message: expect.stringMatching(/No ios app found matching "beta"/),
    });
  });
  it('rejects a catalog without a qualifying app', async () => {
    await expect(
      selectOpenApp([appDescriptor('solo', { bundleId: 'com.acme.solo' })], 'android', undefined),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/android\.package/),
    });
  });
});
