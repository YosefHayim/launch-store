import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildCredentials, ResolvedBuildContext } from '../../core/types.js';

// Capture the fastlane invocation (command, args, and exec options) instead of running it.
const runMock = vi.fn<
  (cmd: string, args: string[], options?: { env?: Record<string, string> }) => Promise<void>
>(() => Promise.resolve());
vi.mock('../../core/exec.js', () => ({
  run: (cmd: string, args: string[], options?: { env?: Record<string, string> }) =>
    runMock(cmd, args, options),
}));

const { googlePlaySubmitter } = await import('./googlePlay.js');

/** Minimal Android build context whose app has DIFFERENT android.package vs ios.bundleIdentifier. */
function androidCtx(env: Record<string, string> = {}): ResolvedBuildContext {
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
}

afterEach(() => runMock.mockClear());

describe('google-play submitter — package_name (EAS #3563 regression)', () => {
  it('passes --package_name from android.package, NOT the iOS bundle identifier', async () => {
    const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await googlePlaySubmitter.submit('/tmp/app.aab', 'testing', creds, androidCtx());

    const [, args = []] = runMock.mock.calls[0] ?? [];
    const packageNameIndex = args.indexOf('--package_name');
    expect(args[packageNameIndex + 1]).toBe('com.example.hello.android');
    expect(args).not.toContain('com.example.hello.ios');
  });

  it('forwards the resolved env to fastlane (issue #25)', async () => {
    const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await googlePlaySubmitter.submit(
      '/tmp/app.aab',
      'production',
      creds,
      androidCtx({ APP_VARIANT: 'prod' }),
    );

    const [, , options] = runMock.mock.calls[0] ?? [];
    expect(options?.env).toEqual({ APP_VARIANT: 'prod' });
  });
});
