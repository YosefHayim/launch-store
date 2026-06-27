import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildCredentials, ResolvedBuildContext } from '../../core/types.js';

// Capture the fastlane invocation instead of running it, and stub the temp-key file write.
const runMock = vi.fn<
  (cmd: string, args: string[], options?: { env?: Record<string, string> }) => Promise<void>
>(() => Promise.resolve());
vi.mock('../../core/exec.js', () => ({
  run: (cmd: string, args: string[], options?: { env?: Record<string, string> }) =>
    runMock(cmd, args, options),
}));
vi.mock('../../apple/apiKeyFile.js', () => ({
  writeAscApiKeyFile: () => '/tmp/fake-asc-key.json',
}));

const { appStoreConnectSubmitter } = await import('./appStoreConnect.js');

/** Minimal iOS build context. */
function iosCtx(env: Record<string, string> = {}): ResolvedBuildContext {
  return {
    platform: 'ios',
    app: {
      name: 'hello',
      dir: '/tmp/hello',
      configPath: '/tmp/hello/app.json',
      bundleId: 'com.example.hello',
    },
    profile: { name: 'production' },
    env,
    explain: false,
    dryRun: false,
    forceClean: false,
  };
}

const IOS_CREDS: BuildCredentials = {
  platform: 'ios',
  ascKey: { keyId: 'K', issuerId: 'I', p8: 'PEM' },
};

afterEach(() => runMock.mockClear());

describe('app-store-connect submitter — binary upload via fastlane pilot', () => {
  it('uploads the ipa with pilot (review is now API-driven, never deliver) and forwards env', async () => {
    await appStoreConnectSubmitter.submit(
      '/tmp/app.ipa',
      'production',
      IOS_CREDS,
      iosCtx({ FOO: 'bar' }),
    );

    const [cmd, args, options] = runMock.mock.calls[0]!;
    expect(cmd).toBe('fastlane');
    expect(args[0]).toBe('pilot');
    expect(args[args.indexOf('--ipa') + 1]).toBe('/tmp/app.ipa');
    expect(args).not.toContain('deliver');
    expect(args).not.toContain('--submit_for_review');
    expect(options?.env).toEqual({ FOO: 'bar' });
  });

  it('rejects a non-iOS credential', async () => {
    const androidCreds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await expect(
      appStoreConnectSubmitter.submit('/tmp/app.aab', 'testing', androidCreds, iosCtx()),
    ).rejects.toThrow(/iOS only/);
  });
});
