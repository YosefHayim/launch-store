import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitEdit,
  deleteEdit,
  insertEdit,
  listListings,
  makeTestApi,
  openReadEdit,
  patchListing,
  rejectionOf,
} from '@/play-console-api/test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('listings', () => {
  it('lists the localized listings and drops entries without a language', async () => {
    openReadEdit();
    listListings.mockResolvedValue({
      data: {
        listings: [
          {
            language: 'en-US',
            title: 'Hello',
            shortDescription: 'short',
            fullDescription: 'full',
            video: 'https://youtu.be/x',
          },
          { language: 'de-DE', title: 'Hallo', shortDescription: null },
          { title: 'no language' },
        ],
      },
    });
    expect(await client.listListings('com.example.app')).toEqual([
      {
        language: 'en-US',
        title: 'Hello',
        shortDescription: 'short',
        fullDescription: 'full',
        video: 'https://youtu.be/x',
      },
      { language: 'de-DE', title: 'Hallo' },
    ]);
    expect(listListings).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
    expect(commitEdit).not.toHaveBeenCalled();
  });
  it('returns no listings when the app has none', async () => {
    openReadEdit();
    listListings.mockResolvedValue({ data: {} });
    expect(await client.listListings('com.example.app')).toEqual([]);
  });
  it('patches every language inside one committed edit', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    patchListing.mockResolvedValue({ data: {} });
    await client.updateListings('com.example.app', [
      { language: 'en-US', title: 'Hello', shortDescription: 'short' },
      { language: 'de-DE', fullDescription: 'voll' },
    ]);
    expect(patchListing).toHaveBeenCalledTimes(2);
    expect(patchListing).toHaveBeenNthCalledWith(1, {
      packageName: 'com.example.app',
      editId: 'edit1',
      language: 'en-US',
      requestBody: { language: 'en-US', title: 'Hello', shortDescription: 'short' },
    });
    expect(patchListing).toHaveBeenNthCalledWith(2, {
      packageName: 'com.example.app',
      editId: 'edit1',
      language: 'de-DE',
      requestBody: { language: 'de-DE', fullDescription: 'voll' },
    });
    expect(insertEdit).toHaveBeenCalledTimes(1);
    expect(commitEdit).toHaveBeenCalledTimes(1);
  });
  it('abandons the edit when a listing patch fails', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });
    patchListing.mockRejectedValue(Object.assign(new Error('bad title'), { status: 400 }));
    const listingFailure = await rejectionOf(
      client.updateListings('com.example.app', [{ language: 'en-US', title: '' }]),
    );
    expect(listingFailure).toMatchObject({ _tag: 'GooglePlayApiError', statusCode: 400 });
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  });
});
