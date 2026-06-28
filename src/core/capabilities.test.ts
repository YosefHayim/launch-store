import { describe, expect, it } from 'vitest';
import {
  APP_GROUP_PORTAL_URL,
  CAPABILITY_TO_ENTITLEMENT,
  appGroupContainers,
  appGroupPortalNotice,
  entitlementForCapability,
  isCapabilityEntitlement,
  isCapabilityType,
  mapEntitlementsToCapabilities,
  staleProfileCapabilities,
} from './capabilities.js';

describe('mapEntitlementsToCapabilities', () => {
  it('maps known entitlement keys to their capability types', () => {
    const { enable } = mapEntitlementsToCapabilities({
      'aps-environment': 'production',
      'com.apple.developer.applesignin': ['Default'],
      'com.apple.security.application-groups': ['group.com.acme'],
    });
    // ASCII order: 'L' (76) < '_' (95), so APPLE_ID_AUTH sorts before APP_GROUPS.
    expect(enable).toEqual(['APPLE_ID_AUTH', 'APP_GROUPS', 'PUSH_NOTIFICATIONS']);
  });

  it('collapses the several iCloud entitlements onto a single ICLOUD capability', () => {
    const { enable } = mapEntitlementsToCapabilities({
      'com.apple.developer.icloud-container-identifiers': ['iCloud.com.acme'],
      'com.apple.developer.icloud-services': ['CloudKit'],
      'com.apple.developer.ubiquity-kvstore-identifier': 'X.com.acme',
    });
    expect(enable).toEqual(['ICLOUD']);
  });

  it('ignores signing-plumbing entitlements without flagging them as unmapped', () => {
    const { enable, unmapped } = mapEntitlementsToCapabilities({
      'application-identifier': 'ABCDE.com.acme',
      'com.apple.developer.team-identifier': 'ABCDE',
      'keychain-access-groups': ['ABCDE.com.acme'],
      'get-task-allow': true,
    });
    expect(enable).toEqual([]);
    expect(unmapped).toEqual([]);
  });

  it('surfaces a genuinely unrecognized entitlement key as unmapped', () => {
    const { enable, unmapped } = mapEntitlementsToCapabilities({
      'com.apple.developer.healthkit': true,
      'com.apple.developer.some-future-thing': true,
    });
    expect(enable).toEqual(['HEALTHKIT']);
    expect(unmapped).toEqual(['com.apple.developer.some-future-thing']);
  });

  it('returns empty results for missing or empty entitlements', () => {
    expect(mapEntitlementsToCapabilities(undefined)).toEqual({ enable: [], unmapped: [] });
    expect(mapEntitlementsToCapabilities({})).toEqual({ enable: [], unmapped: [] });
  });

  it('returns a stably-sorted enable list regardless of key order', () => {
    const a = mapEntitlementsToCapabilities({
      'com.apple.developer.siri': true,
      'aps-environment': 'production',
      'com.apple.developer.homekit': true,
    });
    const b = mapEntitlementsToCapabilities({
      'com.apple.developer.homekit': true,
      'com.apple.developer.siri': true,
      'aps-environment': 'production',
    });
    expect(a.enable).toEqual(b.enable);
    expect(a.enable).toEqual(['HOMEKIT', 'PUSH_NOTIFICATIONS', 'SIRIKIT']);
  });
});

describe('entitlementForCapability (reverse map for `launch adopt`)', () => {
  it('resolves a capability type to its canonical entitlement key', () => {
    expect(entitlementForCapability('APP_GROUPS')).toBe('com.apple.security.application-groups');
    expect(entitlementForCapability('PUSH_NOTIFICATIONS')).toBe('aps-environment');
  });

  it('returns undefined for an always-on capability that carries no entitlement', () => {
    expect(entitlementForCapability('IN_APP_PURCHASE')).toBeUndefined();
    expect(entitlementForCapability('GAME_CENTER')).toBeUndefined();
  });

  it('every reverse-map key round-trips back to a real capability entitlement', () => {
    for (const key of Object.values(CAPABILITY_TO_ENTITLEMENT)) {
      expect(isCapabilityEntitlement(key)).toBe(true);
    }
  });

  it('distinguishes capability entitlements from signing-plumbing keys', () => {
    expect(isCapabilityEntitlement('aps-environment')).toBe(true);
    expect(isCapabilityEntitlement('application-identifier')).toBe(false);
  });
});

describe('appGroupContainers', () => {
  it('reads the group ids from the entitlement array', () => {
    expect(
      appGroupContainers({
        'com.apple.security.application-groups': ['group.com.acme', 'group.com.acme.shared'],
      }),
    ).toEqual(['group.com.acme', 'group.com.acme.shared']);
  });

  it('tolerates a lone string value and drops non-string members of a hand-edited config', () => {
    expect(
      appGroupContainers({ 'com.apple.security.application-groups': 'group.com.acme' }),
    ).toEqual(['group.com.acme']);
    expect(
      appGroupContainers({
        'com.apple.security.application-groups': ['group.com.acme', 42, '', null],
      }),
    ).toEqual(['group.com.acme']);
  });

  it('returns an empty list when no App Groups entitlement is present', () => {
    expect(appGroupContainers(undefined)).toEqual([]);
    expect(appGroupContainers({ 'aps-environment': 'production' })).toEqual([]);
  });
});

describe('appGroupPortalNotice', () => {
  it('returns null when the app declares no App Group containers', () => {
    expect(appGroupPortalNotice([])).toBeNull();
  });

  it('names the groups, the portal URL, and the exit-65 failure for a single group', () => {
    const notice = appGroupPortalNotice(['group.com.acme']);
    expect(notice).toContain('"group.com.acme"');
    expect(notice).toContain('App Group');
    expect(notice).toContain(APP_GROUP_PORTAL_URL);
    expect(notice).toContain('exit 65');
  });

  it('pluralizes when several groups are declared', () => {
    const notice = appGroupPortalNotice(['group.com.acme', 'group.com.acme.shared']);
    expect(notice).toContain('App Groups');
    expect(notice).toContain('"group.com.acme"');
    expect(notice).toContain('"group.com.acme.shared"');
  });
});

describe('isCapabilityType', () => {
  it('recognizes a known capability wire string and rejects an unknown one', () => {
    expect(isCapabilityType('APP_GROUPS')).toBe(true);
    expect(isCapabilityType('PUSH_NOTIFICATIONS')).toBe(true);
    expect(isCapabilityType('NOT_A_REAL_CAPABILITY')).toBe(false);
  });
});

describe('staleProfileCapabilities — regenerate vs reuse decision (#261)', () => {
  it('flags a profile minted before App Groups was enabled (regenerate)', () => {
    // App ID now has Push + App Groups; the cached profile predates App Groups (only Push entitlement).
    const missing = staleProfileCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS'], {
      'aps-environment': 'production',
    });
    expect(missing).toEqual(['APP_GROUPS']);
  });

  it('reuses when the profile already covers every enabled capability (no change)', () => {
    expect(
      staleProfileCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS'], {
        'aps-environment': 'production',
        'com.apple.security.application-groups': ['group.com.acme'],
      }),
    ).toEqual([]);
  });

  it('ignores always-on, value-less capabilities that never live in a profile', () => {
    // IN_APP_PURCHASE / GAME_CENTER carry no entitlement, so an empty profile is NOT stale against them.
    expect(staleProfileCapabilities(['IN_APP_PURCHASE', 'GAME_CENTER'], {})).toEqual([]);
  });

  it('cannot judge staleness when the profile entitlements are unreadable (reuse stands)', () => {
    expect(staleProfileCapabilities(['APP_GROUPS'], null)).toEqual([]);
  });
});
