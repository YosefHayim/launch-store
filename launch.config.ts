import { defineConfig } from 'launch-store';

/**
 * Full example of every setting launch.config.ts can hold.
 * App facts (bundle id, version, entitlements) stay in each app's app.json.
 * Keys stay in the OS keychain. This file is safe to read and to copy.
 * `launch config validate` checks it. `launch plan` shows the store diff and changes nothing.
 */
export default defineConfig({
  // Where Launch looks for app.json / app.config.ts. `launch init` fills this in.
  appRoots: ['./examples'],

  // macOS Keychain plus ~/.launch. `launch creds` reads and writes this store.
  credentials: 'local',

  // Where build artifacts and OTA files go. `local` is ~/.launch/artifacts.
  // `s3`, `r2`, and `supabase` need storageConfig below. `launch update` needs one of those.
  storage: 'local',

  // Who compiles the native app. `xcode` is local. `remote-mac` is `launch cloud` / `launch build ios --remote`.
  // `eas` hands the compile to Expo and is the migrate path, not the default.
  buildEngine: 'xcode',

  // Who receives a finished binary. Android upload uses the Play submitter.
  // iOS `launch build` leaves the signed archive on disk. `launch release` is the public ship.
  submit: 'app-store-connect',

  // `missing` runs expo prebuild only when the native project is absent. `always` prebuilds every build.
  prebuild: 'missing',

  // How long built artifacts stay under artifactDir. `launch builds prune` uses this.
  artifactRetentionDays: 30,

  // Env names Launch will not copy into a build or a log.
  envExclude: ['ASC_PRIVATE_KEY'],

  // AWS region for `launch cloud` and `launch build ios --remote aws`. No AWS secrets belong here.
  aws: {
    region: 'us-east-1',
  },

  // Required only when storage is s3, r2, or supabase. `launch update` publishes to publicBaseUrl.
  storageConfig: {
    bucket: 'acme-launch-artifacts',
    region: 'us-east-1',
    publicBaseUrl: 'https://updates.example.com',
  },

  // Fired by `launch` after build, submit, review, or rollout events. The URL is not a secret.
  notify: {
    webhookUrl: 'https://example.com/launch-hook',
    events: ['build', 'submit', 'review', 'rollout'],
  },

  // What `launch mcp` is allowed to do. `read` and `dryRun` never change the store.
  mcp: {
    capabilities: ['read', 'dryRun'],
  },

  // `launch release` reads this. It does not set the age rating, categories, or review contact.
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
    // `launch build ios --profile production` and `launch build android --profile production`.
    production: {
      name: 'production',
      envFile: '.env',
      sizeBudgetMB: 200,
      track: 'internal',
      rollout: 1,
    },
    // A second profile for internal installs. `launch build ios --profile preview --distribution internal`.
    preview: {
      name: 'preview',
      envFile: '.env.preview',
      sizeBudgetMB: 250,
      track: 'internal',
      ssl: true,
    },
  },

  // One catalog for both stores. Keyed by the iOS bundle id.
  // `launch sync` writes the App Store side. `launch play-products` and `launch play-subscriptions` write Play.
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

  // `launch game-center`. Keyed by bundle id.
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

  // `launch app-clips`. The key is the parent app. The inner key is the clip bundle id.
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

  // `launch release-config`. Age rating, categories, price, and the App Review contact.
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

  // `launch wallet`. Team-level Apple Pay merchant ids and Wallet pass type ids.
  wallet: {
    merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme Pay' }],
    passTypeIds: [{ identifier: 'pass.com.acme.app', name: 'Acme Pass' }],
  },

  // `launch eu-distribution`. Team-level alternative-distribution domains.
  euDistribution: {
    domains: [{ domain: 'downloads.example.com', referenceName: 'Acme Downloads' }],
  },

  // Sidecar files for the surfaces that are not inline objects.
  // `launch availability`, `launch accessibility`, `launch experiments`, `launch custom-pages`.
  configFiles: {
    availability: 'availability.config.json',
    accessibility: 'accessibility.config.json',
    experiments: 'experiments.config.json',
    customPages: 'custom-pages.config.json',
  },
});
