import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AppDescriptor, OpenTarget } from '../types/app.js';
import {
  buildConsoleUrl,
  buildPlayPaymentsProfileUrl,
  buildPlayUsersAndPermissionsUrl,
  parseOpenTarget,
  resolveOpenPlatform,
  selectOpenApp,
} from './consoleLinks.js';

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

describe('parseOpenTarget', () => {
  it('defaults to asc when no target is given', () => {
    expect(Effect.runSync(parseOpenTarget(undefined))).toBe('asc');
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
      expect(Effect.runSync(parseOpenTarget(target))).toBe(target);
    }
  });
  it('rejects an unknown target with the valid list', () => {
    const targetAttempt = Effect.runSync(Effect.either(parseOpenTarget('dashboard')));
    expect(targetAttempt._tag).toBe('Left');
    if (targetAttempt._tag === 'Left') {
      expect(targetAttempt.left.message).toMatch(/Unknown target "dashboard"/);
    }
  });
});

describe('resolveOpenPlatform', () => {
  it('honors an explicit platform flag', () => {
    expect(Effect.runSync(resolveOpenPlatform('asc', 'android'))).toBe('android');
    expect(Effect.runSync(resolveOpenPlatform('play', 'ios'))).toBe('ios');
  });
  it('infers android for the play target', () => {
    expect(Effect.runSync(resolveOpenPlatform('play', undefined))).toBe('android');
  });
  it('defaults to ios for every other target', () => {
    expect(Effect.runSync(resolveOpenPlatform('asc', undefined))).toBe('ios');
    expect(Effect.runSync(resolveOpenPlatform('testflight', undefined))).toBe('ios');
  });
  it('rejects an invalid platform', () => {
    const platformAttempt = Effect.runSync(Effect.either(resolveOpenPlatform('asc', 'web')));
    expect(platformAttempt._tag).toBe('Left');
    if (platformAttempt._tag === 'Left') {
      expect(platformAttempt.left.message).toMatch(/Unknown platform "web"/);
    }
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
  it('picks the first iOS app with a bundle id', () => {
    expect(Effect.runSync(selectOpenApp(discoveredApps, 'ios', undefined)).name).toBe('alpha');
  });
  it('picks the first Android app with a package name', () => {
    expect(Effect.runSync(selectOpenApp(discoveredApps, 'android', undefined)).name).toBe('beta');
  });
  it('narrows to the named app', () => {
    expect(Effect.runSync(selectOpenApp(discoveredApps, 'ios', 'gamma')).name).toBe('gamma');
  });
  it('rejects a named app without the platform id', () => {
    const selectionAttempt = Effect.runSync(
      Effect.either(selectOpenApp(discoveredApps, 'ios', 'beta')),
    );
    expect(selectionAttempt._tag).toBe('Left');
    if (selectionAttempt._tag === 'Left') {
      expect(selectionAttempt.left.message).toMatch(/No ios app found matching "beta"/);
    }
  });
  it('rejects a catalog without a qualifying app', () => {
    const selectionAttempt = Effect.runSync(
      Effect.either(
        selectOpenApp([appDescriptor('solo', { bundleId: 'com.acme.solo' })], 'android', undefined),
      ),
    );
    expect(selectionAttempt._tag).toBe('Left');
    if (selectionAttempt._tag === 'Left') {
      expect(selectionAttempt.left.message).toMatch(/android\.package/);
    }
  });
});
