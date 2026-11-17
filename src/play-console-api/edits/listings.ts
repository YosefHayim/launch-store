// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import type { PlayListing } from '@/core/types/googlePlay.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import { mutableGoogleRequest, type PlayRequests } from '@/play-console-api/api-client.js';

const readListing = (
  googleListing: androidpublisher_v3.Schema$Listing,
): PlayListing | undefined => {
  if (typeof googleListing.language !== 'string') return undefined;
  const listing: MutableDeep<PlayListing> = { language: googleListing.language };
  if (typeof googleListing.title === 'string') listing.title = googleListing.title;
  if (typeof googleListing.shortDescription === 'string') {
    listing.shortDescription = googleListing.shortDescription;
  }
  if (typeof googleListing.fullDescription === 'string') {
    listing.fullDescription = googleListing.fullDescription;
  }
  if (typeof googleListing.video === 'string') listing.video = googleListing.video;
  return listing;
};

export const makeListingsApi = (play: PlayRequests) => {
  /** Read every localized store listing (title, short and full description, video) of an app. */
  const listListings = (packageName: string): Promise<PlayListing[]> =>
    play.withReadEdit(packageName, async (editId) => {
      const listingCatalog = await play.send('list listings', () =>
        play.publisher.edits.listings.list({ packageName, editId }),
      );
      const listings: PlayListing[] = [];
      if (!Array.isArray(listingCatalog.listings)) return listings;
      for (const googleListing of listingCatalog.listings) {
        const listing = readListing(googleListing);
        if (listing !== undefined) listings.push(listing);
      }
      return listings;
    });

  /** Patch the given store listings inside ONE committed edit, so every language lands together or none does. */
  const updateListings = (packageName: string, listings: readonly PlayListing[]): Promise<void> =>
    play.withEdit(packageName, async (editId) => {
      for (const listing of listings) {
        // biome-ignore lint/performance/noAwaitInLoops: one open edit takes its listing patches one at a time
        await play.send('update listing', () =>
          play.publisher.edits.listings.patch({
            packageName,
            editId,
            language: listing.language,
            requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Listing>(listing),
          }),
        );
      }
    });

  return { listListings, updateListings };
};
