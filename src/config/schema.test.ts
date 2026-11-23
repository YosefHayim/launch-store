import { describe, expect, it } from 'vitest';
import { parseLaunchConfig, validateLaunchConfig } from './schema.ts';
function describeParseLaunchPiece() {
  function fillsProviderDefaultsThroughEffectSchema() {
    const parsed = parseLaunchConfig({ profiles: {} });

    expect(parsed).toMatchObject({
      credentials: 'local',
      storage: 'local',
      buildEngine: 'xcode',
      submit: 'app-store-connect',
    });
  }

  it('fills provider defaults through Effect Schema', fillsProviderDefaultsThroughEffectSchema);

  function keepsAnExplicitProviderNameOverTheDefault() {
    const parsed = parseLaunchConfig({ profiles: {}, storage: 's3', credentials: 'local' });
    expect(parsed.storage).toBe('s3');
    expect(parsed.credentials).toBe('local');
  }

  it('keeps an explicit provider name over the default', keepsAnExplicitProviderNameOverTheDefault);

  function acceptsAPerPlatformSubmitMapForASubsetOfPlatforms() {
    const parsed = parseLaunchConfig({
      profiles: {},
      submit: { android: ['google-play', 'amazon-appstore'] },
    });

    expect(parsed.submit).toEqual({ android: ['google-play', 'amazon-appstore'] });
  }

  it(
    'accepts a per-platform submit map for a subset of platforms',
    acceptsAPerPlatformSubmitMapForASubsetOfPlatforms,
  );

  function acceptsAFreeTrialOfferCodeWithoutPrices() {
    const parsed = parseLaunchConfig({
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
    });
    const group = parsed.products?.['com.acme.app']?.subscriptionGroups?.[0];

    expect(group?.subscriptions[0]?.offerCodes?.[0]?.offerMode).toBe('FREE_TRIAL');
  }

  it('accepts a free-trial offer-code without prices', acceptsAFreeTrialOfferCodeWithoutPrices);
}

describe('parseLaunchConfig', describeParseLaunchPiece);
function describeValidateLaunchPiece() {
  function acceptsAppleProductIDsWithLettersDigitsUnderscoresAndPeriods() {
    const validateLaunch = validateLaunchConfig({
      profiles: {},
      products: {
        'com.acme-app': {
          inAppPurchases: [
            {
              productId: 'com.acme.coins_100',
              referenceName: 'Coins',
              type: 'CONSUMABLE',
              localizations: [{ locale: 'en-US', name: 'Coins' }],
            },
          ],
          subscriptionGroups: [
            {
              referenceName: 'Pro',
              localizations: [{ locale: 'en-US', name: 'Pro' }],
              subscriptions: [
                {
                  productId: 'com.acme.pro.monthly2',
                  referenceName: 'Monthly',
                  subscriptionPeriod: 'ONE_MONTH',
                  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
                },
              ],
            },
          ],
        },
      },
    });

    expect(validateLaunch).toEqual([]);
  }

  it(
    'accepts Apple product IDs with letters, digits, underscores, and periods',
    acceptsAppleProductIDsWithLettersDigitsUnderscoresAndPeriods,
  );

  function rejectsHyphensInAppleSubscriptionAndInAppPurchaseProductIdFields() {
    const violations = validateLaunchConfig({
      profiles: {},
      products: {
        'com.acme-app': {
          inAppPurchases: [
            {
              productId: 'com.acme.coins-100',
              referenceName: 'Coins',
              type: 'CONSUMABLE',
              localizations: [{ locale: 'en-US', name: 'Coins' }],
            },
          ],
          subscriptionGroups: [
            {
              referenceName: 'Pro',
              localizations: [{ locale: 'en-US', name: 'Pro' }],
              subscriptions: [
                {
                  productId: 'com.acme.pro-monthly',
                  referenceName: 'Monthly',
                  subscriptionPeriod: 'ONE_MONTH',
                  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
                },
              ],
            },
          ],
        },
      },
    });

    expect(violations).toContainEqual({
      path: 'products["com.acme-app"].inAppPurchases[0].productId',
      message: 'productId may contain only letters, digits, underscores, and periods.',
    });
    expect(violations).toContainEqual({
      path: 'products["com.acme-app"].subscriptionGroups[0].subscriptions[0].productId',
      message: 'productId may contain only letters, digits, underscores, and periods.',
    });
  }

  it(
    'rejects hyphens in Apple subscription and in-app purchase productId fields',
    rejectsHyphensInAppleSubscriptionAndInAppPurchaseProductIdFields,
  );

  function rejectsAnUnknownTopLevelKeyAsAnUnknownProperty() {
    const validateLaunch = validateLaunchConfig({ profiles: {}, nope: true });

    expect(validateLaunch).toContainEqual({
      path: 'nope',
      message: 'unknown property',
    });
  }

  it(
    'rejects an unknown top-level key as an unknown property',
    rejectsAnUnknownTopLevelKeyAsAnUnknownProperty,
  );

  function flagsAMissingProfilesFieldAtItsOwnPath() {
    const violations = validateLaunchConfig({});

    function isProfilesPath(violation: { path: string; message: string }) {
      return violation.path == 'profiles';
    }

    expect(violations.some(isProfilesPath)).toBe(true);
  }

  it('flags a missing profiles field at its own path', flagsAMissingProfilesFieldAtItsOwnPath);

  function flagsMalformedNestedFieldsAtDottedPaths() {
    const violations = validateLaunchConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 'big' } },
      release: { releaseType: 'WHENEVER' },
    });

    function isSizeBudgetPath(violation: { path: string; message: string }) {
      return violation.path == 'profiles.production.sizeBudgetMB';
    }

    expect(violations.some(isSizeBudgetPath)).toBe(true);

    function isReleaseTypePath(violation: { path: string; message: string }) {
      return violation.path == 'release.releaseType';
    }

    expect(violations.some(isReleaseTypePath)).toBe(true);
  }

  it('flags malformed nested fields at dotted paths', flagsMalformedNestedFieldsAtDottedPaths);

  function rejectsUnknownPerPlatformSubmitKeysWithoutRequiringEveryPlatform() {
    const violations = validateLaunchConfig({
      profiles: {},
      submit: { windows: ['store'] },
    });

    expect(violations).toContainEqual({ path: 'submit.windows', message: 'unknown property' });

    function isSubmitIosPath(violation: { path: string; message: string }) {
      return violation.path == 'submit.ios';
    }

    expect(violations.some(isSubmitIosPath)).toBe(false);
  }

  it(
    'rejects unknown per-platform submit keys without requiring every platform',
    rejectsUnknownPerPlatformSubmitKeysWithoutRequiringEveryPlatform,
  );

  function acceptsASinglePlatformSubmitMapAndAnEmptySubmitMap() {
    const validateLaunch = validateLaunchConfig({
      profiles: {},
      submit: { ios: ['app-store-connect'] },
    });

    expect(validateLaunch).toEqual([]);
    expect(validateLaunchConfig({ profiles: {}, submit: {} })).toEqual([]);
  }

  it(
    'accepts a single-platform submit map and an empty submit map',
    acceptsASinglePlatformSubmitMapAndAnEmptySubmitMap,
  );

  function flagsABadPromotionalOfferEnumAtANestedDottedPath() {
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

    function includesPromotionalOffers(violation: { path: string; message: string }) {
      return violation.path.includes('promotionalOffers');
    }

    expect(violations.some(includesPromotionalOffers)).toBe(true);
  }

  it(
    'flags a bad promotional offer enum at a nested dotted path',
    flagsABadPromotionalOfferEnumAtANestedDottedPath,
  );

  function flagsAWinBackOfferWithABadPriorityAtItsFieldPath() {
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

    function includesPriorityField(violation: { path: string; message: string }) {
      return violation.path.includes('priority');
    }

    expect(violations.some(includesPriorityField)).toBe(true);
  }

  it(
    'flags a win-back offer with a bad priority at its field path',
    flagsAWinBackOfferWithABadPriorityAtItsFieldPath,
  );
}

describe('validateLaunchConfig', describeValidateLaunchPiece);
function describeDeprecatedAgeRatingAnswersInReleaseAttributes() {
  function rejectsADeprecatedPieceAndNamesTheOneToUse() {
    function callParseLaunchPiece() {
      return parseLaunchConfig({
        profiles: {},
        releaseAttributes: {
          'com.acme.app': { ageRating: { violenceRealistic: 'INFREQUENT_OR_MILD' } },
        },
      });
    }

    expect(callParseLaunchPiece).toThrow(
      /uses deprecated value INFREQUENT_OR_MILD: use INFREQUENT/,
    );
  }

  it(
    'rejects a deprecated value and names the one to use',
    rejectsADeprecatedPieceAndNamesTheOneToUse,
  );
}

describe(
  'deprecated age-rating answers in releaseAttributes',
  describeDeprecatedAgeRatingAnswersInReleaseAttributes,
);
