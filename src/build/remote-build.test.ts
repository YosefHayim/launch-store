import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { scpUp, sshRun } from '../services/platform/ssh.ts';
import { type RemoteBuildInputs, remoteBuildEnvironment, runBuildOnHost } from './remote-build.ts';

function remoteInputs(overrides: Partial<RemoteBuildInputs> = {}): RemoteBuildInputs {
  return {
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
    buildNumber: 7,
    forceClean: false,
    prebuildAlways: false,
    ccacheEnabled: false,
    env: {},
    ...overrides,
  };
}
function describeRemoteBuildEnvironment() {
  function keepsThePersistedIosByDefault() {
    expect(remoteBuildEnvironment(remoteInputs(), 'keychain')['PREBUILD_ALWAYS']).toBe('0');
  }

  it('keeps the persisted ios/ by default', keepsThePersistedIosByDefault);

  function tellsTheHostToRegenerateIosWithPrebuildAlways() {
    const environment = remoteBuildEnvironment(remoteInputs({ prebuildAlways: true }), 'keychain');
    expect(environment['PREBUILD_ALWAYS']).toBe('1');
  }

  it(
    "tells the host to regenerate ios/ with prebuild: 'always'",
    tellsTheHostToRegenerateIosWithPrebuildAlways,
  );

  function turnsEachBuildSwitchOnIndependently() {
    const environment = remoteBuildEnvironment(
      remoteInputs({ forceClean: true, ccacheEnabled: true }),
      'keychain',
    );

    expect(environment).toMatchObject({
      FORCE_CLEAN: '1',
      PREBUILD_ALWAYS: '0',
      USE_CCACHE: '1',
      KEYCHAIN_PASSWORD: 'keychain',
      BUILD_NUMBER: '7',
    });
  }

  it('turns each build switch on independently', turnsEachBuildSwitchOnIndependently);

  function keepsTheAppStoreConnectKeyOffTheHost() {
    const environment = remoteBuildEnvironment(remoteInputs(), 'keychain');

    function startsWithAscPrefix(name: string) {
      return name.startsWith('ASC_');
    }

    expect(Object.keys(environment).filter(startsWithAscPrefix)).toEqual([]);
  }

  it('keeps the App Store Connect key off the host', keepsTheAppStoreConnectKeyOffTheHost);
}

describe('remoteBuildEnvironment', describeRemoteBuildEnvironment);

vi.mock('../services/platform/ssh.ts', function mockSsh() {
  return {
    scpUp: vi.fn(async () => undefined),
    sshRun: vi.fn(async () => undefined),
    sshCapture: vi.fn(async () => '0'),
    scpDown: vi.fn(async () => undefined),
    rsyncUp: vi.fn(async () => undefined),
  };
});
function prepare() {
  vi.clearAllMocks();
}

beforeEach(prepare);
function describeRemoteCredentialTransport() {
  async function usesAProtectedEnvironmentFileRatherThanSecretBearingSSHArguments() {
    const environmentDocuments: string[] = [];

    vi.mocked(scpUp).mockImplementation(
      async function captureEnvironment(_target, localPath, remotePath) {
        const isEnvironmentFile = remotePath.endsWith('/environment.sh');

        if (isEnvironmentFile == false) {
          return;
        }

        const loadedFile = readFileSync(localPath, 'utf8');

        environmentDocuments.push(loadedFile);
        expect(statSync(localPath).mode & 0o077).toBe(0);
      },
    );
    await runBuildOnHost(
      {
        target: { user: 'builder', host: 'example.invalid', port: 22 },
        workDirectory: '/tmp/work',
        credentialsDirectory: '/tmp/creds',
        keychainPassword: 'dummy-keychain-password',
      },
      remoteInputs({ env: { BACKEND_TOKEN: "dummy'quoted-token" } }),
    );

    const environmentDocument = environmentDocuments.join('');

    expect(environmentDocument).toContain('export KEYCHAIN_PASSWORD=');
    expect(environmentDocument).toContain('dummy-keychain-password');
    expect(environmentDocument).toContain('export BACKEND_TOKEN=');

    for (const invocation of vi.mocked(sshRun).mock.calls) {
      expect(invocation[1]).not.toContain('dummy-keychain-password');
      expect(invocation[1]).not.toContain('p12-password');
      expect(invocation[1]).not.toContain('quoted-token');
    }
  }

  it(
    'uses a protected environment file rather than secret-bearing SSH arguments',
    usesAProtectedEnvironmentFileRatherThanSecretBearingSSHArguments,
  );
}

describe('remote credential transport', describeRemoteCredentialTransport);
