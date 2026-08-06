import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { loadConfigSchema, validateConfig } from './configSchema.js';

describe('loadConfigSchema', () => {
  it('loads the committed schema with only `profiles` required and named nested definitions', async () => {
    const schema = await Effect.runPromise(
      loadConfigSchema().pipe(Effect.provide(NodeContext.layer)),
    );
    // Effect Schema is the SSOT (ADR 0013); gen-docs normalizes `$defs` -> `definitions` and roots
    // via `$ref` -> `#/definitions/LaunchConfig` when the root carries an identifier.
    const rootName = schema.$ref?.split('/').pop();
    let root = schema;
    if (rootName !== undefined) {
      const rootDefinition = schema.definitions?.[rootName];
      if (rootDefinition !== undefined) {
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
  });

  it('memoizes the committed schema across loads', async () => {
    const first = await Effect.runPromise(
      loadConfigSchema().pipe(Effect.provide(NodeContext.layer)),
    );
    const second = await Effect.runPromise(
      loadConfigSchema().pipe(Effect.provide(NodeContext.layer)),
    );
    expect(second).toBe(first);
  });
});

describe('validateConfig', () => {
  it('accepts a minimal valid config (provider names default, so they may be omitted)', () => {
    expect(
      validateConfig({ profiles: { production: { name: 'production', sizeBudgetMB: 200 } } }),
    ).toEqual([]);
  });

  it('flags a missing `profiles` at its own path', () => {
    const violations = validateConfig({});
    expect(violations.some((violation) => violation.path === 'profiles')).toBe(true);
  });

  it('rejects a bad enum value at its field path', () => {
    const violations = validateConfig({
      profiles: { production: { name: 'production' } },
      release: { releaseType: 'WHENEVER' },
    });
    expect(violations.some((violation) => violation.path === 'release.releaseType')).toBe(true);
  });

  it('flags a malformed nested field at its dotted path', () => {
    const violations = validateConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 'big' } },
    });
    expect(
      violations.some((violation) => violation.path === 'profiles.production.sizeBudgetMB'),
    ).toBe(true);
  });

  it('rejects an unknown top-level key as `unknown property` (issue #197)', () => {
    const violations = validateConfig({
      profiles: { production: { name: 'production' } },
      nope: true,
    });
    expect(violations).toContainEqual({ path: 'nope', message: 'unknown property' });
  });

  it('accepts shared offer-code base fields for promotional offers', () => {
    expect(
      validateConfig({
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
      }),
    ).toEqual([]);
  });
});
