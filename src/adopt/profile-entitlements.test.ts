import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCommandOutput, makeCommandFailed } from '../services/platform/exec.ts';
import { extractProfileEntitlements } from './profile-entitlements.ts';

vi.mock('../services/platform/os.ts', function mockOs() {
  return { checkIsMacOperatingSystem: () => true };
});
vi.mock(
  '../services/platform/exec.ts',
  async function mockExec(importOriginal: <T = unknown>() => Promise<T>) {
    const commandServices = await importOriginal<typeof import('../services/platform/exec.ts')>();
    return { ...commandServices, captureCommandOutput: vi.fn() };
  },
);

const captureMock = vi.mocked(captureCommandOutput);

function readCaptureCall(index: number) {
  const call = captureMock.mock.calls.at(index);

  expect(call).toBeDefined();

  if (call == null) {
    throw new Error(`Expected capture call ${index}`);
  }

  return call;
}

function prepare() {
  captureMock.mockReset();
}

beforeEach(prepare);

function describeExtractProfileEntitlements() {
  async function returnsNullForPieceThatIsnTADecodableProvisioningProfileOrOffMac() {
    const commandFailed = makeCommandFailed({
      command: 'security',
      exitCode: 1,
      stderr: 'security cms failed',
    });

    captureMock.mockRejectedValueOnce(commandFailed);

    const profileEntitlements = await extractProfileEntitlements('bm90LWEtcHJvZmlsZQ==');

    expect(profileEntitlements).toBeNull();
  }

  it(
    "returns null for content that isn't a decodable provisioning profile (or off-Mac)",
    returnsNullForPieceThatIsnTADecodableProvisioningProfileOrOffMac,
  );

  async function extractsEntitlementsAsXml1BeforeConvertingTheSubPlistToJSON() {
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
  }

  it(
    'extracts Entitlements as xml1 before converting the sub-plist to JSON',
    extractsEntitlementsAsXml1BeforeConvertingTheSubPlistToJSON,
  );
}

describe('extractProfileEntitlements', describeExtractProfileEntitlements);
