import { describe, expect, it, vi } from 'vitest';
import { platform } from 'node:os';
import {
  checkIsMacOperatingSystem,
  detectHostOperatingSystem,
  resolveHostOperatingSystemLabel,
} from './os.ts';
vi.mock('node:os', () => ({ platform: vi.fn(() => 'darwin') }));

const platformMock = vi.mocked(platform);

describe('host OS detection', () => {
  it('maps darwin -> macOS (the only local-signing host)', () => {
    platformMock.mockReturnValue('darwin');
    const hostOperatingSystem = detectHostOperatingSystem();
    expect(hostOperatingSystem).toBe('macos');
    const isMacOperatingSystem = checkIsMacOperatingSystem();
    expect(isMacOperatingSystem).toBe(true);
    const hostOperatingSystemLabel = resolveHostOperatingSystemLabel();
    expect(hostOperatingSystemLabel).toBe('macOS');
  });
  it('maps win32 -> windows (must build remotely)', () => {
    platformMock.mockReturnValue('win32');
    const hostOperatingSystem = detectHostOperatingSystem();
    expect(hostOperatingSystem).toBe('windows');
    const isMacOperatingSystem = checkIsMacOperatingSystem();
    expect(isMacOperatingSystem).toBe(false);
    const hostOperatingSystemLabel = resolveHostOperatingSystemLabel();
    expect(hostOperatingSystemLabel).toBe('Windows');
  });
  it('treats everything else as linux', () => {
    platformMock.mockReturnValue('linux');
    const hostOperatingSystem = detectHostOperatingSystem();
    expect(hostOperatingSystem).toBe('linux');
    const isMacOperatingSystem = checkIsMacOperatingSystem();
    expect(isMacOperatingSystem).toBe(false);
    const hostOperatingSystemLabel = resolveHostOperatingSystemLabel();
    expect(hostOperatingSystemLabel).toBe('Linux');
  });
});
