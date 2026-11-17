// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import type { Readable } from 'node:stream';
import type { PlayRelease, PlayTrackInfo } from '@/core/types/googlePlay.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import {
  makeGooglePlayApiError,
  mutableGoogleRequest,
  type PlayRequests,
} from '@/play-console-api/api-client.js';

const readTrackRelease = (googleRelease: androidpublisher_v3.Schema$TrackRelease): PlayRelease => {
  const release: MutableDeep<PlayRelease> = {};
  if (typeof googleRelease.name === 'string') release.name = googleRelease.name;
  if (Array.isArray(googleRelease.versionCodes)) release.versionCodes = googleRelease.versionCodes;
  if (typeof googleRelease.status === 'string') release.status = googleRelease.status;
  if (typeof googleRelease.userFraction === 'number') {
    release.userFraction = googleRelease.userFraction;
  }
  if (Array.isArray(googleRelease.releaseNotes)) {
    const releaseNotes: {
      language: string;
      text: string;
    }[] = [];
    for (const googleNote of googleRelease.releaseNotes) {
      if (typeof googleNote.language !== 'string') continue;
      if (typeof googleNote.text !== 'string') continue;
      releaseNotes.push({ language: googleNote.language, text: googleNote.text });
    }
    release.releaseNotes = releaseNotes;
  }
  return release;
};

const listTrackReleases = (
  googleReleases: androidpublisher_v3.Schema$TrackRelease[] | null | undefined,
): PlayRelease[] => {
  const releases: PlayRelease[] = [];
  if (!Array.isArray(googleReleases)) return releases;
  for (const googleRelease of googleReleases) {
    releases.push(readTrackRelease(googleRelease));
  }
  return releases;
};

export const makeTracksApi = (play: PlayRequests) => {
  /** Return the highest `versionCode` already uploaded for an app, or 0 if none exist yet. */
  const getLatestVersionCode = (packageName: string): Promise<number> =>
    play.withReadEdit(packageName, async (editId) => {
      const bundlePage = await play.send('list bundles', () =>
        play.publisher.edits.bundles.list({ packageName, editId }),
      );
      const codes: number[] = [];
      if (Array.isArray(bundlePage.bundles)) {
        for (const bundle of bundlePage.bundles) {
          if (typeof bundle.versionCode === 'number') codes.push(bundle.versionCode);
        }
      }
      if (codes.length === 0) return 0;
      return Math.max(...codes);
    });

  /** Read the releases currently on a track; empty array when the track is unused. */
  const getTrackReleases = (packageName: string, track: string): Promise<PlayRelease[]> =>
    play.withReadEdit(packageName, async (editId) => {
      const trackSnapshot = await play.send('get track', () =>
        play.publisher.edits.tracks.get({ packageName, editId, track }),
      );
      return listTrackReleases(trackSnapshot.releases);
    });

  /** Read every track and its releases. */
  const listTracks = (packageName: string): Promise<PlayTrackInfo[]> =>
    play.withReadEdit(packageName, async (editId) => {
      const trackCatalog = await play.send('list tracks', () =>
        play.publisher.edits.tracks.list({ packageName, editId }),
      );
      const tracks: PlayTrackInfo[] = [];
      if (!Array.isArray(trackCatalog.tracks)) return tracks;
      for (const googleTrack of trackCatalog.tracks) {
        if (typeof googleTrack.track !== 'string') continue;
        tracks.push({
          track: googleTrack.track,
          releases: listTrackReleases(googleTrack.releases),
        });
      }
      return tracks;
    });

  /** Replace a track's releases in one committed edit - the promote/rollout/halt write. */
  const setTrackReleases = (
    packageName: string,
    track: string,
    releases: readonly PlayRelease[],
  ): Promise<void> =>
    play.withEdit(packageName, async (editId) => {
      await play.send('update track', () =>
        play.publisher.edits.tracks.update({
          packageName,
          editId,
          track,
          requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Track>({ track, releases }),
        }),
      );
    });

  /** Upload an AAB and release it on a track in one committed edit, so a bundle never lands without its release. */
  const uploadBundleToTrack = (
    packageName: string,
    bundleStream: Readable,
    track: string,
    release: Omit<PlayRelease, 'versionCodes'>,
  ): Promise<number> =>
    play.withEdit(packageName, async (editId) => {
      const uploadedBundle = await play.send('upload bundle', () =>
        play.publisher.edits.bundles.upload({
          packageName,
          editId,
          media: { mimeType: 'application/octet-stream', body: bundleStream },
        }),
      );
      const versionCode = uploadedBundle.versionCode;
      if (typeof versionCode !== 'number') {
        throw makeGooglePlayApiError({
          operation: 'upload bundle',
          message:
            'Google Play upload bundle failed: the generated client returned no versionCode.',
          cause: uploadedBundle,
        });
      }
      const trackRelease: PlayRelease = { ...release, versionCodes: [String(versionCode)] };
      await play.send('update track', () =>
        play.publisher.edits.tracks.update({
          packageName,
          editId,
          track,
          requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Track>({
            track,
            releases: [trackRelease],
          }),
        }),
      );
      return versionCode;
    });

  return {
    getLatestVersionCode,
    getTrackReleases,
    listTracks,
    setTrackReleases,
    uploadBundleToTrack,
  };
};
