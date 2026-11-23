import { describe, expect, it } from 'vitest';
import {
  installLandingPage,
  iosInstallManifestPlist,
  itmsServicesUrl,
} from './install-manifest.ts';

function describeIosInstallManifestPlist() {
  function embedsTheIpaUrlBundleIdAndVersionInTheSoftwarePackageShapeIOSRequires() {
    const plist = iosInstallManifestPlist({
      ipaUrl: 'https://cdn.example.com/app.ipa',
      bundleId: 'com.example.hello',
      version: '1.2.0',
      title: 'Hello',
    });

    expect(plist).toContain('<key>kind</key><string>software-package</string>');
    expect(plist).toContain('<key>url</key><string>https://cdn.example.com/app.ipa</string>');
    expect(plist).toContain('<key>bundle-identifier</key><string>com.example.hello</string>');
    expect(plist).toContain('<key>bundle-version</key><string>1.2.0</string>');
  }

  it(
    'embeds the ipa url, bundle id, and version in the software-package shape iOS requires',
    embedsTheIpaUrlBundleIdAndVersionInTheSoftwarePackageShapeIOSRequires,
  );

  function escapesXMLSpecialCharactersInTheTitleSoItCanTBreakThePlist() {
    const plist = iosInstallManifestPlist({
      ipaUrl: 'u',
      bundleId: 'b',
      version: '1',
      title: 'A & B <C>',
    });

    expect(plist).toContain('A &amp; B &lt;C&gt;');
    expect(plist).not.toContain('A & B <C>');
  }

  it(
    "escapes XML special characters in the title so it can't break the plist",
    escapesXMLSpecialCharactersInTheTitleSoItCanTBreakThePlist,
  );
}

describe('iosInstallManifestPlist', describeIosInstallManifestPlist);

function describeItmsServicesUrl() {
  function wrapsAndURLEncodesTheManifestURL() {
    expect(itmsServicesUrl('https://cdn.example.com/manifest.plist?v=1')).toBe(
      'itms-services://?action=download-manifest&url=https%3A%2F%2Fcdn.example.com%2Fmanifest.plist%3Fv%3D1',
    );
  }

  it('wraps and URL-encodes the manifest URL', wrapsAndURLEncodesTheManifestURL);
}

describe('itmsServicesUrl', describeItmsServicesUrl);

function describeInstallLandingPage() {
  function wiresTheInstallButtonToTheGivenInstallURL() {
    const page = installLandingPage({
      title: 'Hello',
      version: '1.0.0',
      buildNumber: 7,
      platform: 'ios',
      installUrl: 'itms-services://?action=download-manifest&url=x',
    });

    expect(page).toContain('href="itms-services://?action=download-manifest&amp;url=x"');
    expect(page).toContain('Version 1.0.0 (build 7)');
    expect(page).toContain('Device Management');
  }

  it(
    'wires the install button to the given install URL',
    wiresTheInstallButtonToTheGivenInstallURL,
  );

  function linksStraightToTheApkForAndroid() {
    const page = installLandingPage({
      title: 'Hello',
      version: '1.0.0',
      buildNumber: 7,
      platform: 'android',
      installUrl: 'https://cdn.example.com/app.apk',
    });

    expect(page).toContain('href="https://cdn.example.com/app.apk"');
    expect(page).toContain('allow installs');
  }

  it('links straight to the apk for Android', linksStraightToTheApkForAndroid);
}

describe('installLandingPage', describeInstallLandingPage);
