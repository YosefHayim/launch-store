import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitEdit,
  deleteEdit,
  getTrack,
  insertEdit,
  listBundles,
  listTracks,
  makeTestApi,
  openReadEdit,
  updateTrack,
  uploadBundle,
} from '@/play-console-api/test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('tracks', () => {
  it('returns the highest uploaded version code and abandons the read edit', async () => {
    openReadEdit();
    listBundles.mockResolvedValue({
      data: { bundles: [{ versionCode: 3 }, { versionCode: 7 }] },
    });
    expect(await client.getLatestVersionCode('com.example.hello')).toBe(7);
    expect(insertEdit).toHaveBeenCalledWith({ packageName: 'com.example.hello' });
    expect(listBundles).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
    expect(deleteEdit).toHaveBeenCalledWith({
      packageName: 'com.example.hello',
      editId: 'edit1',
    });
  });
  it('reports zero when no bundles have been uploaded', async () => {
    openReadEdit();
    listBundles.mockResolvedValue({ data: {} });
    expect(await client.getLatestVersionCode('com.example.fresh')).toBe(0);
  });
  it('normalizes track releases inside a throwaway edit', async () => {
    openReadEdit();
    getTrack.mockResolvedValue({
      data: {
        releases: [
          {
            name: '1.2.0',
            versionCodes: ['12'],
            status: 'inProgress',
            userFraction: 0.1,
            releaseNotes: [{ language: 'en-US', text: 'fixes' }],
          },
        ],
      },
    });

    expect(await client.getTrackReleases('com.example.app', 'beta')).toEqual([
      {
        name: '1.2.0',
        versionCodes: ['12'],
        status: 'inProgress',
        userFraction: 0.1,
        releaseNotes: [{ language: 'en-US', text: 'fixes' }],
      },
    ]);
  });
  it('lists every track with normalized releases', async () => {
    openReadEdit();
    listTracks.mockResolvedValue({
      data: {
        tracks: [
          { track: 'internal', releases: [{ name: '1.0.0', status: 'completed' }] },
          { track: 12 },
          { track: 'production', releases: null },
        ],
      },
    });
    expect(await client.listTracks('com.example.app')).toEqual([
      {
        track: 'internal',
        releases: [{ name: '1.0.0', status: 'completed' }],
      },
      { track: 'production', releases: [] },
    ]);
  });
  it('commits setTrackReleases inside one edit', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    updateTrack.mockResolvedValue({ data: {} });

    await client.setTrackReleases('com.example.app', 'production', [
      { name: '2.0.0', versionCodes: ['20'], status: 'completed' },
    ]);

    expect(updateTrack).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'production',
      requestBody: {
        track: 'production',
        releases: [{ name: '2.0.0', versionCodes: ['20'], status: 'completed' }],
      },
    });
    expect(commitEdit).toHaveBeenCalledTimes(1);
  });
  it('uploads a bundle and releases its version code on the track in one edit', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    commitEdit.mockResolvedValue({ data: {} });
    uploadBundle.mockResolvedValue({ data: { versionCode: 31 } });
    updateTrack.mockResolvedValue({ data: {} });
    const bundleStream = Readable.from([Buffer.from([1, 2, 3])]);
    const versionCode = await client.uploadBundleToTrack('com.example.app', bundleStream, 'beta', {
      status: 'inProgress',
      userFraction: 0.2,
    });
    expect(versionCode).toBe(31);
    expect(uploadBundle).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      media: { mimeType: 'application/octet-stream', body: bundleStream },
    });
    expect(updateTrack).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      editId: 'edit1',
      track: 'beta',
      requestBody: {
        track: 'beta',
        releases: [{ status: 'inProgress', userFraction: 0.2, versionCodes: ['31'] }],
      },
    });
    expect(commitEdit).toHaveBeenCalledTimes(1);
  });
  it('abandons the edit when the uploaded bundle has no version code', async () => {
    insertEdit.mockResolvedValue({ data: { id: 'edit1' } });
    deleteEdit.mockResolvedValue({ data: undefined });
    uploadBundle.mockResolvedValue({ data: {} });
    await expect(
      client.uploadBundleToTrack('com.example.app', Readable.from([Buffer.from([1])]), 'internal', {
        status: 'completed',
      }),
    ).rejects.toThrow(/returned no versionCode/);
    expect(updateTrack).not.toHaveBeenCalled();
    expect(commitEdit).not.toHaveBeenCalled();
    expect(deleteEdit).toHaveBeenCalledWith({ packageName: 'com.example.app', editId: 'edit1' });
  });
});
