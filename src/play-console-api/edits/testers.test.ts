import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitEdit,
  getTesters,
  insertEdit,
  makeTestApi,
  openReadEdit,
  updateTesters,
} from '@/play-console-api/test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('testers', () => {
  it('returns the tester groups for a track inside a throwaway edit', async () => {
    openReadEdit();
    getTesters.mockResolvedValue({ data: { googleGroups: ['qa@example.com'] } });

    expect(await client.getTesters('com.example.app', 'beta')).toEqual(['qa@example.com']);
  });
  it('commits setTesters inside one edit', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    updateTesters.mockResolvedValue({ data: {} });

    await client.setTesters('com.example.app', 'internal', ['group@x.com']);

    expect(updateTesters).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'internal',
      requestBody: { googleGroups: ['group@x.com'] },
    });
    expect(commitEdit).toHaveBeenCalledTimes(1);
  });
});
