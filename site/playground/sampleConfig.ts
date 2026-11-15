import type { AppDescriptor } from '@core/types/app.js';
import type { AppProducts, InAppPurchaseConfig, SubscriptionConfig } from '@core/types/catalog.js';
import type { LaunchConfig } from '@core/types/config.js';
import { SAMPLE_BUNDLE_ID, findPreset, type PlaygroundSettings } from './presets.js';

export const SAMPLE_APP: AppDescriptor = {
  name: 'helloworld',
  dir: '/sample/helloworld',
  configPath: '/sample/helloworld/app.json',
  bundleId: SAMPLE_BUNDLE_ID,
  packageName: SAMPLE_BUNDLE_ID,
};

const toMicros = (price: number): string => String(Math.round(price * 1_000_000));

export const halfPriceOf = (price: number): number => Math.round(price * 50) / 100;

const trialPart = (
  settings: PlaygroundSettings,
): Pick<SubscriptionConfig, 'introductoryOffers'> => {
  if (!settings.trial) return {};
  return {
    introductoryOffers: [{ duration: 'ONE_WEEK', offerMode: 'FREE_TRIAL', numberOfPeriods: 1 }],
  };
};

const winbackPart = (
  settings: PlaygroundSettings,
): Pick<SubscriptionConfig, 'promotionalOffers'> => {
  if (!settings.winback) return {};
  return {
    promotionalOffers: [
      {
        name: 'Half off',
        offerCode: 'promo-halfoff',
        duration: 'ONE_MONTH',
        offerMode: 'PAY_AS_YOU_GO',
        numberOfPeriods: 3,
        prices: [{ customerPrice: halfPriceOf(settings.price) }],
      },
    ],
  };
};

const playSubscriptionPart = (settings: PlaygroundSettings): Pick<SubscriptionConfig, 'play'> => {
  if (!settings.play) return {};
  return {
    play: {
      basePlanId: 'p1m',
      prices: { US: { priceMicros: toMicros(settings.price), currency: 'USD' } },
    },
  };
};

const buildSubscription = (settings: PlaygroundSettings): SubscriptionConfig => ({
  productId: 'pro.monthly',
  referenceName: 'Pro Monthly',
  subscriptionPeriod: 'ONE_MONTH',
  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
  price: { customerPrice: settings.price },
  ...trialPart(settings),
  ...winbackPart(settings),
  ...playSubscriptionPart(settings),
});

const playGemPart = (settings: PlaygroundSettings): Pick<InAppPurchaseConfig, 'play'> => {
  if (!settings.play) return {};
  return { play: { defaultPrice: { priceMicros: toMicros(settings.price), currency: 'USD' } } };
};

const buildGemPack = (settings: PlaygroundSettings): InAppPurchaseConfig => ({
  productId: 'gems.small',
  referenceName: 'Small gem pack',
  type: 'CONSUMABLE',
  localizations: [{ locale: 'en-US', name: 'Small gem pack' }],
  price: { customerPrice: settings.price },
  ...playGemPart(settings),
});

const buildProducts = (settings: PlaygroundSettings): AppProducts => {
  if (findPreset(settings.presetId).product === 'inAppPurchase') {
    return {
      inAppPurchases: [
        buildGemPack(settings),
        {
          productId: 'remove.ads',
          referenceName: 'Remove ads',
          type: 'NON_CONSUMABLE',
          localizations: [{ locale: 'en-US', name: 'Remove ads' }],
          price: { customerPrice: 2.99 },
        },
      ],
    };
  }
  return {
    subscriptionGroups: [
      {
        referenceName: 'Hello Pro',
        localizations: [{ locale: 'en-US', name: 'Hello Pro' }],
        subscriptions: [buildSubscription(settings)],
      },
    ],
  };
};

export const buildSampleConfig = (settings: PlaygroundSettings): LaunchConfig => ({
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
  products: { [SAMPLE_BUNDLE_ID]: buildProducts(settings) },
});
