import { describe, expect, it } from 'vitest';
import { effectiveRefs, type SecretRef } from './buildSecrets.js';

const ref = (app: string, profile: string | null, name: string): SecretRef => ({
  app,
  profile,
  name,
});

describe('effectiveRefs', () => {
  const refs = [
    ref('acme', null, 'SENTRY_AUTH_TOKEN'),
    ref('acme', 'production', 'API_KEY'),
    ref('acme', 'preview', 'API_KEY'),
    ref('other', null, 'OTHER_TOKEN'),
  ];

  it("includes only the requested app's secrets", () => {
    expect(effectiveRefs(refs, 'acme', 'production').map((r) => r.name)).not.toContain(
      'OTHER_TOKEN',
    );
    expect(effectiveRefs(refs, 'other', 'production').map((r) => r.name)).toEqual(['OTHER_TOKEN']);
  });

  it("includes app-wide secrets and the matching profile's, app-wide first", () => {
    const names = effectiveRefs(refs, 'acme', 'production').map((r) => r.name);
    expect(names).toEqual(['SENTRY_AUTH_TOKEN', 'API_KEY']);
    // The 'preview' profile's API_KEY must not leak into a 'production' build.
    const profiles = effectiveRefs(refs, 'acme', 'production').map((r) => r.profile);
    expect(profiles).toEqual([null, 'production']);
  });

  it('orders app-wide before profile-scoped so the profile value overrides on merge', () => {
    const collision = [ref('acme', 'production', 'API_KEY'), ref('acme', null, 'API_KEY')];
    const ordered = effectiveRefs(collision, 'acme', 'production');
    // App-wide first, profile last → spreading in this order lets the profile-scoped value win.
    expect(ordered.map((r) => r.profile)).toEqual([null, 'production']);
  });

  it('returns nothing for an app with no secrets', () => {
    expect(effectiveRefs(refs, 'ghost', 'production')).toEqual([]);
  });
});
