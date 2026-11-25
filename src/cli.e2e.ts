import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('built launch cli', () => {
  it('prints the commands', async () => {
    const { stdout } = await execFileAsync('node', ['dist/cli.js', '--help']);

    expect(stdout).toContain('launch build ios');
    expect(stdout).toContain('launch sync');
  });
});
