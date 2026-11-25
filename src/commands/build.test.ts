import { describe, expect, it } from 'vitest';

import { runBuild } from './build.js';

describe('runBuild', () => {
  it('rejects a missing platform', async () => {
    await expect(runBuild([])).rejects.toMatchObject({ name: 'UsageError' });
  });
});
