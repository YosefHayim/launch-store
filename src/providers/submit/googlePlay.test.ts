import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';

/** Snapshot of staged supply metadata while the scoped temp dir still exists. */
type CapturedChangelogSnapshot = Readonly<{
  readonly enUs: string;
  readonly iwIl: string;
}>;

// Capture the fastlane invocation (command, args, and exec options) instead of running it.
// When a metadata path is present, also snapshot changelog files before the scoped temp is deleted.
let capturedChangelogs: CapturedChangelogSnapshot | undefined;
const runMock = vi.fn<
  (
    executable: string,
    commandArguments: readonly string[],
    commandOptions?: {
      environmentOverrides?: Record<string, string>;
    },
  ) => Promise<void>
>((_executable, commandArguments) => {
  const metadataPathIndex = commandArguments.indexOf('--metadata_path');
  if (metadataPathIndex >= 0) {
    const metadataDirectory = commandArguments[metadataPathIndex + 1];
    if (metadataDirectory !== undefined) {
      capturedChangelogs = {
        enUs: readFileSync(join(metadataDirectory, 'en-US', 'changelogs', 'default.txt'), 'utf8'),
        iwIl: readFileSync(join(metadataDirectory, 'iw-IL', 'changelogs', 'default.txt'), 'utf8'),
      };
    }
  }
  return Promise.resolve();
});
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
const androidCtx = (
  env: Record<string, string> = {},
  android: ResolvedBuildContext['android'] = { track: 'internal', rollout: 1 },
): ResolvedBuildContext => {
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
    android,
  };
};
afterEach(() => {
  runMock.mockClear();
  capturedChangelogs = undefined;
});
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
describe('google-play submitter - release notes / changelogs (issue #309)', () => {
  it('skips changelog upload when no release notes are configured', async () => {
    const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await Effect.runPromise(
      googlePlaySubmitter.submit('/tmp/app.aab', 'testing', creds, androidCtx()),
    );
    const fastlaneInvocation = runMock.mock.calls[0];
    expect(fastlaneInvocation).toBeDefined();
    if (fastlaneInvocation === undefined) return;
    const [, commandArguments] = fastlaneInvocation;
    const skipIndex = commandArguments.indexOf('--skip_upload_changelogs');
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(commandArguments[skipIndex + 1]).toBe('true');
    expect(commandArguments).not.toContain('--metadata_path');
  });
  it('stages supply changelog files and stops skipping changelogs when notes are present', async () => {
    const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await Effect.runPromise(
      googlePlaySubmitter.submit(
        '/tmp/app.aab',
        'testing',
        creds,
        androidCtx(
          {},
          {
            track: 'internal',
            rollout: 1,
            releaseNotes: [
              { language: 'en-US', text: 'Bug fixes and speed' },
              { language: 'iw-IL', text: 'תיקוני באגים' },
            ],
          },
        ),
      ),
    );
    const fastlaneInvocation = runMock.mock.calls[0];
    expect(fastlaneInvocation).toBeDefined();
    if (fastlaneInvocation === undefined) return;
    const [, commandArguments] = fastlaneInvocation;
    expect(commandArguments).not.toContain('--skip_upload_changelogs');
    expect(commandArguments).toContain('--metadata_path');
    expect(capturedChangelogs).toEqual({
      enUs: 'Bug fixes and speed',
      iwIl: 'תיקוני באגים',
    });
  });
});
