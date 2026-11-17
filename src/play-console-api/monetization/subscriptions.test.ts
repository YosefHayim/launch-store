import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateBasePlan,
  activateOffer,
  createOffer,
  createSubscription,
  listOffers,
  listSubscriptions,
  makeTestApi,
  patchSubscription,
} from '@/play-console-api/test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('subscriptions', () => {
  it('pages subscriptions and offers, dropping incomplete generated documents', async () => {
    listSubscriptions
      .mockResolvedValueOnce({
        data: {
          subscriptions: [
            {
              productId: 'pro',
              packageName: 'com.example.app',
              basePlans: [
                {
                  basePlanId: 'p1m',
                  state: 'ACTIVE',
                  autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
                  regionalConfigs: [
                    {
                      regionCode: 'US',
                      newSubscriberAvailability: true,
                      price: { currencyCode: 'USD', units: '9', nanos: 990000000 },
                    },
                  ],
                  offerTags: [{ tag: 'default' }, {}],
                },
              ],
              listings: [
                {
                  languageCode: 'en-US',
                  title: 'Pro',
                  description: 'All features',
                  benefits: ['No ads'],
                },
              ],
            },
            { packageName: 'com.example.app' },
          ],
          nextPageToken: 'subs-2',
        },
      })
      .mockResolvedValueOnce({ data: { subscriptions: [] } });
    listOffers.mockResolvedValue({
      data: {
        subscriptionOffers: [
          {
            offerId: 'trial',
            productId: 'pro',
            basePlanId: 'p1m',
            state: 'ACTIVE',
            regionalConfigs: [{ regionCode: 'US', newSubscriberAvailability: true }],
            phases: [
              {
                recurrenceCount: 1,
                duration: 'P1W',
                regionalConfigs: [{ regionCode: 'US', free: {} }],
              },
            ],
            offerTags: [{ tag: 'welcome' }],
          },
          { productId: 'pro' },
        ],
      },
    });
    expect(await client.listSubscriptions('com.example.app')).toEqual([
      {
        productId: 'pro',
        packageName: 'com.example.app',
        basePlans: [
          {
            basePlanId: 'p1m',
            state: 'ACTIVE',
            autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
            regionalConfigs: [
              {
                regionCode: 'US',
                newSubscriberAvailability: true,
                price: { currencyCode: 'USD', units: '9', nanos: 990000000 },
              },
            ],
            offerTags: [{ tag: 'default' }],
          },
        ],
        listings: [
          {
            languageCode: 'en-US',
            title: 'Pro',
            description: 'All features',
            benefits: ['No ads'],
          },
        ],
      },
    ]);
    expect(listSubscriptions.mock.calls[1]?.[0].pageToken).toBe('subs-2');
    expect(await client.listSubscriptionOffers('com.example.app', 'pro', 'p1m')).toEqual([
      {
        offerId: 'trial',
        productId: 'pro',
        basePlanId: 'p1m',
        state: 'ACTIVE',
        regionalConfigs: [{ regionCode: 'US', newSubscriberAvailability: true }],
        phases: [
          {
            recurrenceCount: 1,
            duration: 'P1W',
            regionalConfigs: [{ regionCode: 'US', free: {} }],
          },
        ],
        offerTags: [{ tag: 'welcome' }],
      },
    ]);
  });
  it('writes subscriptions, base plans and offers through the generated client', async () => {
    createSubscription.mockResolvedValue({ data: {} });
    patchSubscription.mockResolvedValue({ data: {} });
    activateBasePlan.mockResolvedValue({ data: {} });
    createOffer.mockResolvedValue({ data: {} });
    activateOffer.mockResolvedValue({ data: {} });
    await client.createSubscription('com.example.app', {
      productId: 'pro',
      listings: [{ languageCode: 'en-US', title: 'Pro', description: 'All features' }],
    });
    await client.patchSubscription(
      'com.example.app',
      {
        productId: 'pro',
        listings: [{ languageCode: 'en-US', title: 'Pro', description: 'All' }],
      },
      'listings',
    );
    await client.activateBasePlan('com.example.app', 'pro', 'p1m');
    await client.createSubscriptionOffer('com.example.app', {
      offerId: 'trial',
      productId: 'pro',
      basePlanId: 'p1m',
      phases: [],
      regionalConfigs: [],
    });
    await client.activateSubscriptionOffer('com.example.app', 'pro', 'p1m', 'trial');
    expect(createSubscription.mock.calls[0]?.[0].productId).toBe('pro');
    expect(patchSubscription.mock.calls[0]?.[0].updateMask).toBe('listings');
    expect(activateBasePlan).toHaveBeenCalledWith({
      packageName: 'com.example.app',
      productId: 'pro',
      basePlanId: 'p1m',
      requestBody: { packageName: 'com.example.app', productId: 'pro', basePlanId: 'p1m' },
    });
    expect(createOffer.mock.calls[0]?.[0].offerId).toBe('trial');
    expect(activateOffer.mock.calls[0]?.[0].offerId).toBe('trial');
  });
});
