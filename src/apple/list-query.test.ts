import { describe, expect, it } from 'vitest';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, applyAppleReadQuery } from './list-query.ts';

function describeApplyAppleListQuery() {
  function addsTheDocumentedMaximumWhenTheCallerOmitsLimit() {
    const path = applyAppleListQuery('/apps?fields[apps]=name,bundleId', null, APPLE_PAGE_LIMIT);

    expect(path).toBe('/apps?fields[apps]=name,bundleId&limit=200');
  }

  it(
    'adds the documented maximum when the caller omits limit',
    addsTheDocumentedMaximumWhenTheCallerOmitsLimit,
  );

  function usesTheCallerLimitAndAppendsTheCallerKeys() {
    const path = applyAppleListQuery(
      '/apps?fields[apps]=name',
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
    const aboveTheMax = applyAppleListQuery('/devices', { limit: 500 }, APPLE_PAGE_LIMIT);
    const belowTheMin = applyAppleListQuery('/devices', { limit: -4 }, APPLE_PAGE_LIMIT);
    const pricePoints = applyAppleListQuery(
      '/apps/app1/appPricePoints?filter[territory]=USA',
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
      '/apps?fields[apps]=name',
      { 'limit[builds]': 90 },
      APPLE_PAGE_LIMIT,
    );

    expect(path).toBe('/apps?fields[apps]=name&limit[builds]=50&limit=200');
  }

  it('clamps an included resource limit to fifty', clampsAnIncludedResourceLimitToFifty);

  function replacesAKeyThePathAlreadyHas() {
    const path = applyAppleListQuery(
      '/apps/app1/appStoreVersions?filter[platform]=IOS',
      { 'filter[platform]': 'MAC_OS', limit: 20 },
      APPLE_PAGE_LIMIT,
    );

    expect(path).toBe('/apps/app1/appStoreVersions?filter[platform]=MAC_OS&limit=20');
  }

  it('replaces a key the path already has', replacesAKeyThePathAlreadyHas);

  function sendsTheDefaultFieldsWhenTheCallerOmitsThem() {
    const path = applyAppleListQuery('/apps/app1/appEvents', null, APPLE_PAGE_LIMIT, {
      'fields[appEvents]': 'referenceName,badge',
    });

    expect(path).toBe('/apps/app1/appEvents?fields[appEvents]=referenceName,badge&limit=200');
  }

  it(
    'sends the default fields when the caller omits them',
    sendsTheDefaultFieldsWhenTheCallerOmitsThem,
  );

  function replacesTheDefaultFieldsWhenTheCallerPassesThem() {
    const path = applyAppleListQuery(
      '/apps/app1/appEvents',
      { 'fields[appEvents]': 'referenceName' },
      APPLE_PAGE_LIMIT,
      { 'fields[appEvents]': 'referenceName,badge' },
    );

    expect(path).toBe('/apps/app1/appEvents?fields[appEvents]=referenceName&limit=200');
  }

  it(
    'replaces the default fields when the caller passes them',
    replacesTheDefaultFieldsWhenTheCallerPassesThem,
  );

  function dropsADefaultFieldWhenTheCallerPassesNull() {
    const path = applyAppleListQuery(
      '/apps/app1/appEvents',
      { 'fields[appEvents]': null },
      APPLE_PAGE_LIMIT,
      { 'fields[appEvents]': 'referenceName,badge', include: 'localizations' },
    );

    expect(path).toBe('/apps/app1/appEvents?include=localizations&limit=200');
  }

  it(
    'drops a default field when the caller passes null',
    dropsADefaultFieldWhenTheCallerPassesNull,
  );
}

function describeApplyAppleReadQuery() {
  function keepsTheOneRowLimitAndAppliesTheDefaultView() {
    const path = applyAppleReadQuery('/builds?filter[app]=app1&limit=1', null, {
      sort: '-version',
      'fields[builds]': 'version',
    });

    expect(path).toBe('/builds?filter[app]=app1&limit=1&sort=-version&fields[builds]=version');
  }

  it(
    'keeps the one-row limit and applies the default view',
    keepsTheOneRowLimitAndAppliesTheDefaultView,
  );

  function leavesAReadWithoutAPageLimit() {
    const path = applyAppleReadQuery('/bundleIds/bundle1/bundleIdCapabilities', null, {
      'fields[bundleIdCapabilities]': 'capabilityType,settings',
    });

    expect(path).toBe(
      '/bundleIds/bundle1/bundleIdCapabilities?fields[bundleIdCapabilities]=capabilityType,settings',
    );
  }

  it('leaves a read without a page limit', leavesAReadWithoutAPageLimit);
}

describe('applyAppleListQuery', describeApplyAppleListQuery);
describe('applyAppleReadQuery', describeApplyAppleReadQuery);
