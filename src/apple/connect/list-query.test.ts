import { describe, expect, it } from 'vitest';
import { APPLE_PAGE_LIMIT, applyAppleListQuery } from './list-query.ts';

function describeApplyAppleListQuery() {
  function keepsThePathWhenNoCallerQueryIsGiven() {
    const path = applyAppleListQuery(
      '/apps?fields[apps]=name,bundleId&limit=200',
      null,
      APPLE_PAGE_LIMIT,
    );

    expect(path).toBe('/apps?fields[apps]=name,bundleId&limit=200');
  }

  it('keeps the path when no caller query is given', keepsThePathWhenNoCallerQueryIsGiven);

  function usesTheCallerLimitAndAppendsTheCallerKeys() {
    const path = applyAppleListQuery(
      '/apps?fields[apps]=name&limit=200',
      { limit: 10, 'filter[name]': 'Launch' },
      APPLE_PAGE_LIMIT,
    );

    expect(path).toBe('/apps?fields[apps]=name&limit=10&filter[name]=Launch');
  }

  it(
    'uses the caller limit and appends the caller keys',
    usesTheCallerLimitAndAppendsTheCallerKeys,
  );

  function clampsThePageLimitToThatRequest() {
    const aboveTheMax = applyAppleListQuery('/devices?limit=200', { limit: 500 }, APPLE_PAGE_LIMIT);
    const belowTheMin = applyAppleListQuery('/devices?limit=200', { limit: -4 }, APPLE_PAGE_LIMIT);
    const pricePoints = applyAppleListQuery(
      '/apps/app1/appPricePoints?filter[territory]=USA&limit=8000',
      null,
      APPLE_PAGE_LIMIT,
    );

    expect(aboveTheMax).toBe('/devices?limit=200');
    expect(belowTheMin).toBe('/devices?limit=0');
    expect(pricePoints).toBe('/apps/app1/appPricePoints?filter[territory]=USA&limit=200');
  }

  it('clamps the page limit to that request', clampsThePageLimitToThatRequest);

  function clampsAnIncludedResourceLimitToFifty() {
    const path = applyAppleListQuery(
      '/apps?fields[apps]=name&limit=200',
      { 'limit[builds]': 90 },
      APPLE_PAGE_LIMIT,
    );

    expect(path).toBe('/apps?fields[apps]=name&limit=200&limit[builds]=50');
  }

  it('clamps an included resource limit to fifty', clampsAnIncludedResourceLimitToFifty);

  function replacesAKeyThePathAlreadyHas() {
    const path = applyAppleListQuery(
      '/apps/app1/appStoreVersions?filter[platform]=IOS&limit=50',
      { 'filter[platform]': 'MAC_OS', limit: 20 },
      APPLE_PAGE_LIMIT,
    );

    expect(path).toBe('/apps/app1/appStoreVersions?filter[platform]=MAC_OS&limit=20');
  }

  it('replaces a key the path already has', replacesAKeyThePathAlreadyHas);
}

describe('applyAppleListQuery', describeApplyAppleListQuery);
