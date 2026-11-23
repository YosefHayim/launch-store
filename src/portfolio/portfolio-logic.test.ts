import { describe, expect, test } from 'vitest';
import type { DiscoveredApp } from '../types/portfolio.ts';
import {
  applyTagChange,
  applyTagChangeToApp,
  createAndroidAppKey,
  createIosAppKey,
  filterPortfolioApps,
  findAppsByAccount,
  findAppsByName,
  joinTags,
  keepCachedAppsOfFailedAccounts,
  mergeDiscoveredApps,
} from './portfolio-logic.ts';

function createApp(overrides: Partial<DiscoveredApp>): DiscoveredApp {
  return {
    key: 'ios-1',
    platform: 'ios',
    storeId: '1',
    name: 'Cal Friend AI',
    bundleId: 'com.jts.calfriend',
    packageName: null,
    accountKeyId: 'KEY1',
    accountLabel: 'yosef',
    ...overrides,
  };
}

const IOS_APP = createApp({});
const ANDROID_APP = createApp({
  key: 'android-com.jts.fit',
  platform: 'android',
  storeId: 'com.jts.fit',
  name: 'Fit Tracker',
  bundleId: null,
  packageName: 'com.jts.fit',
  accountKeyId: null,
  accountLabel: 'google-play',
});
function describeCreateIosAppKey() {
  function prefixesTheStoreIdWithIos() {
    const iosAppKey = createIosAppKey('42');
    expect(iosAppKey).toBe('ios-42');
  }

  test('prefixes the store id with ios', prefixesTheStoreIdWithIos);
}

describe('createIosAppKey', describeCreateIosAppKey);
function describeCreateAndroidAppKey() {
  function prefixesThePackageNameWithAndroid() {
    const androidAppKey = createAndroidAppKey('com.a.b');
    expect(androidAppKey).toBe('android-com.a.b');
  }

  test('prefixes the package name with android', prefixesThePackageNameWithAndroid);
}

describe('createAndroidAppKey', describeCreateAndroidAppKey);
function describeMergeDiscoveredApps() {
  function keepsTheFirstAccountWhenTwoAccountsSeeTheSameAppKey() {
    const secondSeen = createApp({ accountLabel: 'other' });

    const merged = mergeDiscoveredApps([[IOS_APP], [secondSeen, ANDROID_APP]]);

    function readAccountLabel(app: DiscoveredApp) {
      return app.accountLabel;
    }

    expect(merged.map(readAccountLabel)).toEqual(['yosef', 'google-play']);
  }

  test(
    'keeps the first account when two accounts see the same app key',
    keepsTheFirstAccountWhenTwoAccountsSeeTheSameAppKey,
  );

  function returnsAnEmptyListForNoSources() {
    const discoveredApps = mergeDiscoveredApps([]);
    expect(discoveredApps).toEqual([]);
  }

  test('returns an empty list for no sources', returnsAnEmptyListForNoSources);
}

describe('mergeDiscoveredApps', describeMergeDiscoveredApps);
function describeKeepCachedAppsOfFailedAccounts() {
  function keepsCachedAppsOfAFailedAccountAndDropsCachedAppsOfAnAccountThatAnswered() {
    const cachedApps = [IOS_APP, ANDROID_APP];

    const kept = keepCachedAppsOfFailedAccounts([], cachedApps, ['yosef']);

    expect(kept).toEqual([IOS_APP]);
  }

  test(
    'keeps cached apps of a failed account and drops cached apps of an account that answered',
    keepsCachedAppsOfAFailedAccountAndDropsCachedAppsOfAnAccountThatAnswered,
  );

  function prefersTheFreshAppOverTheCachedCopy() {
    const fresh = createApp({ name: 'Renamed' });

    const kept = keepCachedAppsOfFailedAccounts([fresh], [IOS_APP], ['yosef']);

    expect(kept).toEqual([fresh]);
  }

  test('prefers the fresh app over the cached copy', prefersTheFreshAppOverTheCachedCopy);
}

describe('keepCachedAppsOfFailedAccounts', describeKeepCachedAppsOfFailedAccounts);
function describeJoinTags() {
  function givesUntaggedAppsNullOwnerAndProperty() {
    const joined = joinTags([IOS_APP], []);

    expect(joined[0]).toMatchObject({ owner: null, ga4PropertyId: null });
  }

  test('gives untagged apps null owner and property', givesUntaggedAppsNullOwnerAndProperty);

  function copiesTheTagOfATaggedApp() {
    const joined = joinTags([IOS_APP], [{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: '99' }]);

    expect(joined[0]).toMatchObject({ owner: 'mine', ga4PropertyId: '99' });
  }

  test('copies the tag of a tagged app', copiesTheTagOfATaggedApp);
}

describe('joinTags', describeJoinTags);
function describeFindAppsByName() {
  const apps = [IOS_APP, ANDROID_APP];

  function matchesTheNameWithoutCase() {
    const appsByName = findAppsByName(apps, 'cal FRIEND');
    expect(appsByName).toEqual([IOS_APP]);
  }

  test('matches the name without case', matchesTheNameWithoutCase);

  function matchesTheBundleId() {
    const appsByName = findAppsByName(apps, 'jts.calfriend');
    expect(appsByName).toEqual([IOS_APP]);
  }

  test('matches the bundle id', matchesTheBundleId);

  function matchesThePackageName() {
    const appsByName = findAppsByName(apps, 'jts.fit');
    expect(appsByName).toEqual([ANDROID_APP]);
  }

  test('matches the package name', matchesThePackageName);

  function returnsNothingWhenTheQueryIsEmptyOrBlank() {
    const appsByName = findAppsByName(apps, '   ');
    expect(appsByName).toEqual([]);
  }

  test(
    'returns nothing when the query is empty or blank',
    returnsNothingWhenTheQueryIsEmptyOrBlank,
  );

  function returnsNothingWhenNoAppMatches() {
    const appsByName = findAppsByName(apps, 'zzz');
    expect(appsByName).toEqual([]);
  }

  test('returns nothing when no app matches', returnsNothingWhenNoAppMatches);

  function returnsManyAppsWhenManyPiece() {
    const appsByName = findAppsByName(apps, 'jts');
    expect(appsByName).toEqual(apps);
  }

  test('returns many apps when many match', returnsManyAppsWhenManyPiece);
}

describe('findAppsByName', describeFindAppsByName);
function describeFindAppsByAccount() {
  function matchesTheAccountLabelWithoutCase() {
    const appsByAccount = findAppsByAccount([IOS_APP, ANDROID_APP], ' Google-Play ');
    expect(appsByAccount).toEqual([ANDROID_APP]);
  }

  test('matches the account label without case', matchesTheAccountLabelWithoutCase);
}

describe('findAppsByAccount', describeFindAppsByAccount);
function describeFilterPortfolioApps() {
  const mineIos = { ...IOS_APP, owner: 'mine' as const, ga4PropertyId: null };
  const clientAndroid = { ...ANDROID_APP, owner: 'client' as const, ga4PropertyId: null };
  const apps = [mineIos, clientAndroid];

  function keepsEverythingWithNoFilter() {
    expect(filterPortfolioApps(apps, { platform: null, owner: null })).toEqual(apps);
  }

  test('keeps everything with no filter', keepsEverythingWithNoFilter);

  function filtersByPlatform() {
    expect(filterPortfolioApps(apps, { platform: 'android', owner: null })).toEqual([
      clientAndroid,
    ]);
  }

  test('filters by platform', filtersByPlatform);

  function filtersByOwner() {
    expect(filterPortfolioApps(apps, { platform: null, owner: 'mine' })).toEqual([mineIos]);
  }

  test('filters by owner', filtersByOwner);

  function combinesPlatformAndOwner() {
    expect(filterPortfolioApps(apps, { platform: 'ios', owner: 'client' })).toEqual([]);
  }

  test('combines platform and owner', combinesPlatformAndOwner);
}

describe('filterPortfolioApps', describeFilterPortfolioApps);
function describeApplyTagChange() {
  function addsATagForAnUntaggedApp() {
    const tags = applyTagChange([], ['ios-1'], { owner: 'mine', ga4PropertyId: null });

    expect(tags).toEqual([{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }]);
  }

  test('adds a tag for an untagged app', addsATagForAnUntaggedApp);

  function keepsTheCurrentOwnerWhenTheChangeHasNone() {
    const current = [{ appKey: 'ios-1', owner: 'client' as const, ga4PropertyId: null }];

    const tags = applyTagChange(current, ['ios-1'], { owner: null, ga4PropertyId: '7' });

    expect(tags).toEqual([{ appKey: 'ios-1', owner: 'client', ga4PropertyId: '7' }]);
  }

  test(
    'keeps the current owner when the change has none',
    keepsTheCurrentOwnerWhenTheChangeHasNone,
  );

  function keepsTheCurrentPropertyWhenTheChangeHasNoneAndLeavesOtherAppsAlone() {
    const current = [
      { appKey: 'ios-1', owner: null, ga4PropertyId: '7' },
      { appKey: 'ios-2', owner: 'client' as const, ga4PropertyId: null },
    ];

    const tags = applyTagChange(current, ['ios-1'], { owner: 'mine', ga4PropertyId: null });

    expect(tags).toEqual([
      { appKey: 'ios-2', owner: 'client', ga4PropertyId: null },
      { appKey: 'ios-1', owner: 'mine', ga4PropertyId: '7' },
    ]);
  }

  test(
    'keeps the current property when the change has none and leaves other apps alone',
    keepsTheCurrentPropertyWhenTheChangeHasNoneAndLeavesOtherAppsAlone,
  );
}

describe('applyTagChange', describeApplyTagChange);
function describeApplyTagChangeToApp() {
  const TAGGED_APP = { ...IOS_APP, owner: 'client' as const, ga4PropertyId: '7' };

  function replacesTheOwnerAndThePropertyTheChangeGives() {
    const changed = applyTagChangeToApp(TAGGED_APP, { owner: 'mine', ga4PropertyId: '9' });

    expect(changed).toMatchObject({ owner: 'mine', ga4PropertyId: '9' });
  }

  test(
    'replaces the owner and the property the change gives',
    replacesTheOwnerAndThePropertyTheChangeGives,
  );

  function keepsTheOwnerAndThePropertyTheChangeLeavesOut() {
    const changed = applyTagChangeToApp(TAGGED_APP, { owner: null, ga4PropertyId: null });

    expect(changed).toMatchObject({ owner: 'client', ga4PropertyId: '7' });
  }

  test(
    'keeps the owner and the property the change leaves out',
    keepsTheOwnerAndThePropertyTheChangeLeavesOut,
  );
}

describe('applyTagChangeToApp', describeApplyTagChangeToApp);
