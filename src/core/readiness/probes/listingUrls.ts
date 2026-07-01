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
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
  AppDescriptor,
} from '../../types.js';
import { loadStoreConfig, type AppleStoreConfig } from '../../storeConfig.js';

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

/** Read an app's `store.config.json` Apple listing, or undefined when absent/malformed (not this probe's job to flag). */
function loadAppleListing(appDir: string): AppleStoreConfig | undefined {
  const path = join(appDir, 'store.config.json');
  if (!existsSync(path)) return undefined;
  try {
    return loadStoreConfig(path).apple;
  } catch {
    return undefined;
  }
}

/** Collect an app's unique declared listing URLs across all locales (the same URL in many locales is checked once). */
function collectUrls(app: AppDescriptor): ListingUrl[] {
  const listing = loadAppleListing(app.dir);
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
}

/** GET a URL and return its HTTP status, following redirects, aborting after {@link URL_LIVENESS_TIMEOUT_MS}. */
async function fetchStatus(url: string): Promise<number> {
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(URL_LIVENESS_TIMEOUT_MS),
  });
  return response.status;
}

/** The iOS listing-URL liveness readiness probe — a listing completeness check and a submit blocker. */
export const listingUrlsProbe: ReadinessProbe = {
  id: 'apple-listing-urls',
  title: 'iOS listing URLs resolve',
  store: 'appstore',
  categories: ['listing', 'submit'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const urls = ctx.apps.filter((app) => app.bundleId).flatMap(collectUrls);
    if (urls.length === 0) return { state: 'omitted' };

    // A fetch that can't complete (DNS/TLS/timeout) throws here and propagates → the orchestrator marks
    // the probe `errored`, never crashing — per the network-probe contract. A completed non-2xx is a finding.
    const results: AppReadiness[] = await Promise.all(
      urls.map(async ({ app, field, url }) => {
        const status = await fetchStatus(url);
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
    );
    return { state: 'checked', apps: results };
  },
};
