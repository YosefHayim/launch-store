import { defineConfig } from "launch-store";

/**
 * Kitchen-sink Launch config for one dual-platform (iOS + Android) Expo app.
 *
 * Everything Launch can configure-as-code is turned on here so this file doubles as a feature tour —
 * see README.md for the file-by-file + command-by-command walkthrough. App FACTS (bundle id, version,
 * capabilities, export compliance) are NOT here: they live in `app.json` and Launch reads them straight
 * from Expo's config, exactly where EAS reads them. This file holds only Launch's own settings.
 *
 * `launch init` scaffolds a minimal version of this (providers + one profile + commented sections).
 * The five Launch-native App Store Connect sections — Game Center, App Clips, release attributes,
 * Wallet, and EU distribution — are typed fields right here (issue #101); their standalone
 * `*.config.json` sidecars still work for back-compat. Only `store.config.json` remains a deliberate
 * sidecar: its `apple` section mirrors the Expo/EAS metadata schema verbatim (the `eas metadata`
 * migration path).
 *
 * Want a zero-setup local build to play with? The only fields you must change are `storage: "local"`
 * (drop `storageConfig`) and you can ignore `aws`. Everything else is parse-valid and dry-run-able as is.
 */
export default defineConfig({
  // ── Providers ────────────────────────────────────────────────────────────────────────────────────
  // Swappable backends, resolved by name from the registry (src/providers). The iOS defaults below
  // auto-swap to their Android twins on `launch build android`: `fastlane` → `gradle`, and
  // `app-store-connect` → `google-play`. So a dual-platform app names the iOS side and gets Android free.
  credentials: "local", // your own Apple/Play keys, kept in the OS keychain — never in this repo
  storage: "s3", // artifacts + OTA manifests on your own bucket (configured in `storageConfig`)
  buildEngine: "fastlane", // iOS archives via fastlane `gym`; Android auto-uses `gradle`
  submit: "app-store-connect", // iOS → TestFlight/App Store; Android auto-uses `google-play`

  // Where to scan for apps (each app is a folder with an `app.json`). Defaults to the repo root; a
  // monorepo would use `["apps/*"]`. Here the single app sits beside this config.
  appRoots: ["."],

  // ── Build profiles ───────────────────────────────────────────────────────────────────────────────
  // A profile bundles the env + size budget + Android release defaults for one kind of build.
  // Select one with `launch build ios --profile <name>`.
  profiles: {
    production: {
      name: "production",
      envFile: ".env.production", // committed, non-secret build-time config
      sizeBudgetMB: 200, // soft-gate (confirm) if a device download would exceed this
      track: "production", // Android: default Play track for `launch build android`
      rollout: 0.25, // Android: staged rollout to 25% of users on a production release
    },
    preview: {
      name: "preview",
      envFile: ".env.preview",
      env: { EXPO_PUBLIC_DEBUG_OVERLAY: "true" }, // inline env layers ON TOP of the dotenv file
      ssl: true, // enable SSL pinning for this profile
      sizeBudgetMB: 150,
      track: "internal", // Android: ship previews to the internal testing track
    },
  },

  // ── App Store Connect product catalog (`launch sync` / `launch offers`) ─────────────────────────────
  // Declarative desired-state of the app's monetization, keyed by iOS bundle id (must match
  // app.json `ios.bundleIdentifier`). `launch sync` creates/updates the products + prices; `launch
  // offers` reconciles the subscription offers and the promoted-purchase ordering. The gap EAS leaves.
  products: {
    "com.example.helloworld": {
      subscriptionGroups: [
        {
          referenceName: "Hello Pro",
          localizations: [{ locale: "en-US", name: "Hello Pro" }],
          subscriptions: [
            {
              productId: "com.example.helloworld.pro.monthly",
              referenceName: "Pro Monthly",
              subscriptionPeriod: "ONE_MONTH",
              localizations: [{ locale: "en-US", name: "Pro Monthly", description: "Unlimited taps, billed monthly." }],
              price: { customerPrice: 4.99 },
              // First-time auto-applied 1-week free trial (a FREE_TRIAL offer carries no price).
              introductoryOffers: [{ duration: "ONE_WEEK", offerMode: "FREE_TRIAL", numberOfPeriods: 1 }],
              // Developer-presented in-app discount (referenced from StoreKit by `offerCode`).
              promotionalOffers: [
                {
                  name: "Win-back 50% off",
                  offerCode: "promo-halfoff",
                  duration: "ONE_MONTH",
                  offerMode: "PAY_AS_YOU_GO",
                  numberOfPeriods: 3,
                  prices: [{ territory: "USA", customerPrice: 2.49 }],
                },
              ],
            },
            {
              productId: "com.example.helloworld.pro.yearly",
              referenceName: "Pro Yearly",
              subscriptionPeriod: "ONE_YEAR",
              localizations: [{ locale: "en-US", name: "Pro Yearly", description: "Unlimited taps, billed yearly." }],
              price: { customerPrice: 39.99 },
              // Redeemable promo-code campaign granting a 1-month free trial to new customers.
              offerCodes: [
                {
                  name: "Launch week",
                  customerEligibilities: ["NEW"],
                  offerEligibility: "REPLACE_INTRO_OFFERS",
                  duration: "ONE_MONTH",
                  offerMode: "FREE_TRIAL",
                  numberOfPeriods: 1,
                },
              ],
              // App Store offer shown to lapsed subscribers, with auto-generated promo artwork.
              winBackOffers: [
                {
                  offerId: "comeback-2026",
                  referenceName: "Come back 2026",
                  duration: "THREE_MONTHS",
                  offerMode: "PAY_AS_YOU_GO",
                  numberOfPeriods: 1,
                  prices: [{ territory: "USA", customerPrice: 19.99 }],
                  eligiblePaidMonths: 3,
                  monthsSinceLastSubscribed: { min: 1, max: 6 },
                  startDate: "2026-01-01",
                  priority: "NORMAL",
                  promotionIntent: "USE_AUTO_GENERATED_ASSETS",
                },
              ],
            },
          ],
        },
      ],
      inAppPurchases: [
        {
          productId: "com.example.helloworld.removeads",
          referenceName: "Remove Ads",
          type: "NON_CONSUMABLE",
          localizations: [{ locale: "en-US", name: "Remove Ads", description: "Hide all ads forever." }],
          price: { customerPrice: 0.99 },
        },
        {
          productId: "com.example.helloworld.coins.100",
          referenceName: "100 Coins",
          type: "CONSUMABLE",
          localizations: [{ locale: "en-US", name: "100 Coins", description: "A pile of 100 in-game coins." }],
          price: { customerPrice: 1.99 },
        },
      ],
      // Surfaced on the App Store product page, in this display order (`launch offers` reorders to match).
      promotedPurchases: [
        { productId: "com.example.helloworld.pro.yearly" },
        { productId: "com.example.helloworld.removeads", visibleForAllUsers: true, enabled: true },
      ],
    },
  },

  // ── Build/submit completion notifications (`launch build`, `launch release`) ────────────────────────
  // Fired on success AND failure, best-effort (never blocks/fails the build). Set a webhook, a shell
  // command, or both. The command sees the event as LAUNCH_* env vars.
  notify: {
    webhookUrl: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    command: "echo Launch: $LAUNCH_APP $LAUNCH_VERSION finished $LAUNCH_STATUS",
  },

  // ── iOS public-release policy (`launch release`, `launch rollout`) ──────────────────────────────────
  // Defaults applied to the App Store version `launch release` submits. NOTE: this is the release
  // *behavior* (when/how it goes live). The release *attributes* (age rating, categories, price, review
  // contact) are the `releaseAttributes` field below, applied by `launch release-config`.
  release: {
    releaseType: "AFTER_APPROVAL", // go live automatically once Apple approves
    phasedRelease: true, // Apple's 7-day gradual rollout for the update
    usesNonExemptEncryption: false, // standard HTTPS only → Launch clears export compliance over the API
    primaryLocale: "en-US",
    releaseNotes: { "en-US": "Faster taps, fewer bugs, and a brand-new Pro tier." },
  },

  // ── Game Center achievements & leaderboards (`launch game-center`) ──────────────────────────────────
  // Per-app (keyed by iOS bundle id). Reconciled additively to App Store Connect — re-runs only create
  // what's missing. Single-config form of the old gamecenter.config.json.
  gameCenter: {
    "com.example.helloworld": {
      achievements: [
        {
          vendorIdentifier: "first_tap",
          referenceName: "First Tap",
          points: 10,
          showBeforeEarned: true,
          repeatable: false,
          name: "First Tap",
          beforeEarnedDescription: "Tap the button for the very first time.",
          afterEarnedDescription: "You tapped the button. A journey of a thousand taps begins.",
        },
        {
          vendorIdentifier: "hundred_taps",
          referenceName: "Century",
          points: 50,
          name: "Century",
          beforeEarnedDescription: "Reach 100 taps in a single session.",
          afterEarnedDescription: "100 taps. Your finger is now a machine.",
        },
      ],
      leaderboards: [
        {
          vendorIdentifier: "top_tappers",
          referenceName: "Top Tappers",
          defaultFormatter: "INTEGER",
          submissionType: "BEST_SCORE",
          scoreSortType: "DESC",
          name: "Top Tappers",
        },
      ],
    },
  },

  // ── App Clip card metadata (`launch app-clips`) ─────────────────────────────────────────────────────
  // Per-app (keyed by the parent app's bundle id); each clip keyed by its OWN bundle id. The clip binary
  // comes from a build target — this configures the card's action + subtitle.
  appClips: {
    "com.example.helloworld": {
      clips: {
        "com.example.helloworld.Clip": {
          action: "OPEN",
          localizations: { "en-US": { subtitle: "Play instantly, no install" } },
        },
      },
    },
  },

  // ── App Store release attributes (`launch release-config`) ──────────────────────────────────────────
  // Per-app (keyed by iOS bundle id): age rating, store categories, base price, and App Review details.
  // Distinct from `release` above (that's the release *policy*). Single-config form of release.config.json.
  releaseAttributes: {
    "com.example.helloworld": {
      ageRating: {
        violenceCartoonOrFantasy: "NONE",
        profanityOrCrudeHumor: "NONE",
        matureOrSuggestiveThemes: "NONE",
        gambling: false,
        unrestrictedWebAccess: false,
      },
      categories: { primary: "GAMES", secondary: "ENTERTAINMENT" },
      pricing: { baseTerritory: "USA", customerPrice: 0 }, // free
      reviewDetails: {
        contactFirstName: "Ada",
        contactLastName: "Lovelace",
        contactPhone: "+1-555-0100",
        contactEmail: "review@helloworld.example",
        demoAccountRequired: false,
        notes: "Tap the big button to raise the score. No account or login required.",
      },
    },
  },

  // ── Apple Pay merchant ids & Wallet pass type ids (`launch wallet`) ─────────────────────────────────
  // Team-level (not per-app) — these Identifiers are shared across the team. Registered additively.
  wallet: {
    merchantIds: [{ identifier: "merchant.com.example.helloworld", name: "Hello World Payments" }],
    passTypeIds: [{ identifier: "pass.com.example.helloworld.coupon", name: "Hello World Coupon" }],
  },

  // ── EU alternative-distribution domains, DMA (`launch eu-distribution`) ─────────────────────────────
  // Team-level. Authorizes the domains you host distribution packages from. The signing key is a
  // register-once action (`launch eu-distribution set-key`), not declared here.
  euDistribution: {
    domains: [{ domain: "downloads.example.com", referenceName: "Hello World EU downloads" }],
  },

  // ── AWS EC2 Mac settings for off-Mac builds (`launch build ios --remote aws`, `launch cloud`) ────────
  // Launch stores NO AWS secrets — credentials resolve through the standard SDK chain (env, ~/.aws, SSO).
  aws: {
    region: "us-east-1",
    instanceType: "mac2.metal", // cheapest M-series EC2 Mac in most regions
  },

  // ── Cloud artifact storage (used because `storage: "s3"` above) ─────────────────────────────────────
  // Where Launch writes IPAs/AABs, ad-hoc install links, and OTA update manifests, served from your own
  // domain. This example targets Cloudflare R2 (S3-compatible). Access keys are NOT here — they resolve
  // from env vars / the OS secret store at call time.
  storageConfig: {
    endpoint: "https://<account-id>.r2.cloudflarestorage.com",
    bucket: "helloworld-artifacts",
    region: "auto", // correct for R2
    publicBaseUrl: "https://cdn.helloworld.example",
  },
});
