import { makePlayRequests, type GooglePlayTransport } from './api-client.js';
import type { ServiceAccount } from '@/core/types/credentials.js';
import { makeCountryAvailabilityApi } from './edits/country-availability.js';
import { makeDetailsApi } from './edits/details.js';
import { makeListingsApi } from './edits/listings.js';
import { makeTestersApi } from './edits/testers.js';
import { makeTracksApi } from './edits/tracks.js';
import { makeInAppProductsApi } from './inappproducts.js';
import { makeConvertRegionPricesApi } from './monetization/convert-region-prices.js';
import { makeSubscriptionsApi } from './monetization/subscriptions.js';
import { makeReviewsApi } from './reviews.js';

export const makePlayConsoleApi = (
  account: ServiceAccount,
  generatedPublisher?: GooglePlayTransport,
) => {
  const play = makePlayRequests(account, generatedPublisher);
  return {
    serviceAccountEmail: play.serviceAccountEmail,
    withEdit: play.withEdit,
    ...makeTracksApi(play),
    ...makeTestersApi(play),
    ...makeListingsApi(play),
    ...makeCountryAvailabilityApi(play),
    ...makeDetailsApi(play),
    ...makeInAppProductsApi(play),
    ...makeReviewsApi(play),
    ...makeSubscriptionsApi(play),
    ...makeConvertRegionPricesApi(play),
  };
};

export type PlayConsoleApi = ReturnType<typeof makePlayConsoleApi>;
