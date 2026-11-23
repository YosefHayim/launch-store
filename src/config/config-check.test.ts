import { describe, expect, it } from 'vitest';
import { checkAppConfig } from './config-check.ts';
/** A minimal, footgun-free config so each test can perturb one field and assert on that finding alone. */
const clean = {
  expo: {
    name: 'Acme',
    slug: 'acme',
    version: '1.2.3',
    scheme: 'acme',
    icon: './assets/icon.png',
    ios: { bundleIdentifier: 'com.acme.app' },
    android: { package: 'com.acme.app' },
  },
};
function readKey(finding: {
  severity: 'error' | 'warn';
  file: string;
  key: string;
  message: string;
  fix: string;
}) {
  return finding.key;
}

/** Pull the keys that fired, for terse assertions about which rules tripped. */
function keys(config: Record<string, unknown>, platform: 'ios' | 'android'): string[] {
  return checkAppConfig(config, 'app.json', platform).map(readKey);
}
function describeCheckAppPiece() {
  function passesACleanPieceOnBothPlatforms() {
    const checkApp = checkAppConfig(clean, 'app.json', 'ios');
    expect(checkApp).toEqual([]);
    expect(checkAppConfig(clean, 'app.json', 'android')).toEqual([]);
  }

  it('passes a clean config on both platforms', passesACleanPieceOnBothPlatforms);

  function flagsAnInvalidIOSBundleIdAsAnErrorOnlyOnIOS() {
    const config = { expo: { ...clean.expo, ios: { bundleIdentifier: 'com.acme_app' } } };
    const ios = checkAppConfig(config, 'app.json', 'ios');

    expect(ios).toHaveLength(1);
    expect(ios[0]).toMatchObject({ severity: 'error', key: 'ios.bundleIdentifier' });

    // The bundle-id rule is iOS-only; the Android pass doesn't flag it.
    const ownKeys = keys(config, 'android');

    expect(ownKeys).not.toContain('ios.bundleIdentifier');
  }

  it(
    'flags an invalid iOS bundle id as an error, only on iOS',
    flagsAnInvalidIOSBundleIdAsAnErrorOnlyOnIOS,
  );

  function flagsAnInvalidAndroidPackageHyphenDigitLedSegmentAsAnError() {
    const ownKeys = keys(
      { expo: { ...clean.expo, android: { package: 'com.acme-app' } } },
      'android',
    );

    expect(ownKeys).toContain('android.package');
    expect(
      keys({ expo: { ...clean.expo, android: { package: 'com.1acme.app' } } }, 'android'),
    ).toContain('android.package');
    expect(keys({ expo: { ...clean.expo, android: { package: 'single' } } }, 'android')).toContain(
      'android.package',
    );
  }

  it(
    'flags an invalid Android package (hyphen / digit-led segment) as an error',
    flagsAnInvalidAndroidPackageHyphenDigitLedSegmentAsAnError,
  );

  function flagsASplashWithNoBackgroundColorAsAnErrorOnAndroidOnly() {
    const config = { expo: { ...clean.expo, splash: { image: './assets/splash.png' } } };
    const android = checkAppConfig(config, 'app.json', 'android');

    function someF(f: {
      severity: 'error' | 'warn';
      file: string;
      key: string;
      message: string;
      fix: string;
    }) {
      return f.key == 'splash' && f.severity == 'error';
    }

    expect(android.some(someF)).toBe(true);

    const ownKeys = keys(config, 'ios');

    expect(ownKeys).not.toContain('splash');
  }

  it(
    'flags a splash with no backgroundColor as an error on Android only',
    flagsASplashWithNoBackgroundColorAsAnErrorOnAndroidOnly,
  );

  function acceptsASplashThatHasABackgroundColorInclAnAndroidLevelOverride() {
    const ownKeys = keys(
      { expo: { ...clean.expo, splash: { image: 'x', backgroundColor: '#fff' } } },
      'android',
    );

    expect(ownKeys).not.toContain('splash');
    expect(
      keys(
        {
          expo: {
            ...clean.expo,
            splash: { image: 'x' },
            android: { package: 'com.acme.app', splash: { backgroundColor: '#000' } },
          },
        },
        'android',
      ),
    ).not.toContain('splash');
  }

  it(
    'accepts a splash that has a backgroundColor (incl. an android-level override)',
    acceptsASplashThatHasABackgroundColorInclAnAndroidLevelOverride,
  );

  function warnsWhenNoAppIconIsSet() {
    const { icon: _icon, ...noIcon } = clean.expo;
    const ownKeys = keys({ expo: noIcon }, 'ios');

    expect(ownKeys).toContain('icon');
    // An adaptive icon alone satisfies the check.
    expect(
      keys(
        {
          expo: {
            ...noIcon,
            android: { package: 'com.acme.app', adaptiveIcon: { foregroundImage: 'x' } },
          },
        },
        'android',
      ),
    ).not.toContain('icon');
  }

  it('warns when no app icon is set', warnsWhenNoAppIconIsSet);

  function warnsWhenNoURLSchemeIsSet() {
    const { scheme: _scheme, ...noScheme } = clean.expo;
    const ownKeys = keys({ expo: noScheme }, 'ios');
    expect(ownKeys).toContain('scheme');
  }

  it('warns when no URL scheme is set', warnsWhenNoURLSchemeIsSet);

  function warnsOnANonNumericMarketingVersion() {
    const ownKeys = keys({ expo: { ...clean.expo, version: 'v1' } }, 'ios');
    expect(ownKeys).toContain('version');
    expect(keys({ expo: { ...clean.expo, version: '1.0.0-beta' } }, 'ios')).toContain('version');
  }

  it('warns on a non-numeric marketing version', warnsOnANonNumericMarketingVersion);

  function toleratesAFlatUnwrappedPieceShape() {
    const flat = {
      slug: 'acme',
      version: '1.0.0',
      scheme: 'acme',
      icon: 'x',
      ios: { bundleIdentifier: 'com.acme.app' },
    };
    const checkApp = checkAppConfig(flat, 'app.json', 'ios');

    expect(checkApp).toEqual([]);
  }

  it('tolerates a flat (unwrapped) config shape', toleratesAFlatUnwrappedPieceShape);
}

describe('checkAppConfig', describeCheckAppPiece);
