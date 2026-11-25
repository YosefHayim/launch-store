import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from './cli.js';

describe('main', () => {
  afterEach(function restoreArgv() {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('prints the commands for --help', async () => {
    process.argv = ['node', 'launch', '--help'];
    const log = vi.spyOn(console, 'log').mockImplementation(function silence() {});
    await main();

    expect(process.exitCode).toBeUndefined();
    expect(log.mock.calls.join('\n')).toContain('launch build ios');
  });

  it('exits 2 for an unknown command', async () => {
    process.argv = ['node', 'launch', 'doctor'];
    vi.spyOn(console, 'log').mockImplementation(function silence() {});
    await main();

    expect(process.exitCode).toBe(2);
  });
});
