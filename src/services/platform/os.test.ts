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
    expect(detectHostOperatingSystem()).toBe('macos');
    expect(checkIsMacOperatingSystem()).toBe(true);
    expect(resolveHostOperatingSystemLabel()).toBe('macOS');
  });
  it('maps win32 -> windows (must build remotely)', () => {
    platformMock.mockReturnValue('win32');
    expect(detectHostOperatingSystem()).toBe('windows');
    expect(checkIsMacOperatingSystem()).toBe(false);
    expect(resolveHostOperatingSystemLabel()).toBe('Windows');
  });
  it('treats everything else as linux', () => {
    platformMock.mockReturnValue('linux');
    expect(detectHostOperatingSystem()).toBe('linux');
    expect(checkIsMacOperatingSystem()).toBe(false);
    expect(resolveHostOperatingSystemLabel()).toBe('Linux');
  });
});
