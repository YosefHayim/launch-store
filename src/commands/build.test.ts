import { describe, expect, it } from 'vitest';

import { UsageError } from '@/usage-error.js';

import { runBuild } from './build.js';

describe('runBuild', () => {
  it('rejects a missing platform', async () => {
    await expect(runBuild([])).rejects.toBeInstanceOf(UsageError);
  });
});
