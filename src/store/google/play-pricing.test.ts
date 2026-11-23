import { describe, expect, it } from 'vitest';
import {
  formatPlayMoney,
  parsePlayPrice,
  PlayPricingCommandInputSchema,
  renderRecommendedPrices,
} from './play-pricing.ts';

function describeParsePlayPrice() {
  function normalizesDecimalMoneyToWholeUnitsAndNanos() {
    const playPrice = parsePlayPrice('007.50', 'eur');

    expect(playPrice).toEqual({
      currencyCode: 'EUR',
      units: '7',
      nanos: 500000000,
    });
  }

  it(
    'normalizes decimal money to whole units and nanos',
    normalizesDecimalMoneyToWholeUnitsAndNanos,
  );

  function acceptsWholeAmountsAndTheFullNineDecimalPrecision() {
    const playPrice = parsePlayPrice('600', 'JPY');

    expect(playPrice).toEqual({
      currencyCode: 'JPY',
      units: '600',
      nanos: 0,
    });
    expect(parsePlayPrice('0.000000001', 'USD')).toEqual({
      currencyCode: 'USD',
      units: '0',
      nanos: 1,
    });
  }

  it(
    'accepts whole amounts and the full nine-decimal precision',
    acceptsWholeAmountsAndTheFullNineDecimalPrecision,
  );

  function returnsTypedFailuresForInvalidCurrencyAmountAndZero() {
    function callParsePlayPrice() {
      return parsePlayPrice('4.99', 'US');
    }

    expect(callParsePlayPrice).toThrow(/3-letter ISO code/);

    function callParsePlayPrice2() {
      return parsePlayPrice('-1', 'USD');
    }

    expect(callParsePlayPrice2).toThrow(/non-negative decimal/);

    function callParsePlayPrice3() {
      return parsePlayPrice('4.9999999999', 'USD');
    }

    expect(callParsePlayPrice3).toThrow(/non-negative decimal/);

    function callParsePlayPrice4() {
      return parsePlayPrice('0', 'USD');
    }

    expect(callParsePlayPrice4).toThrow(/greater than zero/);
  }

  it(
    'returns typed failures for invalid currency, amount, and zero',
    returnsTypedFailuresForInvalidCurrencyAmountAndZero,
  );
}

describe('parsePlayPrice', describeParsePlayPrice);

function describeFormatPlayMoney() {
  function rendersWholeTwoDecimalAndHighPrecisionMoney() {
    const playMoney = formatPlayMoney({ currencyCode: 'JPY', units: '600', nanos: 0 });

    expect(playMoney).toBe('JPY 600');
    expect(formatPlayMoney({ currencyCode: 'USD', units: '4', nanos: 500000000 })).toBe('USD 4.50');
    expect(formatPlayMoney({ currencyCode: 'USD', units: '4', nanos: 123456789 })).toBe(
      'USD 4.123456789',
    );
  }

  it(
    'renders whole, two-decimal, and high-precision money',
    rendersWholeTwoDecimalAndHighPrecisionMoney,
  );
}

describe('formatPlayMoney', describeFormatPlayMoney);

function describePlayPricingCommandPieceSchema() {
  function decodesTheCommanderBoundaryWithoutAnAppSelector() {
    const playPricingCommandSchema = PlayPricingCommandInputSchema({
      amount: '4.99',
      currency: 'USD',
      json: false,
    });

    expect(playPricingCommandSchema).toEqual({ amount: '4.99', currency: 'USD', json: false });
  }

  it(
    'decodes the Commander boundary without an app selector',
    decodesTheCommanderBoundaryWithoutAnAppSelector,
  );

  function rejectsAnExplicitUndefinedExactOptionalApp() {
    function callPlayPricingCommandPieceSchema() {
      return PlayPricingCommandInputSchema({
        amount: '4.99',
        app: undefined,
        currency: 'USD',
        json: false,
      });
    }

    expect(callPlayPricingCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional app',
    rejectsAnExplicitUndefinedExactOptionalApp,
  );
}

describe('PlayPricingCommandInputSchema', describePlayPricingCommandPieceSchema);

function describeRenderRecommendedPrices() {
  function rendersRegionalAndFallbackPrices() {
    const recommendedPrices = renderRecommendedPrices(
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
    );

    expect(recommendedPrices).toContain('DE  EUR 4.49');
  }

  it('renders regional and fallback prices', rendersRegionalAndFallbackPrices);
}

describe('renderRecommendedPrices', describeRenderRecommendedPrices);
