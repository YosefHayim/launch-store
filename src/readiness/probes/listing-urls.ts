import { join } from 'node:path';
import { errorMessage } from '@/services/platform/error-message.js';
import { loadStoreConfig, type AppleStoreConfig } from '@/store/shared/store-config.js';
import type { AppDescriptor } from '@/types/app.js';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { OMITTED_PROBE } from './credentials-skip.ts';

type ListingUrl = {
  app: string;
  field: string;
  url: string;
};

function hasBundleId(app: AppDescriptor): app is AppDescriptor & { bundleId: string } {
  return app.bundleId != null;
}

function isSuccessStatus(httpStatus: number): boolean {
  const isBelowSuccess = httpStatus < 200;

  if (isBelowSuccess) {
    return false;
  }

  const isAboveSuccess = httpStatus > 299;

  if (isAboveSuccess) {
    return false;
  }

  return true;
}

async function loadAppleListing(appDirectory: string): Promise<AppleStoreConfig | null> {
  const storeConfigPath = join(appDirectory, 'store.config.json');

  try {
    const storeConfig = await loadStoreConfig(storeConfigPath);
    const appleListing = storeConfig.apple;

    const isMissing = appleListing == null;

    if (isMissing) {
      return null;
    }

    return appleListing;
  } catch (cause) {
    const isUnreadable = errorMessage(cause) != '';

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

async function collectListingUrls(appDescriptor: AppDescriptor): Promise<ListingUrl[]> {
  const appleListing = await loadAppleListing(appDescriptor.dir);

  const isMissing = appleListing == null;

  if (isMissing) {
    return [];
  }

  const seenUrls = new Set<string>();
  const listingUrls: ListingUrl[] = [];

  for (const listingLocalization of Object.values(appleListing.info)) {
    const fields: [string, string | undefined][] = [
      ['privacy-policy', listingLocalization.privacyPolicyUrl],
      ['support', listingLocalization.supportUrl],
      ['marketing', listingLocalization.marketingUrl],
    ];

    for (const [field, url] of fields) {
      const isUnset = url == null;

      if (isUnset) {
        continue;
      }

      const alreadySeen = seenUrls.has(url);

      if (alreadySeen) {
        continue;
      }

      seenUrls.add(url);
      listingUrls.push({ app: appDescriptor.name, field, url });
    }
  }

  return listingUrls;
}

async function requestListingUrlStatus(listingUrl: string): Promise<number> {
  const listingReply = await fetch(listingUrl, { signal: AbortSignal.timeout(5000) });

  return listingReply.status;
}

async function readListingUrl(listingUrl: ListingUrl): Promise<AppReadiness> {
  const httpStatus = await requestListingUrlStatus(listingUrl.url);

  const isLive = isSuccessStatus(httpStatus);

  if (isLive) {
    return {
      app: listingUrl.app,
      identifier: listingUrl.url,
      status: 'ok',
      detail: `${listingUrl.field} URL live (HTTP ${httpStatus})`,
    };
  }

  return {
    app: listingUrl.app,
    identifier: listingUrl.url,
    status: 'blocker',
    detail: `${listingUrl.field} URL returned HTTP ${httpStatus}`,
    hint: "App Review rejects a listing whose URL doesn't resolve - fix or replace it before submitting",
  };
}

/** Check that declared iOS listing URLs return successful HTTP statuses. */
export const listingUrlsProbe = {
  id: 'apple-listing-urls',
  title: 'iOS listing URLs resolve',
  store: 'appstore',
  categories: ['listing', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const scopedApps = readinessContext.apps.filter(hasBundleId);
    const listingUrlsByApp = await Promise.all(scopedApps.map(collectListingUrls));
    const listingUrls = listingUrlsByApp.flat();

    const isNothingDeclared = listingUrls.length == 0;

    if (isNothingDeclared) {
      return OMITTED_PROBE;
    }

    const findings = await Promise.all(listingUrls.map(readListingUrl));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
