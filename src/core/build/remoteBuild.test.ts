import { describe, expect, it } from 'vitest';
import { type RemoteBuildInputs, remoteBuildEnvironment } from './remoteBuild.js';

const remoteInputs = (overrides: Partial<RemoteBuildInputs> = {}): RemoteBuildInputs => ({
  appName: 'Demo',
  bundleId: 'com.example.demo',
  signing: {
    bundleId: 'com.example.demo',
    certName: 'Apple Distribution: Example',
    certSerial: 'ABC123',
    teamId: 'TEAM123456',
    profileName: 'Demo App Store',
    p12Path: '/creds/dist.p12',
    p12Password: 'p12-password',
    profilePath: '/creds/profile.mobileprovision',
  },
  ascKey: { keyId: 'KEY123', issuerId: 'issuer-1', p8: 'p8-body' },
  buildNumber: 7,
  submit: false,
  submitTarget: 'testing',
  forceClean: false,
  prebuildAlways: false,
  ccacheEnabled: false,
  env: {},
  ...overrides,
});

describe('remoteBuildEnvironment', () => {
  it('keeps the persisted ios/ by default', () => {
    expect(remoteBuildEnvironment(remoteInputs(), 'keychain')['PREBUILD_ALWAYS']).toBe('0');
  });

  it("tells the host to regenerate ios/ with prebuild: 'always'", () => {
    const environment = remoteBuildEnvironment(remoteInputs({ prebuildAlways: true }), 'keychain');
    expect(environment['PREBUILD_ALWAYS']).toBe('1');
  });

  it('turns each build switch on independently', () => {
    const environment = remoteBuildEnvironment(
      remoteInputs({ submit: true, forceClean: true, ccacheEnabled: true }),
      'keychain',
    );
    expect(environment).toMatchObject({
      SUBMIT: '1',
      FORCE_CLEAN: '1',
      PREBUILD_ALWAYS: '0',
      USE_CCACHE: '1',
      KEYCHAIN_PASSWORD: 'keychain',
      BUILD_NUMBER: '7',
    });
  });
});
