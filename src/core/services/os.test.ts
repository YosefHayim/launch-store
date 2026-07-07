import { describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => ({ platform: vi.fn(() => 'darwin') }));

import { platform } from 'node:os';
import { hostOs, hostOsLabel, isMac } from './os.js';

const platformMock = vi.mocked(platform);

describe('host OS detection', () => {
  it('maps darwin → macOS (the only local-signing host)', () => {
    platformMock.mockReturnValue('darwin');
    expect(hostOs()).toBe('macos');
    expect(isMac()).toBe(true);
    expect(hostOsLabel()).toBe('macOS');
  });

  it('maps win32 → windows (must build remotely)', () => {
    platformMock.mockReturnValue('win32');
    expect(hostOs()).toBe('windows');
    expect(isMac()).toBe(false);
    expect(hostOsLabel()).toBe('Windows');
  });

  it('treats everything else as linux', () => {
    platformMock.mockReturnValue('linux');
    expect(hostOs()).toBe('linux');
    expect(isMac()).toBe(false);
    expect(hostOsLabel()).toBe('Linux');
  });
});
