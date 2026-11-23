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
} from './capabilities.ts';
function describeMapEntitlementsToCapabilities() {
  function mapsKnownEntitlementKeysToTheirCapabilityTypes() {
    const { enable } = mapEntitlementsToCapabilities({
      'aps-environment': 'production',
      'com.apple.developer.applesignin': ['Default'],
      'com.apple.security.application-groups': ['group.com.acme'],
    });

    // ASCII order: 'L' (76) < '_' (95), so APPLE_ID_AUTH sorts before APP_GROUPS.
    expect(enable).toEqual(['APPLE_ID_AUTH', 'APP_GROUPS', 'PUSH_NOTIFICATIONS']);
  }

  it(
    'maps known entitlement keys to their capability types',
    mapsKnownEntitlementKeysToTheirCapabilityTypes,
  );

  function collapsesTheSeveralICloudEntitlementsOntoASingleICLOUDCapability() {
    const { enable } = mapEntitlementsToCapabilities({
      'com.apple.developer.icloud-container-identifiers': ['iCloud.com.acme'],
      'com.apple.developer.icloud-services': ['CloudKit'],
      'com.apple.developer.ubiquity-kvstore-identifier': 'X.com.acme',
    });

    expect(enable).toEqual(['ICLOUD']);
  }

  it(
    'collapses the several iCloud entitlements onto a single ICLOUD capability',
    collapsesTheSeveralICloudEntitlementsOntoASingleICLOUDCapability,
  );

  function ignoresSigningPlumbingEntitlementsWithoutFlaggingThemAsUnmapped() {
    const { enable, unmapped } = mapEntitlementsToCapabilities({
      'application-identifier': 'ABCDE.com.acme',
      'com.apple.developer.team-identifier': 'ABCDE',
      'keychain-access-groups': ['ABCDE.com.acme'],
      'get-task-allow': true,
    });

    expect(enable).toEqual([]);
    expect(unmapped).toEqual([]);
  }

  it(
    'ignores signing-plumbing entitlements without flagging them as unmapped',
    ignoresSigningPlumbingEntitlementsWithoutFlaggingThemAsUnmapped,
  );

  function surfacesAGenuinelyUnrecognizedEntitlementKeyAsUnmapped() {
    const { enable, unmapped } = mapEntitlementsToCapabilities({
      'com.apple.developer.healthkit': true,
      'com.apple.developer.some-future-thing': true,
    });

    expect(enable).toEqual(['HEALTHKIT']);
    expect(unmapped).toEqual(['com.apple.developer.some-future-thing']);
  }

  it(
    'surfaces a genuinely unrecognized entitlement key as unmapped',
    surfacesAGenuinelyUnrecognizedEntitlementKeyAsUnmapped,
  );

  function returnsEmptyPieceForMissingOrEmptyEntitlements() {
    expect(mapEntitlementsToCapabilities(undefined)).toEqual({ enable: [], unmapped: [] });
    expect(mapEntitlementsToCapabilities({})).toEqual({ enable: [], unmapped: [] });
  }

  it(
    'returns empty results for missing or empty entitlements',
    returnsEmptyPieceForMissingOrEmptyEntitlements,
  );

  function returnsAStablySortedEnableListRegardlessOfKeyOrder() {
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
  }

  it(
    'returns a stably-sorted enable list regardless of key order',
    returnsAStablySortedEnableListRegardlessOfKeyOrder,
  );
}

describe('mapEntitlementsToCapabilities', describeMapEntitlementsToCapabilities);
function describeEntitlementForCapabilityReverseMapForLaunchStoreAdopt() {
  function resolvesACapabilityTypeToItsCanonicalEntitlementKey() {
    expect(entitlementForCapability('APP_GROUPS')).toBe('com.apple.security.application-groups');
    expect(entitlementForCapability('PUSH_NOTIFICATIONS')).toBe('aps-environment');
  }

  it(
    'resolves a capability type to its canonical entitlement key',
    resolvesACapabilityTypeToItsCanonicalEntitlementKey,
  );

  function returnsUndefinedForAnAlwaysOnCapabilityThatCarriesNoEntitlement() {
    expect(entitlementForCapability('IN_APP_PURCHASE')).toBeUndefined();
    expect(entitlementForCapability('GAME_CENTER')).toBeUndefined();
  }

  it(
    'returns undefined for an always-on capability that carries no entitlement',
    returnsUndefinedForAnAlwaysOnCapabilityThatCarriesNoEntitlement,
  );

  function everyReverseMapKeyRoundTripsBackToARealCapabilityEntitlement() {
    for (const key of Object.values(CAPABILITY_TO_ENTITLEMENT)) {
      expect(isCapabilityEntitlement(key)).toBe(true);
    }
  }

  it(
    'every reverse-map key round-trips back to a real capability entitlement',
    everyReverseMapKeyRoundTripsBackToARealCapabilityEntitlement,
  );

  function distinguishesCapabilityEntitlementsFromSigningPlumbingKeys() {
    expect(isCapabilityEntitlement('aps-environment')).toBe(true);
    expect(isCapabilityEntitlement('application-identifier')).toBe(false);
  }

  it(
    'distinguishes capability entitlements from signing-plumbing keys',
    distinguishesCapabilityEntitlementsFromSigningPlumbingKeys,
  );
}

describe(
  'entitlementForCapability (reverse map for `launch-store adopt`)',
  describeEntitlementForCapabilityReverseMapForLaunchStoreAdopt,
);
function describeAppGroupContainers() {
  function readsTheGroupIdsFromTheEntitlementArray() {
    expect(
      appGroupContainers({
        'com.apple.security.application-groups': ['group.com.acme', 'group.com.acme.shared'],
      }),
    ).toEqual(['group.com.acme', 'group.com.acme.shared']);
  }

  it('reads the group ids from the entitlement array', readsTheGroupIdsFromTheEntitlementArray);

  function toleratesALoneStringPieceAndDropsNonStringMembersOfAHandEditedPiece() {
    expect(
      appGroupContainers({ 'com.apple.security.application-groups': 'group.com.acme' }),
    ).toEqual(['group.com.acme']);
    expect(
      appGroupContainers({
        'com.apple.security.application-groups': ['group.com.acme', 42, '', null],
      }),
    ).toEqual(['group.com.acme']);
  }

  it(
    'tolerates a lone string value and drops non-string members of a hand-edited config',
    toleratesALoneStringPieceAndDropsNonStringMembersOfAHandEditedPiece,
  );

  function returnsAnEmptyListWhenNoAppGroupsEntitlementIsPresent() {
    expect(appGroupContainers(undefined)).toEqual([]);
    expect(appGroupContainers({ 'aps-environment': 'production' })).toEqual([]);
  }

  it(
    'returns an empty list when no App Groups entitlement is present',
    returnsAnEmptyListWhenNoAppGroupsEntitlementIsPresent,
  );
}

describe('appGroupContainers', describeAppGroupContainers);
function describeAppGroupPortalNotice() {
  function returnsNullWhenTheAppDeclaresNoAppGroupContainers() {
    expect(appGroupPortalNotice([])).toBeNull();
  }

  it(
    'returns null when the app declares no App Group containers',
    returnsNullWhenTheAppDeclaresNoAppGroupContainers,
  );

  function namesTheGroupsThePortalURLAndTheExit65FailureForASingleGroup() {
    const notice = appGroupPortalNotice(['group.com.acme']);

    expect(notice).toContain('"group.com.acme"');
    expect(notice).toContain('App Group');
    expect(notice).toContain(APP_GROUP_PORTAL_URL);
    expect(notice).toContain('exit 65');
  }

  it(
    'names the groups, the portal URL, and the exit-65 failure for a single group',
    namesTheGroupsThePortalURLAndTheExit65FailureForASingleGroup,
  );

  function pluralizesWhenSeveralGroupsAreDeclared() {
    const notice = appGroupPortalNotice(['group.com.acme', 'group.com.acme.shared']);
    expect(notice).toContain('App Groups');
    expect(notice).toContain('"group.com.acme"');
    expect(notice).toContain('"group.com.acme.shared"');
  }

  it('pluralizes when several groups are declared', pluralizesWhenSeveralGroupsAreDeclared);
}

describe('appGroupPortalNotice', describeAppGroupPortalNotice);
function describeIsCapabilityType() {
  function recognizesAKnownCapabilityWireStringAndRejectsAnUnknownOne() {
    expect(isCapabilityType('APP_GROUPS')).toBe(true);
    expect(isCapabilityType('PUSH_NOTIFICATIONS')).toBe(true);
    expect(isCapabilityType('NOT_A_REAL_CAPABILITY')).toBe(false);
  }

  it(
    'recognizes a known capability wire string and rejects an unknown one',
    recognizesAKnownCapabilityWireStringAndRejectsAnUnknownOne,
  );
}

describe('isCapabilityType', describeIsCapabilityType);
function describeStaleProfileCapabilitiesRegenerateVsReuseDecision261() {
  function flagsAProfileMintedBeforeAppGroupsWasEnabledRegenerate() {
    // App ID now has Push + App Groups; the cached profile predates App Groups (only Push entitlement).
    const missing = staleProfileCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS'], {
      'aps-environment': 'production',
    });

    expect(missing).toEqual(['APP_GROUPS']);
  }

  it(
    'flags a profile minted before App Groups was enabled (regenerate)',
    flagsAProfileMintedBeforeAppGroupsWasEnabledRegenerate,
  );

  function reusesWhenTheProfileAlreadyCoversEveryEnabledCapabilityNoChange() {
    expect(
      staleProfileCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS'], {
        'aps-environment': 'production',
        'com.apple.security.application-groups': ['group.com.acme'],
      }),
    ).toEqual([]);
  }

  it(
    'reuses when the profile already covers every enabled capability (no change)',
    reusesWhenTheProfileAlreadyCoversEveryEnabledCapabilityNoChange,
  );

  function ignoresAlwaysOnPieceLessCapabilitiesThatNeverLiveInAProfile() {
    // IN_APP_PURCHASE / GAME_CENTER carry no entitlement, so an empty profile is NOT stale against them.
    expect(staleProfileCapabilities(['IN_APP_PURCHASE', 'GAME_CENTER'], {})).toEqual([]);
  }

  it(
    'ignores always-on, value-less capabilities that never live in a profile',
    ignoresAlwaysOnPieceLessCapabilitiesThatNeverLiveInAProfile,
  );

  function cannotJudgeStalenessWhenTheProfileEntitlementsAreUnreadableReuseStands() {
    expect(staleProfileCapabilities(['APP_GROUPS'], null)).toEqual([]);
  }

  it(
    'cannot judge staleness when the profile entitlements are unreadable (reuse stands)',
    cannotJudgeStalenessWhenTheProfileEntitlementsAreUnreadableReuseStands,
  );
}

describe(
  'staleProfileCapabilities - regenerate vs reuse decision (#261)',
  describeStaleProfileCapabilitiesRegenerateVsReuseDecision261,
);
