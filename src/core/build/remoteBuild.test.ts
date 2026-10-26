import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { NodeContext } from '@effect/platform-node';
import { readFileSync, statSync } from 'node:fs';
import { scpUp, sshRun } from '../services/ssh.js';
import { type RemoteBuildInputs, remoteBuildEnvironment, runBuildOnHost } from './remoteBuild.js';

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
  buildNumber: 7,
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
  });

  it('keeps the App Store Connect key off the host', () => {
    const environment = remoteBuildEnvironment(remoteInputs(), 'keychain');
    expect(Object.keys(environment).filter((name) => name.startsWith('ASC_'))).toEqual([]);
  });
});

vi.mock('../services/ssh.js', () => ({
  scpUp: vi.fn(() => Effect.void),
  sshRun: vi.fn(() => Effect.void),
  sshCapture: vi.fn(() => Effect.succeed('0')),
  scpDown: vi.fn(() => Effect.void),
  rsyncUp: vi.fn(() => Effect.void),
}));
beforeEach(() => {
  vi.clearAllMocks();
});

describe('remote credential transport', () => {
  it('uses a protected environment file rather than secret-bearing SSH arguments', async () => {
    let environmentDocument = '';
    vi.mocked(scpUp).mockImplementation((_target, localPath, remotePath) =>
      Effect.sync(() => {
        if (remotePath.endsWith('/environment.sh')) {
          environmentDocument = readFileSync(localPath, 'utf8');
          expect(statSync(localPath).mode & 0o077).toBe(0);
        }
      }),
    );
    await Effect.runPromise(
      runBuildOnHost(
        {
          target: { user: 'builder', host: 'example.invalid', port: 22 },
          workDirectory: '/tmp/work',
          credentialsDirectory: '/tmp/creds',
          keychainPassword: 'dummy-keychain-password',
        },
        remoteInputs({ env: { BACKEND_TOKEN: "dummy'quoted-token" } }),
      ).pipe(Effect.provide(NodeContext.layer)),
    );
    expect(environmentDocument).toContain('export KEYCHAIN_PASSWORD=');
    expect(environmentDocument).toContain('dummy-keychain-password');
    expect(environmentDocument).toContain('export BACKEND_TOKEN=');
    for (const invocation of vi.mocked(sshRun).mock.calls) {
      expect(invocation[1]).not.toContain('dummy-keychain-password');
      expect(invocation[1]).not.toContain('p12-password');
      expect(invocation[1]).not.toContain('quoted-token');
    }
  });
});
