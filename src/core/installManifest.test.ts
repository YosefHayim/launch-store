import { describe, expect, it } from 'vitest';
import { installLandingPage, iosInstallManifestPlist, itmsServicesUrl } from './installManifest.js';

describe('iosInstallManifestPlist', () => {
  it('embeds the ipa url, bundle id, and version in the software-package shape iOS requires', () => {
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
  });

  it("escapes XML special characters in the title so it can't break the plist", () => {
    const plist = iosInstallManifestPlist({
      ipaUrl: 'u',
      bundleId: 'b',
      version: '1',
      title: 'A & B <C>',
    });
    expect(plist).toContain('A &amp; B &lt;C&gt;');
    expect(plist).not.toContain('A & B <C>');
  });
});

describe('itmsServicesUrl', () => {
  it('wraps and URL-encodes the manifest URL', () => {
    expect(itmsServicesUrl('https://cdn.example.com/manifest.plist?v=1')).toBe(
      'itms-services://?action=download-manifest&url=https%3A%2F%2Fcdn.example.com%2Fmanifest.plist%3Fv%3D1',
    );
  });
});

describe('installLandingPage', () => {
  it('wires the install button to the given install URL', () => {
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
  });

  it('links straight to the apk for Android', () => {
    const page = installLandingPage({
      title: 'Hello',
      version: '1.0.0',
      buildNumber: 7,
      platform: 'android',
      installUrl: 'https://cdn.example.com/app.apk',
    });
    expect(page).toContain('href="https://cdn.example.com/app.apk"');
    expect(page).toContain('allow installs');
  });
});
