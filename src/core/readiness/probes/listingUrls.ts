import { type FileSystem, HttpClient, HttpClientRequest, Path } from '@effect/platform';
import { Effect } from 'effect';
import { loadStoreConfig, type AppleStoreConfig } from '@core/store/storeConfig.js';
import type { AppDescriptor } from '@core/types/app.js';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';

export const URL_LIVENESS_TIMEOUT_MS = 5000;

type ListingUrl = {
  app: string;
  field: string;
  url: string;
};

/** Load one app's Apple listing without failing an otherwise unrelated readiness run. */
const loadAppleListing = (
  appDirectory: string,
): Effect.Effect<AppleStoreConfig | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const storeConfigPath = pathService.join(appDirectory, 'store.config.json');
    return yield* loadStoreConfig(storeConfigPath).pipe(
      Effect.map((storeConfig) => storeConfig.apple),
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
  });

/** Collect each unique Apple listing URL declared for one app. */
const collectListingUrls = (
  appDescriptor: AppDescriptor,
): Effect.Effect<ListingUrl[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const appleListing = yield* loadAppleListing(appDescriptor.dir);
    if (appleListing === undefined) return [];
    const seenUrls = new Set<string>();
    const listingUrls: ListingUrl[] = [];
    for (const listingLocalization of Object.values(appleListing.info)) {
      const fields: [string, string | undefined][] = [
        ['privacy-policy', listingLocalization.privacyPolicyUrl],
        ['support', listingLocalization.supportUrl],
        ['marketing', listingLocalization.marketingUrl],
      ];
      for (const [field, url] of fields) {
        if (url === undefined) continue;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        listingUrls.push({ app: appDescriptor.name, field, url });
      }
    }
    return listingUrls;
  });

/** Request one listing URL through the shared HTTP service. */
const requestListingUrlStatus = (
  listingUrl: string,
): Effect.Effect<number, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const listingRequest = HttpClientRequest.get(listingUrl);
    const listingReply = yield* httpClient.execute(listingRequest);
    return listingReply.status;
  }).pipe(Effect.timeout(`${URL_LIVENESS_TIMEOUT_MS} millis`));

/** Check that declared iOS listing URLs return successful HTTP statuses. */
export const listingUrlsProbe = {
  id: 'apple-listing-urls',
  title: 'iOS listing URLs resolve',
  store: 'appstore',
  categories: ['listing', 'submit'],
  /**
   * Verify that declared iOS listing URLs respond with HTTP 2xx.
   *
   * @param readinessContext - Loaded config and selected apps for the readiness run.
   * @returns URL liveness findings, or a tagged platform failure when a request cannot complete.
   */
  check(
    readinessContext: ReadinessContext,
  ): Effect.Effect<
    ProbeResult,
    unknown,
    FileSystem.FileSystem | HttpClient.HttpClient | Path.Path
  > {
    return Effect.gen(function* () {
      const listingUrlsByApp = yield* Effect.forEach(
        readinessContext.apps.filter((appDescriptor) => appDescriptor.bundleId !== undefined),
        collectListingUrls,
        { concurrency: 'unbounded' },
      );
      const listingUrls = listingUrlsByApp.flat();
      if (listingUrls.length === 0) return { state: 'omitted' };
      const appFindings = yield* Effect.forEach(
        listingUrls,
        ({ app, field, url }): Effect.Effect<AppReadiness, unknown, HttpClient.HttpClient> =>
          Effect.gen(function* () {
            const httpStatus = yield* requestListingUrlStatus(url);
            if (httpStatus >= 200 && httpStatus < 300) {
              return {
                app,
                identifier: url,
                status: 'ok',
                detail: `${field} URL live (HTTP ${httpStatus})`,
              };
            }
            return {
              app,
              identifier: url,
              status: 'blocker',
              detail: `${field} URL returned HTTP ${httpStatus}`,
              hint: "App Review rejects a listing whose URL doesn't resolve - fix or replace it before submitting",
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: appFindings };
    });
  },
} satisfies ReadinessProbe;
