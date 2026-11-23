import { describe, expect, it, vi } from 'vitest';
import { platform } from 'node:os';
import {
  checkIsMacOperatingSystem,
  detectHostOperatingSystem,
  resolveHostOperatingSystemLabel,
} from './host-operating-system.ts';
vi.mock('node:os', function mockOs() {
  return { platform: vi.fn(() => 'darwin') };
});

const platformMock = vi.mocked(platform);

function describeHostOSDetection() {
  function mapsDarwinMacOSTheOnlyLocalSigningHost() {
    platformMock.mockReturnValue('darwin');

    const hostOperatingSystem = detectHostOperatingSystem();

    expect(hostOperatingSystem).toBe('macos');

    const isMacOperatingSystem = checkIsMacOperatingSystem();

    expect(isMacOperatingSystem).toBe(true);

    const hostOperatingSystemLabel = resolveHostOperatingSystemLabel();

    expect(hostOperatingSystemLabel).toBe('macOS');
  }

  it('maps darwin -> macOS (the only local-signing host)', mapsDarwinMacOSTheOnlyLocalSigningHost);

  function mapsWin32WindowsMustBuildRemotely() {
    platformMock.mockReturnValue('win32');

    const hostOperatingSystem = detectHostOperatingSystem();

    expect(hostOperatingSystem).toBe('windows');

    const isMacOperatingSystem = checkIsMacOperatingSystem();

    expect(isMacOperatingSystem).toBe(false);

    const hostOperatingSystemLabel = resolveHostOperatingSystemLabel();

    expect(hostOperatingSystemLabel).toBe('Windows');
  }

  it('maps win32 -> windows (must build remotely)', mapsWin32WindowsMustBuildRemotely);

  function treatsEverythingElseAsLinux() {
    platformMock.mockReturnValue('linux');

    const hostOperatingSystem = detectHostOperatingSystem();

    expect(hostOperatingSystem).toBe('linux');

    const isMacOperatingSystem = checkIsMacOperatingSystem();

    expect(isMacOperatingSystem).toBe(false);

    const hostOperatingSystemLabel = resolveHostOperatingSystemLabel();

    expect(hostOperatingSystemLabel).toBe('Linux');
  }

  it('treats everything else as linux', treatsEverythingElseAsLinux);
}

describe('host OS detection', describeHostOSDetection);
