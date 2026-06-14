# Hello World — the full-feature Launch example

A single, runnable, **dual-platform (iOS + Android)** Expo app wired to **every feature Launch can
configure as code**. It's a tiny one-button tap game; the point isn't the app, it's the config around
it. Use it as a reference when setting up your own project, or copy the folder and swap in your ids.

Every file here works with **today's** shipped CLI. (Folding the six `*.config.json` sidecars into the
single typed `launch.config.ts` is planned — tracked in issue #101 — so this example will get simpler.)

## Run it

```bash
cd examples/hello-world
npm install            # install the Expo app deps (optional — only needed to start the RN app)
npx expo start         # run the tap game in a simulator/device

# Then explore Launch against this config. --dry-run rehearses every step with no real changes:
launch doctor                       # check toolchain + store account
launch sync --dry-run               # plan the App Store Connect product catalog
launch build ios --dry-run          # rehearse the build → sign → submit pipeline
launch build android --dry-run      # the Android leg (gradle → AAB → Play internal track)
```

> Run all `launch` commands **from this directory** — each `*.config.json` sidecar is resolved relative
> to the current directory, and the app is discovered from `app.json` here.

> **Want zero cloud setup?** This config is intentionally maximal. For a purely local build, edit
> `launch.config.ts`: set `storage: "local"` and remove `storageConfig` (and ignore `aws`). Everything
> else runs as-is. Real builds still need your own Apple/Play keys via `launch creds` / `launch secret`.

## What's in here

| File                                                             | What it is                                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.json`                                                       | Expo app facts — bundle id, `android.package`, version, capabilities, export compliance. The source of truth Launch reads (never duplicated in `launch.config.ts`). |
| `App.tsx` / `package.json` / `babel.config.js` / `tsconfig.json` | The minimal runnable Expo app (a tap counter).                                                                                                                      |
| `launch.config.ts`                                               | The one **typed** config: providers, profiles, the product catalog (subscriptions, offers, IAP, promoted), release policy, notifications, AWS, and cloud storage.   |
| `.env.production` / `.env.preview`                               | Committed, **non-secret** per-profile build env. (Secrets go in `launch secret`.)                                                                                   |
| `.env.example`                                                   | Template documenting the env keys; copy to `.env` for local overrides.                                                                                              |
| `gamecenter.config.json`                                         | Game Center achievements + a leaderboard → `launch game-center`.                                                                                                    |
| `appclips.config.json`                                           | App Clip card action + subtitle → `launch app-clips`.                                                                                                               |
| `eu-distribution.config.json`                                    | EU (DMA) alternative-distribution domain → `launch eu-distribution`.                                                                                                |
| `wallet.config.json`                                             | Apple Pay merchant id + Wallet pass type id → `launch wallet`.                                                                                                      |
| `release.config.json`                                            | App Store release attributes — age rating, categories, price, review contact → `launch release-config`.                                                             |
| `store.config.json`                                              | Store listing text for **both** stores (Apple + Android) → `launch metadata` / `launch sync`.                                                                       |

## Feature → where it's configured → how it's applied

Everything below is demonstrated by a real file in this folder.

| Feature                                                 | Configured in                                | Applied by                                       |
| ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Build engine / storage / submit backends                | `launch.config.ts` (providers)               | every command, resolved by name                  |
| Build profiles + env ladder + SSL pinning + size budget | `launch.config.ts` profiles, `.env.*`        | `launch build ios\|android --profile <name>`     |
| Android Play track + staged rollout                     | `launch.config.ts` profile `track`/`rollout` | `launch build android`, `launch release android` |
| Subscriptions (monthly + yearly group)                  | `launch.config.ts` `products`                | `launch sync`                                    |
| Intro / promotional / offer-code / win-back offers      | `launch.config.ts` subscription offers       | `launch offers`                                  |
| In-app purchases (consumable + non-consumable)          | `launch.config.ts` `inAppPurchases`          | `launch sync`                                    |
| Promoted purchases (product-page order)                 | `launch.config.ts` `promotedPurchases`       | `launch offers`                                  |
| iOS release policy (type, phased, notes)                | `launch.config.ts` `release`                 | `launch release ios`, `launch rollout`           |
| Build/submit notifications (webhook + hook)             | `launch.config.ts` `notify`                  | `launch build`, `launch release`                 |
| Remote (off-Mac) AWS EC2 Mac build                      | `launch.config.ts` `aws`                     | `launch build ios --remote aws`, `launch cloud`  |
| Cloud artifact + OTA storage                            | `launch.config.ts` `storageConfig`           | `launch build`, `launch update`                  |
| App capabilities + export compliance                    | `app.json` `ios.entitlements` / `ios.config` | `launch sync`, `launch release`                  |
| Game Center achievements + leaderboards                 | `gamecenter.config.json`                     | `launch game-center`                             |
| App Clip card metadata                                  | `appclips.config.json`                       | `launch app-clips`                               |
| EU alternative distribution (DMA)                       | `eu-distribution.config.json`                | `launch eu-distribution`                         |
| Apple Pay / Wallet identifiers                          | `wallet.config.json`                         | `launch wallet`                                  |
| Release attributes (age/category/price/review)          | `release.config.json`                        | `launch release-config`                          |
| Store listing text (iOS + Android)                      | `store.config.json`                          | `launch metadata push`, `launch sync`            |

## The rest of the CLI (no config file needed)

These commands operate on your account, devices, or build history rather than a config file. Run
`launch <command> --help` for flags, or see the [Commands table in the root README](../../README.md#commands).

- **Set up:** `launch init` · `launch doctor` · `launch diagnose` · `launch explain <topic>` · `launch demo`
- **Build & inspect:** `launch build <ios|android>` · `launch builds [list|view|log]` · `launch fingerprint` · `launch run [id|latest]` · `launch build:resign [id|latest]`
- **Credentials & secrets:** `launch creds [status|set-key|setup|use|push-key]` · `launch secret [list|set|rm]`
- **Release & rollout:** `launch release <ios|android>` · `launch status [--watch]` · `launch rollout <pause|resume|complete>`
- **Testing & devices:** `launch testflight [groups|testers|add|rm]` · `launch device [add|list]`
- **OTA updates:** `launch update --channel <name>` · `launch updates [list|view|rollback]`
- **Insights:** `launch reviews [list|reply|delete]` · `launch reports [sales|finance|analytics]`
- **Remote & CI:** `launch cloud [setup|status|teardown|doctor]` · `launch ci init`

## Secrets never live in this folder

The `.p8` / `.p12` / keystore material stays in your OS keychain — imported with `launch creds` and
`launch secret`, never written here or committed. The `.env.*` files hold only public, build-time
config (anything prefixed `EXPO_PUBLIC_` reaches the app bundle). `storageConfig` and `aws` carry
bucket names and regions, not access keys — those resolve from your environment at call time.
