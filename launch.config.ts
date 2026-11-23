import { defineConfig } from 'launch-store';

export default defineConfig({
  appRoots: ['./examples'],
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
  prebuild: 'missing',
  artifactRetentionDays: 30,
  envExclude: ['ASC_PRIVATE_KEY'],

  aws: {
    region: 'us-east-1',
  },

  storageConfig: {
    bucket: 'acme-launch-artifacts',
    region: 'us-east-1',
    publicBaseUrl: 'https://updates.example.com',
  },

  notify: {
    webhookUrl: 'https://example.com/launch-hook',
    events: ['build', 'submit', 'review', 'rollout'],
  },

  release: {
    releaseType: 'MANUAL',
    phasedRelease: true,
    copyright: '2026 Acme',
    primaryLocale: 'en-US',
    releaseNotes: {
      'en-US': 'Bug fixes and a faster launch.',
    },
  },

  profiles: {
    production: {
      name: 'production',
      envFile: '.env',
      sizeBudgetMB: 200,
      track: 'internal',
      rollout: 1,
    },
    preview: {
      name: 'preview',
      envFile: '.env.preview',
      sizeBudgetMB: 250,
      track: 'internal',
      ssl: true,
    },
  },

  products: {
    'com.acme.app': {
      inAppPurchases: [
        {
          productId: 'com.acme.coins_100',
          referenceName: 'Coins 100',
          type: 'CONSUMABLE',
          localizations: [{ locale: 'en-US', name: '100 Coins', description: 'A bag of coins.' }],
          price: { baseTerritory: 'USA', customerPrice: 0.99 },
          play: {
            sku: 'coins_100',
            defaultPrice: { priceMicros: '990000', currency: 'USD' },
          },
        },
      ],
      subscriptionGroups: [
        {
          referenceName: 'Pro',
          localizations: [{ locale: 'en-US', name: 'Pro' }],
          subscriptions: [
            {
              productId: 'com.acme.pro_monthly',
              referenceName: 'Pro Monthly',
              subscriptionPeriod: 'ONE_MONTH',
              localizations: [
                { locale: 'en-US', name: 'Pro Monthly', description: 'Pro for a month.' },
              ],
              price: { baseTerritory: 'USA', customerPrice: 4.99 },
              introductoryOffers: [
                {
                  duration: 'ONE_WEEK',
                  offerMode: 'FREE_TRIAL',
                  numberOfPeriods: 1,
                },
              ],
              play: {
                productId: 'pro_monthly',
                basePlanId: 'monthly',
                prices: { US: { priceMicros: '4990000', currency: 'USD' } },
                offers: [{ offerId: 'trial-7', freeTrialDuration: 'P7D' }],
              },
            },
          ],
        },
      ],
      promotedPurchases: [
        { productId: 'com.acme.pro_monthly', visibleForAllUsers: true, enabled: true },
      ],
    },
  },

  gameCenter: {
    'com.acme.app': {
      achievements: [
        {
          vendorIdentifier: 'first_win',
          referenceName: 'First Win',
          points: 10,
          name: 'First Win',
          beforeEarnedDescription: 'Win a game.',
          afterEarnedDescription: 'You won.',
        },
      ],
      leaderboards: [
        {
          vendorIdentifier: 'high_score',
          referenceName: 'High Score',
          defaultFormatter: 'INTEGER',
          submissionType: 'BEST_SCORE',
          scoreSortType: 'DESC',
          name: 'High Score',
        },
      ],
    },
  },

  appClips: {
    'com.acme.app': {
      clips: {
        'com.acme.app.Clip': {
          action: 'OPEN',
          localizations: { 'en-US': { subtitle: 'Try it instantly' } },
        },
      },
    },
  },

  releaseAttributes: {
    'com.acme.app': {
      categories: { primary: 'PRODUCTIVITY' },
      pricing: { baseTerritory: 'USA', customerPrice: 0 },
      reviewDetails: {
        contactFirstName: 'Ada',
        contactLastName: 'Lovelace',
        contactEmail: 'ada@example.com',
        demoAccountRequired: false,
        notes: 'No login is required.',
      },
    },
  },

  wallet: {
    merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme Pay' }],
    passTypeIds: [{ identifier: 'pass.com.acme.app', name: 'Acme Pass' }],
  },

  euDistribution: {
    domains: [{ domain: 'downloads.example.com', referenceName: 'Acme Downloads' }],
  },
});
