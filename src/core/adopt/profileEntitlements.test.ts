import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { capture } from '../services/exec.js';
import { extractProfileEntitlements } from './profileEntitlements.js';

vi.mock('../services/os.js', () => ({ isMac: () => true }));
vi.mock('../services/exec.js', () => ({ capture: vi.fn() }));

const captureMock = vi.mocked(capture);

/**
 * Read one mocked `capture` call with a real narrowing so tests avoid non-null assertions.
 *
 * @param index - Call index to read.
 * @returns The command and args captured at that index.
 */
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
    captureMock.mockRejectedValueOnce(new Error('security cms failed'));

    expect(await Effect.runPromise(extractProfileEntitlements('bm90LWEtcHJvZmlsZQ=='))).toBeNull();
  });

  it('extracts Entitlements as xml1 before converting the sub-plist to JSON', async () => {
    captureMock
      .mockResolvedValueOnce(
        '<plist><dict><key>DeveloperCertificates</key><data>abc</data></dict></plist>',
      )
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(
        JSON.stringify({ 'com.apple.security.application-groups': ['group.com.acme.app'] }),
      );

    await expect(Effect.runPromise(extractProfileEntitlements('cHJvZmlsZQ=='))).resolves.toEqual({
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
