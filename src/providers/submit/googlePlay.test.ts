import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
// Capture the fastlane invocation (command, args, and exec options) instead of running it.
const runMock = vi.fn<
  (
    executable: string,
    commandArguments: readonly string[],
    commandOptions?: {
      environmentOverrides?: Record<string, string>;
    },
  ) => Promise<void>
>(() => Promise.resolve());
vi.mock('../../core/services/exec.js', () => ({
  executeCommand: (
    executable: string,
    commandArguments: readonly string[],
    commandOptions?: {
      environmentOverrides?: Record<string, string>;
    },
  ) => Effect.promise(() => runMock(executable, commandArguments, commandOptions)),
  provideNodeCommandServices: <TProgram>(commandProgram: TProgram): TProgram => commandProgram,
}));
const { googlePlaySubmitter } = await import('./googlePlay.js');
/** Minimal Android build context whose app has DIFFERENT android.package vs ios.bundleIdentifier. */
const androidCtx = (env: Record<string, string> = {}): ResolvedBuildContext => {
  return {
    platform: 'android',
    app: {
      name: 'hello',
      dir: '/tmp/hello',
      configPath: '/tmp/hello/app.json',
      packageName: 'com.example.hello.android',
      bundleId: 'com.example.hello.ios',
    },
    profile: { name: 'production' },
    env,
    explain: false,
    dryRun: false,
    forceClean: false,
    android: { track: 'internal', rollout: 1 },
  };
};
afterEach(() => runMock.mockClear());
describe('google-play submitter - package_name (EAS #3563 regression)', () => {
  it('passes --package_name from android.package, NOT the iOS bundle identifier', async () => {
    const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await Effect.runPromise(
      googlePlaySubmitter.submit('/tmp/app.aab', 'testing', creds, androidCtx()),
    );
    const fastlaneInvocation = runMock.mock.calls[0];
    expect(fastlaneInvocation).toBeDefined();
    if (fastlaneInvocation === undefined) return;
    const [, commandArguments] = fastlaneInvocation;
    const packageNameIndex = commandArguments.indexOf('--package_name');
    expect(commandArguments[packageNameIndex + 1]).toBe('com.example.hello.android');
    expect(commandArguments).not.toContain('com.example.hello.ios');
  });
  it('forwards the resolved env to fastlane (issue #25)', async () => {
    const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await Effect.runPromise(
      googlePlaySubmitter.submit(
        '/tmp/app.aab',
        'production',
        creds,
        androidCtx({ APP_VARIANT: 'prod' }),
      ),
    );
    const fastlaneInvocation = runMock.mock.calls[0];
    expect(fastlaneInvocation).toBeDefined();
    if (fastlaneInvocation === undefined) return;
    const [, , commandOptions] = fastlaneInvocation;
    expect(commandOptions?.environmentOverrides).toEqual({ APP_VARIANT: 'prod' });
  });
});
