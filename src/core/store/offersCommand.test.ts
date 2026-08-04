import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AppProducts } from '../types/catalog.js';
import {
  hasOffersWork,
  OffersCommandInputSchema,
  renderOfferAction,
  renderOfferCodeState,
} from './offersCommand.js';

describe('OffersCommandInputSchema', () => {
  it('decodes reconciliation with an omitted app selector', () => {
    expect(
      Schema.decodeUnknownSync(OffersCommandInputSchema)({
        operation: 'reconcile',
        dryRun: true,
        yes: false,
      }),
    ).toEqual({ operation: 'reconcile', dryRun: true, yes: false });
  });

  it('decodes code generation and rejects explicit undefined optionals', () => {
    expect(
      Schema.decodeUnknownSync(OffersCommandInputSchema)({
        operation: 'generate-codes',
        productId: 'com.acme.pro',
        offerName: 'LAUNCH',
        count: '100',
      }),
    ).toEqual({
      operation: 'generate-codes',
      productId: 'com.acme.pro',
      offerName: 'LAUNCH',
      count: '100',
    });
    expect(() =>
      Schema.decodeUnknownSync(OffersCommandInputSchema)({
        operation: 'list',
        productId: 'com.acme.pro',
        app: undefined,
      }),
    ).toThrow();
  });
});

describe('offers command renderers', () => {
  it('uses ASCII action and campaign markers', () => {
    expect(
      renderOfferAction({
        description: 'create offer LAUNCH',
        destructive: false,
        status: 'failed',
        error: 'Apple rejected it',
      }),
    ).toBe('x create offer LAUNCH - Apple rejected it');
    expect(renderOfferCodeState({ name: 'LAUNCH', active: true })).toBe('[active] LAUNCH');
    expect(renderOfferCodeState({ name: 'OLD', active: false })).toBe('[inactive] OLD');
  });
});

describe('hasOffersWork', () => {
  it('recognizes offers and promoted-purchase ordering without truthy fallback chains', () => {
    const offerCatalog: AppProducts = {
      subscriptionGroups: [
        {
          referenceName: 'Main',
          localizations: [],
          subscriptions: [
            {
              productId: 'com.acme.pro',
              referenceName: 'Pro',
              subscriptionPeriod: 'ONE_MONTH',
              localizations: [],
              winBackOffers: [
                {
                  offerId: 'return',
                  referenceName: 'Return',
                  duration: 'ONE_MONTH',
                  offerMode: 'FREE_TRIAL',
                  numberOfPeriods: 1,
                  eligiblePaidMonths: 1,
                  monthsSinceLastSubscribed: { min: 1, max: 6 },
                  startDate: '2026-08-03',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(hasOffersWork(offerCatalog)).toBe(true);
    expect(hasOffersWork({})).toBe(false);
  });
});
