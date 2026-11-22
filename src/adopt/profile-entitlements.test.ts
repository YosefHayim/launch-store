import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCommandOutput, makeCommandFailed } from '../services/platform/exec.ts';
import { extractProfileEntitlements } from './profile-entitlements.ts';

vi.mock('../services/platform/os.ts', () => ({ checkIsMacOperatingSystem: () => true }));
vi.mock('../services/platform/exec.ts', async (importOriginal) => {
  const commandServices = await importOriginal<typeof import('../services/platform/exec.ts')>();
  return { ...commandServices, captureCommandOutput: vi.fn() };
});

const captureMock = vi.mocked(captureCommandOutput);

function readCaptureCall(index: number) {
  const call = captureMock.mock.calls.at(index);
  expect(call).toBeDefined();

  if (call == null) {
    throw new Error(`Expected capture call ${index}`);
  }

  return call;
}

beforeEach(() => {
  captureMock.mockReset();
});

describe('extractProfileEntitlements', () => {
  it("returns null for content that isn't a decodable provisioning profile (or off-Mac)", async () => {
    const commandFailed = makeCommandFailed({
      command: 'security',
      exitCode: 1,
      stderr: 'security cms failed',
    });
    captureMock.mockRejectedValueOnce(commandFailed);
    const profileEntitlements = await extractProfileEntitlements('bm90LWEtcHJvZmlsZQ==');
    expect(profileEntitlements).toBeNull();
  });

  it('extracts Entitlements as xml1 before converting the sub-plist to JSON', async () => {
    const serialized = JSON.stringify({
      'com.apple.security.application-groups': ['group.com.acme.app'],
    });
    captureMock
      .mockResolvedValueOnce(
        '<plist><dict><key>DeveloperCertificates</key><data>abc</data></dict></plist>',
      )
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(serialized);
    const profileEntitlements = extractProfileEntitlements('cHJvZmlsZQ==');
    await expect(profileEntitlements).resolves.toEqual({
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
