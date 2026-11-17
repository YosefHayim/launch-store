// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/edits.countryavailability
import type { PlayCountryAvailability } from '@/core/types/googlePlay.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import type { PlayRequests } from '@/play-console-api/api-client.js';

export const makeCountryAvailabilityApi = (play: PlayRequests) => {
  /** Read a track's country availability. Read-only - Play exposes no API to change it. */
  const getCountryAvailability = (
    packageName: string,
    track: string,
  ): Promise<PlayCountryAvailability> =>
    play.withReadEdit(packageName, async (editId) => {
      const countryAvailability = await play.send('get country availability', () =>
        play.publisher.edits.countryavailability.get({ packageName, editId, track }),
      );
      const countries: { countryCode: string }[] = [];
      if (Array.isArray(countryAvailability.countries)) {
        for (const googleCountry of countryAvailability.countries) {
          if (typeof googleCountry.countryCode !== 'string') continue;
          countries.push({ countryCode: googleCountry.countryCode });
        }
      }
      const availability: MutableDeep<PlayCountryAvailability> = { countries };
      if (typeof countryAvailability.restOfWorld === 'boolean') {
        availability.restOfWorld = countryAvailability.restOfWorld;
      }
      return availability;
    });

  return { getCountryAvailability };
};
