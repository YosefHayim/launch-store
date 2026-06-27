import { describe, expect, it } from 'vitest';
import {
  listReadinessProbes,
  registerBuiltinProbes,
  registerReadinessProbe,
  selectReadinessProbes,
} from './registry.js';
import type { ReadinessProbe } from './types.js';

describe('readiness registry', () => {
  it('registers the built-in probes idempotently (re-registering replaces, never duplicates)', () => {
    registerBuiltinProbes();
    const first = listReadinessProbes().length;
    registerBuiltinProbes();
    expect(listReadinessProbes().length).toBe(first);
    expect(listReadinessProbes().map((probe) => probe.id)).toContain('apple-app-record');
    expect(listReadinessProbes().map((probe) => probe.id)).toContain('play-first-upload');
  });

  it('selects probes by category — each command sees only its slice', () => {
    registerBuiltinProbes();
    const account = selectReadinessProbes('account').map((probe) => probe.id);
    expect(account).toContain('apple-app-record');
    expect(account).toContain('apple-agreements');
    expect(account).toContain('play-app-access');
    expect(account).not.toContain('apple-distribution-cert'); // signing/submit, not an onboarding check

    const iap = selectReadinessProbes('iap').map((probe) => probe.id);
    expect(iap).toEqual(
      expect.arrayContaining([
        'apple-subscription-group',
        'apple-iap-products',
        'apple-subscriptions',
        'apple-iap-pricing',
        'apple-subscription-offers',
        'apple-sandbox-testers',
        'apple-iap-code-reference',
        'apple-storekit-config',
      ]),
    );
    expect(iap).not.toContain('apple-app-record');

    // `listing` is the store-listing-completeness slice — the deferred pre-submit probes that grade copy,
    // URLs, age rating, demo account, and screenshots all file under it (alongside `submit`).
    const listing = selectReadinessProbes('listing').map((probe) => probe.id);
    expect(listing).toEqual(
      expect.arrayContaining([
        'apple-age-rating',
        'apple-listing-urls',
        'apple-account-deletion',
        'apple-demo-account',
        'apple-screenshots',
      ]),
    );
    expect(listing).not.toContain('apple-profile-entitlements'); // signing/submit, not a listing check

    // audit is the cross-cutting `submit` selector: it picks up blocking probes across categories,
    // including the account/signing/iap ones tagged `submit`, but not advisory-only checks.
    const submit = selectReadinessProbes('submit').map((probe) => probe.id);
    expect(submit).toEqual(
      expect.arrayContaining([
        'apple-app-record',
        'apple-agreements',
        'apple-bundle-id',
        'apple-distribution-cert',
        'apple-export-compliance',
        'apple-iap-products',
        'apple-subscriptions',
        'apple-iap-pricing',
        'play-app-access',
        'apple-age-rating',
        'apple-listing-urls',
        'apple-account-deletion',
        'apple-demo-account',
        'apple-profile-entitlements',
        'apple-screenshots',
      ]),
    );
    expect(submit).not.toContain('play-internal-track'); // advisory, never a hard submit blocker
    expect(submit).not.toContain('apple-sandbox-testers'); // advisory IAP testing prerequisite, not a blocker
    expect(submit).not.toContain('apple-iap-code-reference'); // advisory local scan, not a submit blocker
    expect(submit).not.toContain('apple-storekit-config'); // advisory local scan, not a submit blocker
  });

  it('replaces a probe registered under an existing id', () => {
    const id = 'test-only-probe';
    const make = (title: string): ReadinessProbe => ({
      id,
      title,
      store: 'appstore',
      categories: ['account'],
      check: async () => ({ state: 'omitted' }),
    });
    registerReadinessProbe(make('first'));
    registerReadinessProbe(make('second'));
    expect(listReadinessProbes().filter((probe) => probe.id === id)).toHaveLength(1);
    expect(listReadinessProbes().find((probe) => probe.id === id)?.title).toBe('second');
  });
});
