import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { run } from './exec.js';
import { UTF8_LOCALE } from './locale.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

function mockChild(exitCode = 0): EventEmitter {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('close', exitCode));
  return child;
}

describe('exec.run locale', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('passes UTF-8 locale env to spawned children', async () => {
    vi.mocked(spawn).mockReturnValue(mockChild(0) as never);

    await run('echo', ['hi']);

    expect(spawn).toHaveBeenCalledWith(
      'echo',
      ['hi'],
      expect.objectContaining({
        env: expect.objectContaining({
          LANG: UTF8_LOCALE.LANG,
          LC_ALL: UTF8_LOCALE.LC_ALL,
        }),
      }),
    );
  });
});
