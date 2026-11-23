import { describe, expect, it } from 'vitest';
import { loadConfigSchema, validateConfig } from './config-schema.ts';

function describeLoadPieceSchema() {
  async function loadsTheCommittedSchemaWithOnlyProfilesRequiredAndNamedNestedDefinitions() {
    const schema = await loadConfigSchema();
    // Effect Schema is the SSOT; gen-docs normalizes `$defs` -> `definitions` and roots
    // via `$ref` -> `#/definitions/LaunchConfig` when the root carries an identifier.
    const rootName = schema.$ref?.split('/').pop();
    let root = schema;

    if (rootName != null) {
      const rootDefinition = schema.definitions?.[rootName];

      if (rootDefinition != null) {
        root = rootDefinition;
      }
    }

    expect(root.type).toBe('object');
    expect(root.required).toEqual(['profiles']);
    expect(root.properties?.['profiles']).toBeDefined();
    expect(schema.definitions?.['BuildProfile']?.properties?.['name']).toBeDefined();
    expect(schema.definitions?.['OfferCodeConfig']).toBeDefined();
    expect(schema.definitions?.['PromotionalOfferConfig']).toBeDefined();
    expect(schema.definitions?.['WinBackOfferConfig']).toBeDefined();
    expect(schema.definitions?.['SubscriptionConfig']?.properties?.['productId']?.pattern).toBe(
      '^[A-Za-z0-9._]+$',
    );
    expect(schema.definitions?.['InAppPurchaseConfig']?.properties?.['productId']?.pattern).toBe(
      '^[A-Za-z0-9._]+$',
    );
  }

  it(
    'loads the committed schema with only `profiles` required and named nested definitions',
    loadsTheCommittedSchemaWithOnlyProfilesRequiredAndNamedNestedDefinitions,
  );

  async function memoizesTheCommittedSchemaAcrossLoads() {
    const first = await loadConfigSchema();
    const second = await loadConfigSchema();
    expect(second).toBe(first);
  }

  it('memoizes the committed schema across loads', memoizesTheCommittedSchemaAcrossLoads);
}

describe('loadConfigSchema', describeLoadPieceSchema);

function describeValidatePiece() {
  function acceptsAMinimalValidPieceProviderNamesDefaultSoTheyMayBeOmitted() {
    const validate = validateConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 200 } },
    });
    expect(validate).toEqual([]);
  }

  it(
    'accepts a minimal valid config (provider names default, so they may be omitted)',
    acceptsAMinimalValidPieceProviderNamesDefaultSoTheyMayBeOmitted,
  );

  function flagsAMissingProfilesAtItsOwnPath() {
    const violations = validateConfig({});

    function isProfilesPath(violation: { path: string; message: string }) {
      return violation.path == 'profiles';
    }

    expect(violations.some(isProfilesPath)).toBe(true);
  }

  it('flags a missing `profiles` at its own path', flagsAMissingProfilesAtItsOwnPath);

  function rejectsABadEnumPieceAtItsFieldPath() {
    const violations = validateConfig({
      profiles: { production: { name: 'production' } },
      release: { releaseType: 'WHENEVER' },
    });

    function isReleaseTypePath(violation: { path: string; message: string }) {
      return violation.path == 'release.releaseType';
    }

    expect(violations.some(isReleaseTypePath)).toBe(true);
  }

  it('rejects a bad enum value at its field path', rejectsABadEnumPieceAtItsFieldPath);

  function flagsAMalformedNestedFieldAtItsDottedPath() {
    const violations = validateConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 'big' } },
    });

    function isSizeBudgetPath(violation: { path: string; message: string }) {
      return violation.path == 'profiles.production.sizeBudgetMB';
    }

    expect(violations.some(isSizeBudgetPath)).toBe(true);
  }

  it(
    'flags a malformed nested field at its dotted path',
    flagsAMalformedNestedFieldAtItsDottedPath,
  );

  function rejectsAnUnknownTopLevelKeyAsUnknownPropertyIssue197() {
    const violations = validateConfig({
      profiles: { production: { name: 'production' } },
      nope: true,
    });

    expect(violations).toContainEqual({ path: 'nope', message: 'unknown property' });
  }

  it(
    'rejects an unknown top-level key as `unknown property` (issue #197)',
    rejectsAnUnknownTopLevelKeyAsUnknownPropertyIssue197,
  );

  function acceptsSharedOfferCodeBaseFieldsForPromotionalOffers() {
    const validate = validateConfig({
      profiles: { production: { name: 'production' } },
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
                      offerMode: 'FREE_TRIAL',
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

    expect(validate).toEqual([]);
  }

  it(
    'accepts shared offer-code base fields for promotional offers',
    acceptsSharedOfferCodeBaseFieldsForPromotionalOffers,
  );
}

describe('validateConfig', describeValidatePiece);
