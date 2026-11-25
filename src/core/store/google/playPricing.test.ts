import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  formatPlayMoney,
  parsePlayPrice,
  PlayPricingCommandInputSchema,
  renderRecommendedPrices,
} from './playPricing.js';
describe('parsePlayPrice', () => {
  it('normalizes decimal money to whole units and nanos', () => {
    expect(Effect.runSync(parsePlayPrice('007.50', 'eur'))).toEqual({
      currencyCode: 'EUR',
      units: '7',
      nanos: 500000000,
    });
  });
  it('accepts whole amounts and the full nine-decimal precision', () => {
    expect(Effect.runSync(parsePlayPrice('600', 'JPY'))).toEqual({
      currencyCode: 'JPY',
      units: '600',
      nanos: 0,
    });
    expect(Effect.runSync(parsePlayPrice('0.000000001', 'USD'))).toEqual({
      currencyCode: 'USD',
      units: '0',
      nanos: 1,
    });
  });
  it('returns typed failures for invalid currency, amount, and zero', () => {
    expect(() => Effect.runSync(parsePlayPrice('4.99', 'US'))).toThrow(/3-letter ISO code/);
    expect(() => Effect.runSync(parsePlayPrice('-1', 'USD'))).toThrow(/non-negative decimal/);
    expect(() => Effect.runSync(parsePlayPrice('4.9999999999', 'USD'))).toThrow(
      /non-negative decimal/,
    );
    expect(() => Effect.runSync(parsePlayPrice('0', 'USD'))).toThrow(/greater than zero/);
  });
});
describe('formatPlayMoney', () => {
  it('renders whole, two-decimal, and high-precision money', () => {
    expect(Effect.runSync(formatPlayMoney({ currencyCode: 'JPY', units: '600', nanos: 0 }))).toBe(
      'JPY 600',
    );
    expect(
      Effect.runSync(formatPlayMoney({ currencyCode: 'USD', units: '4', nanos: 500000000 })),
    ).toBe('USD 4.50');
    expect(
      Effect.runSync(formatPlayMoney({ currencyCode: 'USD', units: '4', nanos: 123456789 })),
    ).toBe('USD 4.123456789');
  });
});
describe('PlayPricingCommandInputSchema', () => {
  it('decodes the Commander boundary without an app selector', () => {
    expect(
      Schema.decodeUnknownSync(PlayPricingCommandInputSchema)({
        amount: '4.99',
        currency: 'USD',
        json: false,
      }),
    ).toEqual({ amount: '4.99', currency: 'USD', json: false });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      Schema.decodeUnknownSync(PlayPricingCommandInputSchema)({
        amount: '4.99',
        app: undefined,
        currency: 'USD',
        json: false,
      }),
    ).toThrow();
  });
});

describe('renderRecommendedPrices', () => {
  it('renders regional and fallback prices', () => {
    expect(
      Effect.runSync(
        renderRecommendedPrices(
          { currencyCode: 'USD', units: '4', nanos: 990000000 },
          {
            regions: [
              {
                regionCode: 'DE',
                price: { currencyCode: 'EUR', units: '4', nanos: 490000000 },
              },
            ],
            otherRegions: {
              usdPrice: { currencyCode: 'USD', units: '4', nanos: 990000000 },
              eurPrice: { currencyCode: 'EUR', units: '4', nanos: 490000000 },
            },
          },
        ),
      ),
    ).toContain('DE  EUR 4.49');
  });
});
