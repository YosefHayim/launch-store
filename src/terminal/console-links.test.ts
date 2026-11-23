import { describe, expect, it } from 'vitest';
import type { AppDescriptor, OpenTarget } from '../types/app.ts';
import {
  buildConsoleUrl,
  parseOpenTarget,
  resolveOpenPlatform,
  selectOpenApp,
} from './console-links.ts';
import {
  buildPlayPaymentsProfileUrl,
  buildPlayUsersAndPermissionsUrl,
} from './play-console-urls.ts';

const APP_ID = '1490000000';

/** Build a minimal app descriptor for console-link selection. */
function appDescriptor(
  name: string,
  identifierFields: Pick<AppDescriptor, 'bundleId' | 'packageName'> = {},
): AppDescriptor {
  return {
    name,
    dir: `/repo/${name}`,
    configPath: `/repo/${name}/app.json`,
    ...identifierFields,
  };
}

function describeBuildConsoleUrlIOSDeepLinksWithAResolvedAppId() {
  const targetCases: readonly [OpenTarget, string][] = [
    ['asc', `https://appstoreconnect.apple.com/apps/${APP_ID}`],
    ['app-record', `https://appstoreconnect.apple.com/apps/${APP_ID}`],
    ['testflight', `https://appstoreconnect.apple.com/apps/${APP_ID}/testflight/ios`],
    ['listing', `https://appstoreconnect.apple.com/apps/${APP_ID}/appstore`],
    ['reviews', `https://appstoreconnect.apple.com/apps/${APP_ID}/ratings-and-reviews/ios`],
    ['agreements', 'https://appstoreconnect.apple.com/agreements/'],
    ['play', 'https://play.google.com/console'],
  ];

  function runTarget(
    target: 'testflight' | 'reviews' | 'play' | 'listing' | 'asc' | 'agreements' | 'app-record',
    expectedUrl: string,
  ) {
    const consoleUrl = buildConsoleUrl(target, 'ios', APP_ID);
    expect(consoleUrl).toBe(expectedUrl);
  }

  it.each(targetCases)('%s -> %s', runTarget);
}

describe(
  'buildConsoleUrl - iOS deep links with a resolved app id',
  describeBuildConsoleUrlIOSDeepLinksWithAResolvedAppId,
);

function describeBuildConsoleUrlIOSWithoutAResolvedAppId() {
  const appTargets: OpenTarget[] = ['asc', 'app-record', 'testflight', 'listing', 'reviews'];

  function runTarget2(
    target: 'testflight' | 'reviews' | 'play' | 'listing' | 'asc' | 'agreements' | 'app-record',
  ) {
    const consoleUrl = buildConsoleUrl(target, 'ios', undefined);
    expect(consoleUrl).toBe('https://appstoreconnect.apple.com/apps');
  }

  it.each(appTargets)('%s falls back to the apps list', runTarget2);

  function keepsAgreementsAtAccountLevel() {
    const consoleUrl = buildConsoleUrl('agreements', 'ios', undefined);
    expect(consoleUrl).toBe('https://appstoreconnect.apple.com/agreements/');
  }

  it('keeps agreements at account level', keepsAgreementsAtAccountLevel);
}

describe(
  'buildConsoleUrl - iOS without a resolved app id',
  describeBuildConsoleUrlIOSWithoutAResolvedAppId,
);

function describeBuildConsoleUrlAndroid() {
  const targetCases: OpenTarget[] = [
    'asc',
    'play',
    'testflight',
    'listing',
    'reviews',
    'agreements',
    'app-record',
  ];

  function runTarget3(
    target: 'testflight' | 'reviews' | 'play' | 'listing' | 'asc' | 'agreements' | 'app-record',
  ) {
    const consoleUrl = buildConsoleUrl(target, 'android', APP_ID);

    expect(consoleUrl).toBe('https://play.google.com/console');
    expect(buildConsoleUrl(target, 'android', undefined)).toBe('https://play.google.com/console');

    const playUsersAndPermissionsUrl = buildPlayUsersAndPermissionsUrl();

    expect(playUsersAndPermissionsUrl).toBe(
      'https://play.google.com/console/developers/users-and-permissions',
    );

    const playPaymentsProfileUrl = buildPlayPaymentsProfileUrl();

    expect(playPaymentsProfileUrl).toBe(
      'https://play.google.com/console/developers/paymentssettings',
    );
    expect(buildPlayUsersAndPermissionsUrl('123456789')).toBe(
      'https://play.google.com/console/u/0/developers/123456789/users-and-permissions',
    );
    expect(buildPlayPaymentsProfileUrl('123456789')).toBe(
      'https://play.google.com/console/u/0/developers/123456789/paymentssettings',
    );
  }

  it.each(targetCases)('%s -> Play Console', runTarget3);
}

describe('buildConsoleUrl - Android', describeBuildConsoleUrlAndroid);

function thrownCause(read: () => void): unknown {
  try {
    read();
  } catch (cause) {
    return cause;
  }

  return null;
}

function describeParseOpenTarget() {
  function defaultsToAscWhenNoTargetIsGiven() {
    const openTarget = parseOpenTarget(undefined);
    expect(openTarget).toBe('asc');
  }

  it('defaults to asc when no target is given', defaultsToAscWhenNoTargetIsGiven);

  function acceptsEveryDocumentedTarget() {
    for (const target of [
      'asc',
      'play',
      'testflight',
      'listing',
      'reviews',
      'agreements',
      'app-record',
    ]) {
      const openTarget = parseOpenTarget(target);
      expect(openTarget).toBe(target);
    }
  }

  it('accepts every documented target', acceptsEveryDocumentedTarget);

  function rejectsAnUnknownTargetWithTheValidList() {
    const targetAttempt = thrownCause(function readTarget() {
      parseOpenTarget('dashboard');
    });

    expect(targetAttempt).toMatchObject({
      message: expect.stringMatching(/Unknown target "dashboard"/),
    });
  }

  it('rejects an unknown target with the valid list', rejectsAnUnknownTargetWithTheValidList);
}

describe('parseOpenTarget', describeParseOpenTarget);

function describeResolveOpenPlatform() {
  function honorsAnExplicitPlatformFlag() {
    const openPlatform = resolveOpenPlatform('asc', 'android');
    expect(openPlatform).toBe('android');
    expect(resolveOpenPlatform('play', 'ios')).toBe('ios');
  }

  it('honors an explicit platform flag', honorsAnExplicitPlatformFlag);

  function infersAndroidForThePlayTarget() {
    const openPlatform = resolveOpenPlatform('play', undefined);
    expect(openPlatform).toBe('android');
  }

  it('infers android for the play target', infersAndroidForThePlayTarget);

  function defaultsToIosForEveryOtherTarget() {
    const openPlatform = resolveOpenPlatform('asc', undefined);
    expect(openPlatform).toBe('ios');
    expect(resolveOpenPlatform('testflight', undefined)).toBe('ios');
  }

  it('defaults to ios for every other target', defaultsToIosForEveryOtherTarget);

  function rejectsAnInvalidPlatform() {
    const platformAttempt = thrownCause(function readPlatform() {
      resolveOpenPlatform('asc', 'web');
    });

    expect(platformAttempt).toMatchObject({
      message: expect.stringMatching(/Unknown platform "web"/),
    });
  }

  it('rejects an invalid platform', rejectsAnInvalidPlatform);
}

describe('resolveOpenPlatform', describeResolveOpenPlatform);

function describeSelectOpenApp() {
  const discoveredApps = [
    appDescriptor('alpha', { bundleId: 'com.acme.alpha' }),
    appDescriptor('beta', { packageName: 'com.acme.beta' }),
    appDescriptor('gamma', {
      bundleId: 'com.acme.gamma',
      packageName: 'com.acme.gamma',
    }),
  ];

  async function picksTheFirstIOSAppWithABundleId() {
    const selectedApp = await selectOpenApp(discoveredApps, 'ios', undefined);
    expect(selectedApp.name).toBe('alpha');
  }

  it('picks the first iOS app with a bundle id', picksTheFirstIOSAppWithABundleId);

  async function picksTheFirstAndroidAppWithAPackageName() {
    const selectedApp = await selectOpenApp(discoveredApps, 'android', undefined);
    expect(selectedApp.name).toBe('beta');
  }

  it('picks the first Android app with a package name', picksTheFirstAndroidAppWithAPackageName);

  async function narrowsToTheNamedApp() {
    const selectedApp = await selectOpenApp(discoveredApps, 'ios', 'gamma');
    expect(selectedApp.name).toBe('gamma');
  }

  it('narrows to the named app', narrowsToTheNamedApp);

  async function rejectsANamedAppWithoutThePlatformId() {
    const openApp = selectOpenApp(discoveredApps, 'ios', 'beta');
    await expect(openApp).rejects.toMatchObject({
      message: expect.stringMatching(/No ios app found matching "beta"/),
    });
  }

  it('rejects a named app without the platform id', rejectsANamedAppWithoutThePlatformId);

  async function rejectsACatalogWithoutAQualifyingApp() {
    const openApp = selectOpenApp(
      [appDescriptor('solo', { bundleId: 'com.acme.solo' })],
      'android',
      undefined,
    );

    await expect(openApp).rejects.toMatchObject({
      message: expect.stringMatching(/android\.package/),
    });
  }

  it('rejects a catalog without a qualifying app', rejectsACatalogWithoutAQualifyingApp);
}

describe('selectOpenApp', describeSelectOpenApp);
