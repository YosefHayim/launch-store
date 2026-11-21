import { describe, expect, test } from 'vitest';
import type { DiscoveredApp } from '../types/portfolio.js';
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
} from './portfolioLogic.js';

const createApp = (overrides: Partial<DiscoveredApp>): DiscoveredApp => ({
  key: 'ios-1',
  platform: 'ios',
  storeId: '1',
  name: 'Cal Friend AI',
  bundleId: 'com.jts.calfriend',
  packageName: null,
  accountKeyId: 'KEY1',
  accountLabel: 'yosef',
  ...overrides,
});

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

describe('createIosAppKey', () => {
  test('prefixes the store id with ios', () => {
    expect(createIosAppKey('42')).toBe('ios-42');
  });
});

describe('createAndroidAppKey', () => {
  test('prefixes the package name with android', () => {
    expect(createAndroidAppKey('com.a.b')).toBe('android-com.a.b');
  });
});

describe('mergeDiscoveredApps', () => {
  test('keeps the first account when two accounts see the same app key', () => {
    const secondSeen = createApp({ accountLabel: 'other' });

    const merged = mergeDiscoveredApps([[IOS_APP], [secondSeen, ANDROID_APP]]);

    expect(merged.map((app) => app.accountLabel)).toEqual(['yosef', 'google-play']);
  });

  test('returns an empty list for no sources', () => {
    expect(mergeDiscoveredApps([])).toEqual([]);
  });
});

describe('keepCachedAppsOfFailedAccounts', () => {
  test('keeps cached apps of a failed account and drops cached apps of an account that answered', () => {
    const cachedApps = [IOS_APP, ANDROID_APP];

    const kept = keepCachedAppsOfFailedAccounts([], cachedApps, ['yosef']);

    expect(kept).toEqual([IOS_APP]);
  });

  test('prefers the fresh app over the cached copy', () => {
    const fresh = createApp({ name: 'Renamed' });

    const kept = keepCachedAppsOfFailedAccounts([fresh], [IOS_APP], ['yosef']);

    expect(kept).toEqual([fresh]);
  });
});

describe('joinTags', () => {
  test('gives untagged apps null owner and property', () => {
    const joined = joinTags([IOS_APP], []);

    expect(joined[0]).toMatchObject({ owner: null, ga4PropertyId: null });
  });

  test('copies the tag of a tagged app', () => {
    const joined = joinTags([IOS_APP], [{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: '99' }]);

    expect(joined[0]).toMatchObject({ owner: 'mine', ga4PropertyId: '99' });
  });
});

describe('findAppsByName', () => {
  const apps = [IOS_APP, ANDROID_APP];

  test('matches the name without case', () => {
    expect(findAppsByName(apps, 'cal FRIEND')).toEqual([IOS_APP]);
  });

  test('matches the bundle id', () => {
    expect(findAppsByName(apps, 'jts.calfriend')).toEqual([IOS_APP]);
  });

  test('matches the package name', () => {
    expect(findAppsByName(apps, 'jts.fit')).toEqual([ANDROID_APP]);
  });

  test('returns nothing when the query is empty or blank', () => {
    expect(findAppsByName(apps, '   ')).toEqual([]);
  });

  test('returns nothing when no app matches', () => {
    expect(findAppsByName(apps, 'zzz')).toEqual([]);
  });

  test('returns many apps when many match', () => {
    expect(findAppsByName(apps, 'jts')).toEqual(apps);
  });
});

describe('findAppsByAccount', () => {
  test('matches the account label without case', () => {
    expect(findAppsByAccount([IOS_APP, ANDROID_APP], ' Google-Play ')).toEqual([ANDROID_APP]);
  });
});

describe('filterPortfolioApps', () => {
  const mineIos = { ...IOS_APP, owner: 'mine' as const, ga4PropertyId: null };
  const clientAndroid = { ...ANDROID_APP, owner: 'client' as const, ga4PropertyId: null };
  const apps = [mineIos, clientAndroid];

  test('keeps everything with no filter', () => {
    expect(filterPortfolioApps(apps, { platform: null, owner: null })).toEqual(apps);
  });

  test('filters by platform', () => {
    expect(filterPortfolioApps(apps, { platform: 'android', owner: null })).toEqual([
      clientAndroid,
    ]);
  });

  test('filters by owner', () => {
    expect(filterPortfolioApps(apps, { platform: null, owner: 'mine' })).toEqual([mineIos]);
  });

  test('combines platform and owner', () => {
    expect(filterPortfolioApps(apps, { platform: 'ios', owner: 'client' })).toEqual([]);
  });
});

describe('applyTagChange', () => {
  test('adds a tag for an untagged app', () => {
    const tags = applyTagChange([], ['ios-1'], { owner: 'mine', ga4PropertyId: null });

    expect(tags).toEqual([{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }]);
  });

  test('keeps the current owner when the change has none', () => {
    const current = [{ appKey: 'ios-1', owner: 'client' as const, ga4PropertyId: null }];

    const tags = applyTagChange(current, ['ios-1'], { owner: null, ga4PropertyId: '7' });

    expect(tags).toEqual([{ appKey: 'ios-1', owner: 'client', ga4PropertyId: '7' }]);
  });

  test('keeps the current property when the change has none and leaves other apps alone', () => {
    const current = [
      { appKey: 'ios-1', owner: null, ga4PropertyId: '7' },
      { appKey: 'ios-2', owner: 'client' as const, ga4PropertyId: null },
    ];

    const tags = applyTagChange(current, ['ios-1'], { owner: 'mine', ga4PropertyId: null });

    expect(tags).toEqual([
      { appKey: 'ios-2', owner: 'client', ga4PropertyId: null },
      { appKey: 'ios-1', owner: 'mine', ga4PropertyId: '7' },
    ]);
  });
});

describe('applyTagChangeToApp', () => {
  const TAGGED_APP = { ...IOS_APP, owner: 'client' as const, ga4PropertyId: '7' };

  test('replaces the owner and the property the change gives', () => {
    const changed = applyTagChangeToApp(TAGGED_APP, { owner: 'mine', ga4PropertyId: '9' });

    expect(changed).toMatchObject({ owner: 'mine', ga4PropertyId: '9' });
  });

  test('keeps the owner and the property the change leaves out', () => {
    const changed = applyTagChangeToApp(TAGGED_APP, { owner: null, ga4PropertyId: null });

    expect(changed).toMatchObject({ owner: 'client', ga4PropertyId: '7' });
  });
});
