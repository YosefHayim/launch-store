import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
vi.mock('node:os', () => ({ platform: vi.fn(() => 'darwin') }));
import { platform } from 'node:os';
import {
  checkIsMacOperatingSystem,
  detectHostOperatingSystem,
  resolveHostOperatingSystemLabel,
} from './os.js';
const platformMock = vi.mocked(platform);
describe('host OS detection', () => {
  it('maps darwin -> macOS (the only local-signing host)', () => {
    platformMock.mockReturnValue('darwin');
    expect(Effect.runSync(detectHostOperatingSystem)).toBe('macos');
    expect(Effect.runSync(checkIsMacOperatingSystem)).toBe(true);
    expect(Effect.runSync(resolveHostOperatingSystemLabel)).toBe('macOS');
  });
  it('maps win32 -> windows (must build remotely)', () => {
    platformMock.mockReturnValue('win32');
    expect(Effect.runSync(detectHostOperatingSystem)).toBe('windows');
    expect(Effect.runSync(checkIsMacOperatingSystem)).toBe(false);
    expect(Effect.runSync(resolveHostOperatingSystemLabel)).toBe('Windows');
  });
  it('treats everything else as linux', () => {
    platformMock.mockReturnValue('linux');
    expect(Effect.runSync(detectHostOperatingSystem)).toBe('linux');
    expect(Effect.runSync(checkIsMacOperatingSystem)).toBe(false);
    expect(Effect.runSync(resolveHostOperatingSystemLabel)).toBe('Linux');
  });
});
