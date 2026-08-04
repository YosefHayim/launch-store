import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
// Capture the fastlane invocation instead of running it, and stub the temp-key file write.
const runMock = vi.fn<
  (
    executable: string,
    commandArguments: readonly string[],
    commandOptions?: {
      environmentOverrides?: Record<string, string>;
    },
  ) => Promise<void>
>(() => Promise.resolve());
vi.mock('@core/services/exec.js', () => ({
  executeCommand: (
    executable: string,
    commandArguments: readonly string[],
    commandOptions?: {
      environmentOverrides?: Record<string, string>;
    },
  ) => Effect.promise(() => runMock(executable, commandArguments, commandOptions)),
  provideNodeCommandServices: <TProgram>(commandProgram: TProgram): TProgram => commandProgram,
}));
const { appStoreConnectSubmitter } = await import('./appStoreConnect.js');
/** Minimal iOS build context. */
const iosCtx = (env: Record<string, string> = {}): ResolvedBuildContext => {
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
};
const IOS_CREDS: BuildCredentials = {
  platform: 'ios',
  ascKey: { keyId: 'K', issuerId: 'I', p8: 'PEM' },
};
afterEach(() => runMock.mockClear());
describe('app-store-connect submitter - binary upload via fastlane pilot', () => {
  it('uploads the ipa with pilot (review is now API-driven, never deliver) and forwards env', async () => {
    await Effect.runPromise(
      appStoreConnectSubmitter.submit(
        '/tmp/app.ipa',
        'production',
        IOS_CREDS,
        iosCtx({ FOO: 'bar' }),
      ),
    );
    const fastlaneInvocation = runMock.mock.calls[0];
    expect(fastlaneInvocation).toBeDefined();
    if (fastlaneInvocation === undefined) return;
    const [executable, commandArguments, commandOptions] = fastlaneInvocation;
    expect(executable).toBe('fastlane');
    expect(commandArguments[0]).toBe('pilot');
    expect(commandArguments[commandArguments.indexOf('--ipa') + 1]).toBe('/tmp/app.ipa');
    expect(commandArguments).not.toContain('deliver');
    expect(commandArguments).not.toContain('--submit_for_review');
    expect(commandOptions?.environmentOverrides).toEqual({ FOO: 'bar' });
  });
  it('rejects a non-iOS credential', async () => {
    const androidCreds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await expect(
      Effect.runPromise(
        appStoreConnectSubmitter.submit('/tmp/app.aab', 'testing', androidCreds, iosCtx()),
      ),
    ).rejects.toThrow(/iOS only/);
  });
});
