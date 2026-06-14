import { defineConfig } from "launch-store";

/**
 * Example Launch config for a single app. App facts (bundle id, version) come from app.json — this
 * file only holds Launch settings. `launch init` generates one like this tailored to your repo.
 */
export default defineConfig({
  credentials: "local", // your own keys, cached in the macOS Keychain
  storage: "local", // build artifacts in ~/.launch/artifacts
  buildEngine: "fastlane",

  profiles: {
    production: {
      name: "production",
      envFile: ".env",
      sizeBudgetMB: 200,
    },
  },

  // Declarative App Store Connect product catalog, keyed by iOS bundle id (must match app.json's
  // `ios.bundleIdentifier`). `launch sync` reconciles these onto App Store Connect — the gap EAS leaves.
  // Capabilities are NOT declared here: they're read from `app.json` `ios.entitlements` automatically.
  products: {
    "com.example.helloworld": {
      subscriptionGroups: [
        {
          referenceName: "Pro",
          localizations: [{ locale: "en-US", name: "Pro" }],
          subscriptions: [
            {
              productId: "com.example.helloworld.pro.monthly",
              referenceName: "Pro Monthly",
              subscriptionPeriod: "ONE_MONTH",
              localizations: [{ locale: "en-US", name: "Pro Monthly", description: "All features, billed monthly." }],
              price: { customerPrice: 4.99 },
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
      ],
    },
  },
});
