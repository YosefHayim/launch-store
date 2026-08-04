import { NodeContext } from '@effect/platform-node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { captureCommandOutput, makeCommandFailed } from '../services/exec.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { extractProfileEntitlements } from './profileEntitlements.js';
vi.mock('../services/os.js', () => ({ checkIsMacOperatingSystem: Effect.succeed(true) }));
vi.mock('../services/exec.js', async (importOriginal) => {
  const commandServices = await importOriginal<typeof import('../services/exec.js')>();
  return { ...commandServices, captureCommandOutput: vi.fn() };
});
const captureMock = vi.mocked(captureCommandOutput);
const runExtractProfileEntitlements = (profileContent: string) =>
  Effect.runPromise(
    extractProfileEntitlements(profileContent).pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchEnvironmentTest({})),
    ),
  );
const readCaptureCall = (index: number) => {
  const call = captureMock.mock.calls.at(index);
  expect(call).toBeDefined();
  if (call === undefined) {
    throw new Error(`Expected capture call ${index}`);
  }
  return call;
};
beforeEach(() => {
  captureMock.mockReset();
});
describe('extractProfileEntitlements', () => {
  it("returns null for content that isn't a decodable provisioning profile (or off-Mac)", async () => {
    captureMock.mockReturnValueOnce(
      Effect.fail(
        makeCommandFailed({
          command: 'security',
          exitCode: 1,
          stderr: 'security cms failed',
        }),
      ),
    );
    expect(await runExtractProfileEntitlements('bm90LWEtcHJvZmlsZQ==')).toBeNull();
  });
  it('extracts Entitlements as xml1 before converting the sub-plist to JSON', async () => {
    captureMock
      .mockReturnValueOnce(
        Effect.succeed(
          '<plist><dict><key>DeveloperCertificates</key><data>abc</data></dict></plist>',
        ),
      )
      .mockReturnValueOnce(Effect.succeed(''))
      .mockReturnValueOnce(
        Effect.succeed(
          JSON.stringify({ 'com.apple.security.application-groups': ['group.com.acme.app'] }),
        ),
      );
    await expect(runExtractProfileEntitlements('cHJvZmlsZQ==')).resolves.toEqual({
      'com.apple.security.application-groups': ['group.com.acme.app'],
    });
    const securityCall = readCaptureCall(0);
    const extractCall = readCaptureCall(1);
    const convertCall = readCaptureCall(2);
    expect(securityCall).toEqual([
      'security',
      expect.arrayContaining([
        'cms',
        '-D',
        '-i',
        expect.stringContaining('profile.mobileprovision'),
      ]),
    ]);
    expect(extractCall).toEqual([
      'plutil',
      expect.arrayContaining(['-extract', 'Entitlements', 'xml1']),
    ]);
    expect(convertCall).toEqual([
      'plutil',
      expect.arrayContaining(['-convert', 'json', '-o', '-']),
    ]);
  });
});
