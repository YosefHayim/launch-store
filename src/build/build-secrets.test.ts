import { describe, expect, it } from 'vitest';
import { effectiveRefs, type SecretRef } from './build-secrets.ts';
function ref(app: string, profile: string | null, name: string): SecretRef {
  return {
    app,
    profile,
    name,
  };
}
function describeEffectiveRefs() {
  const refs = [
    ref('acme', null, 'SENTRY_AUTH_TOKEN'),
    ref('acme', 'production', 'API_KEY'),
    ref('acme', 'preview', 'API_KEY'),
    ref('other', null, 'OTHER_TOKEN'),
  ];

  function includesOnlyTheRequestedAppSSecrets() {
    function readName(r: {
      readonly app: string;
      readonly profile: string | null;
      readonly name: string;
    }) {
      return r.name;
    }

    expect(effectiveRefs(refs, 'acme', 'production').map(readName)).not.toContain('OTHER_TOKEN');

    function readName2(r: {
      readonly app: string;
      readonly profile: string | null;
      readonly name: string;
    }) {
      return r.name;
    }

    expect(effectiveRefs(refs, 'other', 'production').map(readName2)).toEqual(['OTHER_TOKEN']);
  }

  it("includes only the requested app's secrets", includesOnlyTheRequestedAppSSecrets);

  function includesAppWideSecretsAndTheMatchingProfileSAppWideFirst() {
    function readName3(r: {
      readonly app: string;
      readonly profile: string | null;
      readonly name: string;
    }) {
      return r.name;
    }

    const names = effectiveRefs(refs, 'acme', 'production').map(readName3);

    expect(names).toEqual(['SENTRY_AUTH_TOKEN', 'API_KEY']);

    function readProfile(r: {
      readonly app: string;
      readonly profile: string | null;
      readonly name: string;
    }) {
      return r.profile;
    }

    // The 'preview' profile's API_KEY must not leak into a 'production' build.
    const profiles = effectiveRefs(refs, 'acme', 'production').map(readProfile);

    expect(profiles).toEqual([null, 'production']);
  }

  it(
    "includes app-wide secrets and the matching profile's, app-wide first",
    includesAppWideSecretsAndTheMatchingProfileSAppWideFirst,
  );

  function ordersAppWideBeforeProfileScopedSoTheProfilePieceOverridesOnMerge() {
    const collision = [ref('acme', 'production', 'API_KEY'), ref('acme', null, 'API_KEY')];
    const ordered = effectiveRefs(collision, 'acme', 'production');

    function readProfile2(r: {
      readonly app: string;
      readonly profile: string | null;
      readonly name: string;
    }) {
      return r.profile;
    }

    // App-wide first, profile last -> spreading in this order lets the profile-scoped value win.
    expect(ordered.map(readProfile2)).toEqual([null, 'production']);
  }

  it(
    'orders app-wide before profile-scoped so the profile value overrides on merge',
    ordersAppWideBeforeProfileScopedSoTheProfilePieceOverridesOnMerge,
  );

  function returnsNothingForAnAppWithNoSecrets() {
    expect(effectiveRefs(refs, 'ghost', 'production')).toEqual([]);
  }

  it('returns nothing for an app with no secrets', returnsNothingForAnAppWithNoSecrets);
}

describe('effectiveRefs', describeEffectiveRefs);
