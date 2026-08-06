import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { parseLaunchConfig, validateLaunchConfig } from './schema.js';

describe('parseLaunchConfig', () => {
  it('fills provider defaults through Effect Schema', () => {
    const parsed = Effect.runSync(parseLaunchConfig({ profiles: {} }));
    expect(parsed).toMatchObject({
      credentials: 'local',
      storage: 'local',
      buildEngine: 'fastlane',
      submit: 'app-store-connect',
    });
  });

  it('keeps an explicit provider name over the default', () => {
    const parsed = Effect.runSync(
      parseLaunchConfig({ profiles: {}, storage: 's3', credentials: 'local' }),
    );
    expect(parsed.storage).toBe('s3');
    expect(parsed.credentials).toBe('local');
  });

  it('accepts a per-platform submit map for a subset of platforms', () => {
    const parsed = Effect.runSync(
      parseLaunchConfig({
        profiles: {},
        submit: { android: ['google-play', 'amazon-appstore'] },
      }),
    );
    expect(parsed.submit).toEqual({ android: ['google-play', 'amazon-appstore'] });
  });

  it('accepts a free-trial offer-code without prices', () => {
    const parsed = Effect.runSync(
      parseLaunchConfig({
        profiles: {},
        products: {
          'com.acme.app': {
            subscriptionGroups: [
              {
                referenceName: 'Pro',
                localizations: [{ locale: 'en-US', name: 'Pro' }],
                subscriptions: [
                  {
                    productId: 'com.acme.pro.monthly',
                    referenceName: 'Monthly',
                    subscriptionPeriod: 'ONE_MONTH',
                    localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
                    offerCodes: [
                      {
                        name: 'trial-week',
                        duration: 'ONE_WEEK',
                        offerMode: 'FREE_TRIAL',
                        numberOfPeriods: 1,
                        customerEligibilities: ['NEW'],
                        offerEligibility: 'STACK_WITH_INTRO_OFFERS',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    const group = parsed.products?.['com.acme.app']?.subscriptionGroups?.[0];
    expect(group?.subscriptions[0]?.offerCodes?.[0]?.offerMode).toBe('FREE_TRIAL');
  });
});

describe('validateLaunchConfig', () => {
  it('rejects an unknown top-level key as an unknown property', () => {
    expect(validateLaunchConfig({ profiles: {}, nope: true })).toContainEqual({
      path: 'nope',
      message: 'unknown property',
    });
  });

  it('flags a missing profiles field at its own path', () => {
    const violations = validateLaunchConfig({});
    expect(violations.some((violation) => violation.path === 'profiles')).toBe(true);
  });

  it('flags malformed nested fields at dotted paths', () => {
    const violations = validateLaunchConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 'big' } },
      release: { releaseType: 'WHENEVER' },
    });
    expect(
      violations.some((violation) => violation.path === 'profiles.production.sizeBudgetMB'),
    ).toBe(true);
    expect(violations.some((violation) => violation.path === 'release.releaseType')).toBe(true);
  });

  it('rejects unknown per-platform submit keys without requiring every platform', () => {
    const violations = validateLaunchConfig({
      profiles: {},
      submit: { windows: ['store'] },
    });
    expect(violations).toContainEqual({ path: 'submit.windows', message: 'unknown property' });
    expect(violations.some((violation) => violation.path === 'submit.ios')).toBe(false);
  });

  it('accepts a single-platform submit map and an empty submit map', () => {
    expect(
      validateLaunchConfig({
        profiles: {},
        submit: { ios: ['app-store-connect'] },
      }),
    ).toEqual([]);
    expect(validateLaunchConfig({ profiles: {}, submit: {} })).toEqual([]);
  });

  it('flags a bad promotional offer enum at a nested dotted path', () => {
    const violations = validateLaunchConfig({
      profiles: {},
      products: {
        'com.acme.app': {
          subscriptionGroups: [
            {
              referenceName: 'Pro',
              localizations: [{ locale: 'en-US', name: 'Pro' }],
              subscriptions: [
                {
                  productId: 'com.acme.pro.monthly',
                  referenceName: 'Monthly',
                  subscriptionPeriod: 'ONE_MONTH',
                  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
                  promotionalOffers: [
                    {
                      name: 'promo',
                      offerCode: 'PROMO',
                      duration: 'ONE_WEEK',
                      offerMode: 'NOT_A_MODE',
                      numberOfPeriods: 1,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    expect(violations.some((violation) => violation.path.includes('promotionalOffers'))).toBe(true);
  });

  it('flags a win-back offer with a bad priority at its field path', () => {
    const violations = validateLaunchConfig({
      profiles: {},
      products: {
        'com.acme.app': {
          subscriptionGroups: [
            {
              referenceName: 'Pro',
              localizations: [{ locale: 'en-US', name: 'Pro' }],
              subscriptions: [
                {
                  productId: 'com.acme.pro.monthly',
                  referenceName: 'Monthly',
                  subscriptionPeriod: 'ONE_MONTH',
                  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
                  winBackOffers: [
                    {
                      offerId: 'wb1',
                      referenceName: 'Come back',
                      duration: 'ONE_MONTH',
                      offerMode: 'PAY_UP_FRONT',
                      numberOfPeriods: 1,
                      prices: [{ customerPrice: 0.99 }],
                      eligiblePaidMonths: 3,
                      monthsSinceLastSubscribed: { min: 1, max: 12 },
                      startDate: '2026-01-01',
                      priority: 'URGENT',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    expect(violations.some((violation) => violation.path.includes('priority'))).toBe(true);
  });
});
