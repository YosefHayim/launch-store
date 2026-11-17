import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertEdit, makeTestApi, rejectionOf } from '@/play-console-api/test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('details', () => {
  it('raises PlayAppNotFoundError when edit creation reports a missing app', async () => {
    insertEdit.mockRejectedValue(
      Object.assign(new Error('Application not found.'), { status: 404 }),
    );
    const appLookupFailure = await rejectionOf(client.assertAppExists('com.example.missing'));
    expect(appLookupFailure).toMatchObject({ _tag: 'PlayAppNotFoundError' });
  });
});
