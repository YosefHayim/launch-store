// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers
import type { PlayRequests } from '@/play-console-api/api-client.js';

export const makeTestersApi = (play: PlayRequests) => {
  /** Read the Google Groups configured as testers for a track (closed/internal testing). */
  const getTesters = (packageName: string, track: string): Promise<string[]> =>
    play.withReadEdit(packageName, async (editId) => {
      const testerGroupSet = await play.send('get testers', () =>
        play.publisher.edits.testers.get({ packageName, editId, track }),
      );
      if (!Array.isArray(testerGroupSet.googleGroups)) return [];
      return testerGroupSet.googleGroups;
    });

  /** Set the Google Groups allowed to test a track, in one committed edit. */
  const setTesters = (
    packageName: string,
    track: string,
    googleGroups: readonly string[],
  ): Promise<void> =>
    play.withEdit(packageName, async (editId) => {
      await play.send('update testers', () =>
        play.publisher.edits.testers.update({
          packageName,
          editId,
          track,
          requestBody: { googleGroups: [...googleGroups] },
        }),
      );
    });

  return { getTesters, setTesters };
};
