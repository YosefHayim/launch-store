/**
 * Probe: do each iOS app's declared **listing URLs** (privacy-policy, support, marketing) actually resolve?
 * App Review rejects a submission whose privacy-policy or support URL 404s or times out — the reviewer
 * can't reach it any more than this probe can. Catching a dead link before submission turns a multi-day
 * rejection round-trip into one line now.
 *
 * The only probe that crosses a **network** boundary, so it follows the readiness contract strictly: a URL
 * that answers with a non-2xx status is an expected "not live" *finding* (a blocker); a fetch that can't
 * complete at all (DNS failure, TLS error, timeout) is an *unexpected* failure that propagates, so the
 * orchestrator records the probe as `errored` rather than silently certifying. Every request carries a
 * hard timeout, follows redirects, and sends no credentials (these are public pages).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
  AppDescriptor,
} from '../../types/index.js';
import { loadStoreConfig, type AppleStoreConfig } from '../../store/storeConfig.js';

/** How long to wait for a listing URL before treating the fetch as failed. Bounded so audit never hangs. */
export const URL_LIVENESS_TIMEOUT_MS = 5000;

/** One declared listing URL to check, carried with the app it belongs to. */
interface ListingUrl {
  /** The owning app's handle. */
  app: string;
  /** The listing field the URL came from (`privacy-policy` / `support` / `marketing`), for the detail line. */
  field: string;
  /** The URL to probe. */
  url: string;
}

/**
 * Read an app's `store.config.json` Apple listing when present and parseable.
 *
 * @param appDir - App root that may contain `store.config.json`.
 * @returns An Effect that succeeds with Apple listing config or undefined when absent/malformed.
 */
function loadAppleListing(appDir: string): Effect.Effect<AppleStoreConfig | undefined> {
  const path = join(appDir, 'store.config.json');
  return Effect.gen(function* () {
    const exists = yield* Effect.sync(() => existsSync(path));
    if (!exists) return undefined;
    return yield* Effect.try({
      try: () => loadStoreConfig(path).apple,
      catch: (loadFailure) => loadFailure,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
  });
}

/**
 * Collect an app's unique declared listing URLs across all locales.
 *
 * @param app - App descriptor whose local store config should be read.
 * @returns An Effect that succeeds with de-duplicated listing URLs for the app.
 */
function collectUrls(app: AppDescriptor): Effect.Effect<ListingUrl[]> {
  return Effect.gen(function* () {
    const listing = yield* loadAppleListing(app.dir);
    if (!listing) return [];
    const seen = new Set<string>();
    const urls: ListingUrl[] = [];
    for (const info of Object.values(listing.info)) {
      const fields: [string, string | undefined][] = [
        ['privacy-policy', info.privacyPolicyUrl],
        ['support', info.supportUrl],
        ['marketing', info.marketingUrl],
      ];
      for (const [field, url] of fields) {
        if (url && !seen.has(url)) {
          seen.add(url);
          urls.push({ app: app.name, field, url });
        }
      }
    }
    return urls;
  });
}

/**
 * GET a URL and return its HTTP status.
 *
 * @param url - Public listing URL to probe.
 * @returns An Effect that succeeds with the HTTP status or fails when fetch cannot complete.
 */
function fetchStatus(url: string): Effect.Effect<number, unknown> {
  return Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(URL_LIVENESS_TIMEOUT_MS),
      }).then((response) => response.status),
    catch: (fetchFailure) => fetchFailure,
  });
}

/** The iOS listing-URL liveness readiness probe — a listing completeness check and a submit blocker. */
export const listingUrlsProbe = {
  id: 'apple-listing-urls',
  title: 'iOS listing URLs resolve',
  store: 'appstore',
  categories: ['listing', 'submit'],
  /**
   * Verify that declared iOS listing URLs respond with HTTP 2xx.
   *
   * @param readinessContext - Loaded config and selected apps for the readiness run.
   * @returns An Effect that succeeds with URL liveness findings or fails when a fetch cannot complete.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const urlsByApp = yield* Effect.forEach(
        readinessContext.apps.filter((app) => app.bundleId),
        collectUrls,
        { concurrency: 'unbounded' },
      );
      const urls = urlsByApp.flat();
      if (urls.length === 0) return { state: 'omitted' };

      // A fetch that can't complete (DNS/TLS/timeout) fails here and propagates → the orchestrator marks
      // the probe `errored`, never crashing — per the network-probe contract. A completed non-2xx is a finding.
      const results: AppReadiness[] = yield* Effect.forEach(
        urls,
        ({ app, field, url }) =>
          Effect.gen(function* () {
            const status = yield* fetchStatus(url);
            return status >= 200 && status < 300
              ? {
                  app,
                  identifier: url,
                  status: 'ok' as const,
                  detail: `${field} URL live (HTTP ${status})`,
                }
              : {
                  app,
                  identifier: url,
                  status: 'blocker' as const,
                  detail: `${field} URL returned HTTP ${status}`,
                  hint: "App Review rejects a listing whose URL doesn't resolve — fix or replace it before submitting",
                };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
