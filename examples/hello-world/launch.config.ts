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
 * The product catalog is store-agnostic: each subscription/IAP can carry a `play` override that
 * publishes the same product to Google Play (`launch play-subscriptions` / `launch play-products`),
 * because Apple's fixed price points and Play's literal micro-unit money don't map 1:1.
 *
 * Want a zero-setup local build to play with? The only fields you must change are `storage: "local"`
 * (drop `storageConfig`) and you can ignore `aws`. Everything else is parse-valid and dry-run-able as is
 * (a declared `reviewScreenshot` with no file on disk is reported as a skip, never an error).
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

  // ── Backend-only env (never injected into a build) ──────────────────────────────────────────────────
  // A hard denylist over the resolved env, enforced across every layer (`.env`, `.env.<profile>`,
  // keychain, inline `env:`, even an explicit `--env`). These names are dropped outright, so a backend
  // secret kept in the app's `.env` for local server tooling can never be bundled into the shipped app —
  // not even if an `app.config.js` forwards `process.env`. Each entry is an exact name OR a `PREFIX*`
  // wildcard: `OPENAI_*` drops `OPENAI_API_KEY`, `OPENAI_ORG_ID`, … in one line (wildcards anchor at the
  // start, so a publishable `EXPO_PUBLIC_..._KEY` is never caught). Different from `launch secret set`,
  // which still INJECTS the value (the build needs it) and only moves it out of plaintext. A name matched
  // here is also exempt from the `.env.example` missing-key gate.
  envExclude: ["OPENAI_*", "GEMINI_*", "STRIPE_SECRET_KEY", "SENTRY_AUTH_TOKEN"],

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
  // Each subscription/IAP can add a `play` override to also publish to Google Play (see those fields).
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
              // App Review screenshot Apple requires before a subscription can be submitted. Path is
              // relative to the app dir; `launch sync` uploads it idempotently (skipped if unchanged, and
              // reported as a skip — not an error — when the file is absent). Drop your PNG at this path.
              reviewScreenshot: "store/review/pro-monthly.png",
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
              // Google Play twin: publish this same subscription to Play via `launch play-subscriptions`.
              // Apple's price points can't express Play's per-region micro-unit money, so Play pricing is
              // declared here. Launch maps this to one auto-renewing base plan (period from above).
              play: {
                basePlanId: "p1m", // defaults to a slug of the billing period when omitted
                prices: {
                  US: { priceMicros: "4990000", currency: "USD" }, // $4.99
                  DE: { priceMicros: "4990000", currency: "EUR" }, // €4.99
                },
                offers: [
                  { offerId: "monthly-free-trial", freeTrialDuration: "P1W" }, // matches the Apple intro offer
                  {
                    offerId: "monthly-intro-50",
                    introPrices: { US: { priceMicros: "2490000", currency: "USD" } }, // $2.49 intro phase
                    introRecurrenceCount: 3, // repeats for the first 3 billing periods
                  },
                ],
              },
            },
            {
              productId: "com.example.helloworld.pro.yearly",
              referenceName: "Pro Yearly",
              subscriptionPeriod: "ONE_YEAR",
              localizations: [{ locale: "en-US", name: "Pro Yearly", description: "Unlimited taps, billed yearly." }],
              price: { customerPrice: 39.99 },
              // Territory-scoped intro offer with a real price + date window (the FREE_TRIAL shorthand
              // above omits both). At most one intro offer applies per (subscription, territory).
              introductoryOffers: [
                {
                  territory: "USA",
                  duration: "THREE_MONTHS",
                  offerMode: "PAY_AS_YOU_GO",
                  numberOfPeriods: 1,
                  price: { territory: "USA", customerPrice: 29.99 },
                  startDate: "2026-01-01",
                  endDate: "2026-12-31",
                },
              ],
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
                  waitBetweenOffersMonths: 6, // don't show another win-back within 6 months
                  startDate: "2026-01-01",
                  endDate: "2026-12-31",
                  priority: "NORMAL",
                  promotionIntent: "USE_AUTO_GENERATED_ASSETS",
                },
              ],
              // Google Play twin for the yearly level.
              play: {
                basePlanId: "p1y",
                prices: {
                  US: { priceMicros: "39990000", currency: "USD" }, // $39.99
                  DE: { priceMicros: "39990000", currency: "EUR" }, // €39.99
                },
              },
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
          // Google Play twin: publish as an active managed product via `launch play-products`.
          play: {
            defaultPrice: { priceMicros: "990000", currency: "USD" }, // $0.99 in every region without an override
            prices: { DE: { priceMicros: "990000", currency: "EUR" } }, // per-region override
          },
        },
        {
          productId: "com.example.helloworld.coins.100",
          referenceName: "100 Coins",
          type: "CONSUMABLE",
          localizations: [{ locale: "en-US", name: "100 Coins", description: "A pile of 100 in-game coins." }],
          price: { customerPrice: 1.99 },
          play: {
            sku: "coins_100", // Play SKU; defaults to the Apple product id when omitted
            defaultPrice: { priceMicros: "1990000", currency: "USD" }, // $1.99
          },
        },
        {
          // A one-off, time-boxed unlock that does NOT auto-renew — Apple's third IAP kind.
          productId: "com.example.helloworld.seasonpass",
          referenceName: "Season Pass",
          type: "NON_RENEWING_SUBSCRIPTION",
          localizations: [{ locale: "en-US", name: "Season Pass", description: "All content for one season." }],
          price: { customerPrice: 9.99 },
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
    // With `releaseType: "SCHEDULED"`, set `earliestReleaseDate` to the ISO-8601 instant to go live at:
    // earliestReleaseDate: "2026-07-01T09:00:00Z",
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
        // No login → demoAccountRequired stays false; set it true plus demoAccountName/demoAccountPassword
        // when a reviewer must sign in to reach gated content (the password is never read back or logged).
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
    profile: "default", // named profile in ~/.aws; omit to use the default credential chain
    instanceType: "mac2.metal", // cheapest M-series EC2 Mac in most regions
    amiId: "ami-0abcd1234example0", // BYO golden AMI; omit to bootstrap + snapshot one on first use
  },

  // ── Cloud artifact storage (used because `storage: "s3"` above) ─────────────────────────────────────
  // Where Launch writes IPAs/AABs, ad-hoc install links, and OTA update manifests, served from your own
  // domain. This example targets Cloudflare R2 (S3-compatible). Access keys are NOT here — they resolve
  // from env vars / the OS secret store at call time. (`supabaseUrl` is the Supabase-only field, unused by s3.)
  storageConfig: {
    endpoint: "https://<account-id>.r2.cloudflarestorage.com",
    bucket: "helloworld-artifacts",
    region: "auto", // correct for R2
    publicBaseUrl: "https://cdn.helloworld.example",
  },

  // ── Local artifact retention (`launch builds prune`) ────────────────────────────────────────────────
  // How many days the `local` artifact store keeps a build binary before auto-pruning it to reclaim disk;
  // the newest build per app+platform is always kept. Defaults to 30; `0` disables the automatic sweep.
  // Only the `local` storage provider observes this — cloud stores use their bucket's own lifecycle rules.
  artifactRetentionDays: 30,
});
