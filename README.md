# Launch

<p align="center">
  <strong>Open-source, self-hosted alternative to <a href="https://docs.expo.dev/eas/">Expo EAS</a> - build, sign, configure your stores, and ship Expo / <a href="https://reactnative.dev/">React Native</a> apps to the <a href="https://developer.apple.com/app-store/">App Store</a> &amp; <a href="https://play.google.com/console/about/">Google Play</a> from one typed launch.config.ts - your machine, your keys. No per-build bill.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/launch-store"><img src="https://img.shields.io/npm/v/launch-store?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/launch-store"><img src="https://img.shields.io/npm/dm/launch-store?logo=npm&color=cb3837" alt="npm downloads" /></a>
  <a href="https://github.com/YosefHayim/launch-store/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/YosefHayim/launch-store/ci.yml?branch=main&logo=github&label=CI" alt="CI status" /></a>
  <a href="https://www.npmjs.com/package/launch-store"><img src="https://img.shields.io/npm/l/launch-store?color=blue" alt="MIT license" /></a>
  <img src="https://img.shields.io/node/v/launch-store?logo=node.js&color=339933" alt="Node version" />
  <img src="https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white" alt="TypeScript types included" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/store%20API-205%20endpoints-8957e5?logo=apple&logoColor=white" alt="205 App Store Connect &amp; Google Play API operations" />
  <img src="https://img.shields.io/badge/CRUD-full%20lifecycle-1f6feb" alt="Full create / read / update / delete coverage across the store APIs" />
  <a href="https://github.com/YosefHayim/launch-store/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/tests-2799%20passing-3fb950?logo=vitest&logoColor=white" alt="2799 tests passing" /></a>
</p>

<p align="center">
   <a href="https://github.com/YosefHayim/launch-store/releases">Releases &amp; changelog</a>
</p>

## Why

Shipping an app is more than a build: signing setup, [App Store Connect](https://developer.apple.com/app-store-connect/) / [Play Console](https://play.google.com/console) config, in-app purchases, subscriptions, capabilities, and listing metadata. EAS builds and submits, then leaves all of that to Apple's and Google's portals. Launch makes the **whole path, store config included, declarative**: from one typed `launch.config.ts` it provisions your signing, reconciles your App Store Connect and Google Play catalog, generates the native project, builds and signs the binary, and uploads an Android bundle. Keys stay in your local keychain. **iOS signing needs a Mac** on the machine that runs the build.

- **The whole release, one workflow.** Signing, store products, build, and upload come from one `launch.config.ts` and a handful of commands.
- **Store setup as code.** `launch sync` reconciles in-app purchases, subscriptions, pricing, and capabilities onto App Store Connect from one typed `launch.config.ts`.
- **$0 compute, unlimited builds.** EAS bills by build, caps the free tier behind a 45-minute timeout, and runs **$19-$199/mo** plus overage on paid plans. Launch builds on your own machine.
- **Your keys stay local.** Your distribution certificate, App Store Connect API key, and Android upload key stay in your OS keychain. Launch only ever sends a CSR to Apple.
- **No lock-in, ever.** MIT-licensed, built on `xcodebuild`, [Gradle](https://gradle.org/), and the platforms' own APIs, with pluggable storage, credentials, build, and submit providers.
- **It teaches as it runs.** Add `--explain` to any command to expand each step into plain English.

**Launch is** an end-to-end release tool: it owns the path from source to store for both iOS and Android, on hardware you own.

**Launch is not** just an App Store Connect SDK or an ASC MCP server. Those wrap a slice of Apple's API. Launch drives the release across Apple **and** Google. If you want a self-hosted Expo EAS, not just an API client, that is Launch.

## Quick start

**Node.js 24+** ([nodejs.org](https://nodejs.org/en)). **iOS needs a Mac** with [Xcode](https://developer.apple.com/xcode/), [CocoaPods](https://cocoapods.org/), an [Apple Developer Program](https://developer.apple.com/programs/enroll/) membership, and an [App Store Connect API key](https://appstoreconnect.apple.com/access/integrations/api). **Android** needs a [JDK](https://openjdk.org/), the [Android SDK](https://developer.android.com/studio) with `ANDROID_HOME` set, and a [Google Play Developer](https://play.google.com/console/signup) account. **iOS on another Mac** uses `launch build ios --remote aws` or `launch build ios --remote user@host`.

Install from [npm](https://www.npmjs.com/package/launch-store):

```bash
npm install --save-dev launch-store
```

Then, from the app:

```bash
npx launch init
npx launch creds set-key
npx launch creds setup
npx launch build ios --dry-run
npx launch build ios
```

The dry run prints `Dry run` and changes nothing. A real iOS run leaves the signed archive on disk after it checks that the app exists. `npx launch build android` uploads the bundle unless you pass `--no-submit`.

## Usage

### Commands

| Command | What it does |
| --- | --- |
| `launch build <ios\|android>` | Prebuild and sign. Android uploads the bundle. iOS leaves the signed archive on disk. |
| `launch release <ios\|android>` | Ship the latest build to the public store, with confirmation. |
| `launch update` | Publish an over-the-air JS update (Expo Updates protocol) to your own bucket. |
| `launch sync` | Reconcile App Store Connect products, pricing, and the listing from `launch.config.ts`. |
| `launch adopt` | Import a live App Store Connect setup into `launch.config.ts`. |
| `launch creds` | Inspect credentials, import the API key, and switch Apple accounts. |
| `launch plan` | Show what `sync` would change. `launch drift --check` exits 2 when the store has drifted. |
| `launch doctor` | Check that the local toolchain and store account are ready. |

`launch --help` lists every command. The same names are filled in, with comments, in the root [`launch.config.ts`](./launch.config.ts). Store commands (`offers`, `reviews`, `metadata`, `game-center`, `app-clips`, `release-config`, `availability`, `custom-pages`, `experiments`, `events`, `accessibility`, `wallet`, `eu-distribution`, `play-products`, `play-subscriptions`, `play-tracks`, `play-reviews`, `play-reports`, `play-pricing`, `testflight`, `rollout`, `release-train`, `snapshot`, `stats`) read that file or a sidecar named there.

> **Driving Launch from an AI agent?** `launch agents init` scaffolds ready-made skills into your repo - [Claude Code](https://code.claude.com/docs/en/overview) Skills (`.claude/skills/`), [Cursor rules](https://cursor.com/docs/rules) (`.cursor/rules/`), and a Launch section in `AGENTS.md` for [Codex](https://developers.openai.com/codex/guides/agents-md) - so Claude Code, Cursor, and Codex can run the workflows above (ship, release, store-config-as-code, OTA updates, CI, and `launch doctor`) with the same plan -> confirm -> apply guardrails Launch uses, and never publish without your say-so. `launch agents check` keeps them in sync.

```sh
claude mcp add --scope user launch -- launch mcp
launch stats --owner mine --days 30
launch stats --app "cal friend" --json
```

### Configuration

App facts (bundle id, version) are read from each app's Expo config, `app.json` or `app.config.{ts,js}`. `launch.config.ts` holds Launch settings. The root [`launch.config.ts`](./launch.config.ts) is a full example of every field: profiles, products, offers, Game Center, App Clips, release, wallet, EU distribution, storage, AWS, notify, and the sidecar paths. `defineConfig` is the public helper. The published [JSON Schema](https://json-schema.org/) is `schema/launch.config.schema.json`. `launch config schema` prints it, and `launch config schema --out launch.config.schema.json` writes a copy for your editor.

```ts
import { defineConfig } from 'launch-store';

export default defineConfig({
  appRoots: ['./examples'],
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  profiles: {
    production: { name: 'production', envFile: '.env', sizeBudgetMB: 200 },
  },
});
```

Unknown keys are kept so `launch config validate` can flag them.

### Credentials

- The API key (`.p8`), distribution private key, and Android upload key live in your **OS keychain**.
- The iOS certificate is also backed up as a password-protected `.p12` under `~/.launch/credentials/` (chmod 600). The password is stored in the keychain, never beside the file.
- Your private key is generated locally. Only a CSR is ever sent to Apple.
- Launch reuses an existing distribution certificate instead of creating new ones.

## How it works

`launch.config.ts` is the desired state. `launch plan` diffs it against the live store and changes nothing. `launch sync` applies that diff after you confirm. `launch adopt` reads a live App Store Connect setup back into the file. `launch build` is local: Android upload goes through the Play API, and the iOS path stops once the signed archive is on disk.

<details>
<summary><strong>Set up &amp; verify</strong></summary>

1. **Config in one step.** `launch init` detects your app(s) - including an `apps/*` monorepo - and writes a commented `launch.config.ts` plus a starter `.env.example`, touching no credentials or native code.
2. **Onboard a live app.** `launch adopt` imports an already-shipping app's App Store Connect setup - products, capabilities, listing, signing - back into `launch.config.ts`.
3. **Keys in your keychain.** `launch creds set-key` validates your `AuthKey_*.p8` against Apple and vaults it in your OS keychain; `creds use`/`rename`/`remove` switch between teams.
4. **APNs push-key vault.** `launch creds push-key` safe-keeps a download-once APNs auth key and re-exports it on demand - Apple exposes no API to recreate one.
5. **Secrets, not plaintext `.env`.** `launch secret set`/`list`/`rm` stores build secrets in your OS keychain, scoped per app/profile, and injects them into the build env.
6. **One-command doctor.** `launch doctor --fix` detects the iOS/Android toolchain, installs the missing brew-able tools behind a single consent, and flags store-side blockers.
7. **Hands-off setup.** `launch setup` scaffolds config, installs tools, renders a readiness board, and rehearses the whole pipeline as a dry run.
8. **Signing status at a glance.** `launch setup ios` reports active account, App ID, capabilities, certificate, profile, and registered devices - with `--provision` to ensure them.

</details>

<details>
<summary><strong>Configure App Store Connect - as code</strong></summary>

Each is declared in `launch.config.ts` (or a `*.config.json` sidecar) and reconciled with a read-only **plan -> your confirmation -> apply** - idempotently, never touching a live or in-review version. This is the surface EAS leaves to the website.

1. **Products, pricing & listing.** `launch sync` reconciles in-app purchases, subscriptions, capabilities, and pricing onto App Store Connect - plus the per-locale listing copy, screenshots, and app previews - across every app at once.
2. **Preview & gate drift.** `launch plan [surface]` diffs `launch.config.ts` against live App Store Connect and Google Play state read-only across every config-as-code surface - capabilities, IAPs, subscriptions, pricing, listing and screenshots, plus release attributes, offers, Game Center, App Clips, availability, accessibility, experiments, custom pages, and team-level Wallet & EU distribution; `launch drift` fails CI when they've diverged.
3. **Subscription offers.** `launch offers` reconciles offer codes and promotional, introductory & win-back offers, plus the promoted-purchase order; `offers generate-codes`/`list`/`deactivate` drive campaigns from the CLI.
4. **Release attributes.** `launch release-config` reconciles the age rating, categories, base price, and App Review details (contact + demo account) onto the editable version.
5. **Store availability.** `launch availability` sets the App Store territories the app sells in.
6. **Custom product pages.** `launch custom-pages` reconciles alternate App Store listings.
7. **Product-page A/B tests.** `launch experiments` reconciles product-page experiments and their treatments, makes the screenshots of each treatment match its `screenshots` folder (Apple pre-fills a new treatment with the original screenshots), then `--submit` sends them to App Review and `--start` starts the approved ones.
8. **In-app events.** `launch events list`/`create`/`localize`/`delete` manages App Store in-app events and their localizations.
9. **Game Center.** `launch game-center` reconciles achievements and leaderboards.
10. **Accessibility labels.** `launch accessibility` reconciles the accessibility nutrition labels.
11. **App Clips.** `launch app-clips` reconciles each App Clip card's action and per-locale subtitle.
12. **Wallet & Apple Pay ids.** `launch wallet` registers Apple Pay merchant ids and Wallet pass type ids.
13. **EU distribution (DMA).** `launch eu-distribution` authorizes alternative-distribution domains and registers the package-signing key.
14. **Listing round-trip.** `launch metadata pull`/`push` syncs the full store listing for iOS _and_ Android - `eas metadata` is iOS-only.

</details>

<details>
<summary><strong>Configure Google Play - as code</strong></summary>

1. **Play products & subscriptions.** `launch play-products` and `launch play-subscriptions` reconcile your Play in-app products and subscriptions (base plans + offers) from the **same** `launch.config.ts` catalog that drives App Store Connect.
2. **Tracks.** `launch play-tracks` shows track status and promotes a build to a track at a chosen rollout with release notes, and reads/sets tester groups.
3. **Play reviews.** `launch play-reviews list`/`reply` reads Play customer reviews (with optional machine translation) and posts replies - without the Play Console.

</details>

<details>
<summary><strong>Build &amp; ship - iOS and Android</strong></summary>

1. **One command per platform.** `launch build ios` / `launch build android` runs prebuild and sign. **Android uploads the bundle.** iOS checks that the app exists and leaves the signed archive on disk.
2. **Platforms.** `launch build` accepts `ios`, `android`, `tvos`, `macos`, and `visionos`.
3. **Flags on this command.** `--dry-run` prints the plan and changes nothing. `--json` prints one JSON object. `--no-submit` skips upload. `-p` selects the profile. `--remote` builds iOS on AWS or over SSH. `--clean` forces a from-scratch build. `--no-ccache` turns ccache off. `--distribution internal` builds an ad-hoc install instead of a store build.
4. **What you see.** A dry run prints `Dry run`. A real run prints the binary path, or one JSON object when you pass `--json`.
5. **Deliberate public release.** The testing track is the default; `launch release <platform>` drives the public store over the API end to end - version, compliance, notes, rollout, submit - with no portal.
6. **Steer the rollout.** `launch status [--watch]` tracks the review with CI exit codes; `launch rollout pause`/`resume`/`complete` steers an iOS phased release.
7. **Coordinated release train.** `launch release-train` drives an app's iOS, Android, and OTA legs as one resumable record - `start`/`status`/`release`/`abort`, with `--hold` to gate every leg until all are approved and release them together, `--platform`/`--no-ota` to scope it, and `--watch` to poll until it settles.
8. **Re-sign without rebuilding.** `launch build:resign` re-signs a stored `.ipa`/`.aab` with different credentials straight from the artifact.
9. **Completion notifications.** A `notify` block pings a Slack/Discord webhook and/or runs a shell hook when a build or submit finishes - on success _and_ failure.

</details>

<details>
<summary><strong>Where a build runs</strong></summary>

1. **iOS needs a Mac.** That Mac can be the machine you start `launch build` on, an EC2 Mac (`launch build ios --remote aws`, settings under `aws` in `launch.config.ts`), or an SSH host (`launch build ios --remote user@host`). `launch cloud` sets up the EC2 Mac.
2. **Android does not need a Mac.** An Android build needs a JDK and the Android SDK.

</details>

<details>
<summary><strong>Distribute &amp; update</strong></summary>

1. **Internal installs.** `launch build ios --distribution internal` builds an ad-hoc install for registered devices. `store` is the default.
2. **Over-the-air updates.** `launch update` publishes a code-signed JS/asset update via the **[Expo Updates](https://docs.expo.dev/versions/latest/sdk/updates/) protocol** your `expo-updates` runtime already speaks, hosted on your own bucket ([S3](https://aws.amazon.com/s3/) / [R2](https://developers.cloudflare.com/r2/) / [Supabase](https://supabase.com/docs/guides/storage)).
3. **Roll back a bad update.** `launch updates list`/`view` show the per-channel history; `launch updates rollback` promotes a known-good update or drops clients back to the embedded bundle.
4. **Pluggable storage.** Artifacts and updates live in local storage or your own S3 / R2 / Supabase bucket, served from a URL you control - no hosted service.

</details>

<details>
<summary><strong>Manage testers, team, reviews &amp; reports - API-key only</strong></summary>

1. **TestFlight from the CLI.** `launch testflight groups`/`create-group`/`testers`/`add`/`rm` manages beta groups and invites testers, and `testflight release` submits a build for Beta App Review - no Apple-ID password, no 2FA.
2. **Reviews, read & reply.** `launch reviews list`/`reply`/`delete` reads App Store reviews (filter by rating/territory) and posts, replaces, or removes the developer response.
3. **Sales, finance & analytics.** `launch reports sales`/`finance`/`analytics` downloads App Store Connect's reports (gzipped TSV, or `--json`) straight to your machine.
4. **Team & access.** `launch team list`/`invite`/`remove` reads and manages App Store Connect team members and pending invitations over the same API key.
5. **Sandbox testers.** `launch sandbox list`/`clear` lists your StoreKit sandbox testers and clears their purchase history for clean in-app-purchase re-tests.

</details>

<details>
<summary><strong>Inspect &amp; debug</strong></summary>

1. **Build history.** `launch builds list`/`view`/`log`/`prune` reads the local artifact index - ids, per-device sizes, paths, and redacted logs - and prunes binaries past the retention window.
2. **Install & run.** `launch run [id|latest]` installs a built artifact onto a connected device (`adb`/`bundletool` for Android, `devicectl` for iOS).
3. **Explain a failure.** `launch diagnose` maps an `xcodebuild`/Gradle/CocoaPods error to a plain-English cause and fix.
4. **Why clean vs incremental.** `launch fingerprint` shows the native fingerprint and why the next build will be clean or incremental.
5. **Tell your Apple accounts apart.** `launch creds` leads its account summary with the app names each API key can see, so you know which Apple account - and which apps - a build will use before you ship.

</details>

<details>
<summary><strong>Onboarding, teaching &amp; maintenance</strong></summary>

1. **Teaching on demand.** `--explain` on any command and `launch explain <topic>` cover the Apple/iOS/Android terminology inline.
2. **Drive it from an AI agent.** `launch agents init`/`check` scaffolds [Claude Code](https://code.claude.com/docs/en/overview) / [Cursor](https://cursor.com/docs/rules) / [Codex](https://developers.openai.com/codex/guides/agents-md) skills so coding agents run the workflows under the same plan -> confirm -> apply guardrails.
3. **CI in one command.** `launch ci init` scaffolds a [GitHub Actions](https://docs.github.com/actions) workflow that builds and ships unattended.
4. **Silent self-upgrade.** A global npm or pnpm install picks up a newer release with that same package manager and re-runs your command on it (or on your next command, if the new copy cannot be found yet); a project install only prints a notice - throttled to once a day, and a no-op in CI, when piped, and for agents.

</details>

### Launch and EAS

| In Expo EAS | In Launch |
| --- | --- |
| Build compute runs on **Expo's cloud**, **$19-$199/mo** + per-build fees | Builds on **your own machine** |
| Builds **queue** in a shared cloud | Builds **start on your hardware** |
| Free-tier builds are **capped at a 45-minute timeout** | A local build has **no Launch timeout** |
| Apple-ID **2FA** prompts interrupt builds | Authenticates with an **App Store Connect API key** |
| **In-app purchases and subscriptions** are hand-work in the ASC UI | `launch sync` reconciles them from `launch.config.ts` |
| `eas metadata` is **iOS-only** | `launch metadata` syncs the listing for **iOS and Android** |
| After `eas submit`, the **App Store release** is portal hand-work | `launch release` drives it over the API |
| Signing **credentials can live on Expo's servers** | Keys stay in **your OS keychain** |
| **No Mac?** EAS's paid cloud is the path | **iOS still needs a Mac**: this machine, `launch build ios --remote aws`, or `--remote user@host` |

## Status and scope

Launch is active, MIT-licensed, and published as [`launch-store`](https://www.npmjs.com/package/launch-store).

**`launch build` accepts `ios`, `android`, `tvos`, `macos`, and `visionos`.** `--remote`, `--clean`, `--no-ccache`, and `--distribution` are real flags. **iOS does not upload the IPA.** The command checks that the app exists and leaves the signed archive on disk. **Android uploads the bundle** unless you pass `--no-submit`.

**`release`, `sync`, and `adopt` change the live store.** They refuse to run without a terminal unless you pass `--yes`.

`plan` is read-only. `drift --check` exits 2 when the store does not match the file.

## Help

<details>
<summary><strong>What is Launch?</strong></summary>

Launch is an open-source, self-hosted alternative to Expo EAS: it builds, signs, and ships Expo / React Native apps to TestFlight and Google Play from your own machine, with your own keys, and no per-build bill. It runs the same build -> submit -> update pipeline EAS does, and adds the store-setup steps EAS leaves to the App Store Connect and Play Console websites - in-app purchases, subscriptions, capabilities, and listing metadata - as code.

</details>

<details>
<summary><strong>Is Launch a free, open-source alternative to Expo EAS?</strong></summary>

Yes. Launch is MIT-licensed and fully open source, and builds run on hardware you own, so there is no per-build fee, build-minute meter, or monthly subscription - versus EAS's $19-$199/mo paid tiers plus per-build overage. iOS still needs a Mac: this one, an EC2 Mac (`--remote aws`), or a Mac you can SSH to.

</details>

<details>
<summary><strong>How is Launch different from Expo EAS?</strong></summary>

EAS runs your builds on Expo's cloud and keeps your credentials, artifacts, and OTA updates on Expo's servers. Launch runs the identical pipeline on your own machine, keeps signing keys in your OS keychain, and stores artifacts and OTA updates in your own bucket (S3 / R2 / Supabase) - then manages the store config EAS does not (IAPs, subscriptions, capabilities, and the iOS and Android listing) as code. The commands map one-for-one: `eas build` -> `launch build`, `eas submit` -> `launch release`, `eas update` -> `launch update`, `eas metadata` -> `launch metadata`, `eas credentials` -> `launch creds`.

</details>

<details>
<summary><strong>Can I build iOS apps without a Mac?</strong></summary>

Not on the machine that starts the command. iOS signing is macOS-only. `launch build ios --remote aws` uses an EC2 Mac, and `--remote user@host` uses a Mac you can SSH to. Android builds anywhere a JDK runs.

</details>

<details>
<summary><strong>Does Launch support Android and Google Play?</strong></summary>

Yes. Launch builds and signs Android apps and uploads them to Google Play, and it reconciles Play in-app products, subscriptions (base plans + offers), release tracks, and review replies from the same `launch.config.ts` catalog that drives App Store Connect - one source of truth for both stores. Existing users can run `launch creds adopt --platform android --app <name>` once for the app that owns the existing Play key and upload keystore. Launch checks that the Play key can read the package and that both keystore passwords work, then copies the credentials without deleting the originals. Existing app credentials are not overwritten unless you pass `--yes`.

</details>

<details>
<summary><strong>Does Launch do over-the-air updates like EAS Update?</strong></summary>

Yes. `launch update` publishes JS and asset updates over the Expo Updates protocol your `expo-updates` runtime already speaks - code-signed and hosted on your own bucket (S3 / R2 / Supabase) instead of Expo's servers. `launch updates rollback` reverses a bad release by promoting a known-good update or dropping clients back to the embedded bundle.

</details>

<details>
<summary><strong>How do I migrate from Expo EAS to Launch?</strong></summary>

Swap the commands one-for-one (`eas build` -> `launch build`, `eas submit` -> `launch release`, `eas update` -> `launch update`, `eas credentials` -> `launch creds`, `eas metadata` -> `launch metadata`). If your app already ships, `launch adopt` reads its live App Store Connect setup - products, capabilities, signing, and listing - and writes it back into `launch.config.ts` in one step. `launch build` does not hand off to `eas build`.

</details>

<details>
<summary><strong>Is Launch just an App Store Connect SDK or MCP wrapper?</strong></summary>

No. An App Store Connect SDK or MCP server wraps a slice of Apple's API. Launch drives the entire release across Apple and Google - code signing, native builds, size checks, store-config-as-code, the confirmed public release, and OTA updates - none of which an API wrapper touches. If you want a self-hosted Expo EAS rather than an API client, that is Launch.

</details>

<details>
<summary><strong>How is Launch different from Fastlane?</strong></summary>

Fastlane is a Ruby toolkit of separate actions; Launch is one typed release pipeline with no Ruby or fastlane to install. Launch runs `xcodebuild` and Gradle directly, talks to the App Store Connect and Google Play APIs itself for builds and store listings, and covers the whole release: credential provisioning, the native build, the real download-size check, store-config-as-code for both stores, the deliberate public release, phased-rollout control, and OTA updates - all from one typed `launch.config.ts`.

</details>

<details>
<summary><strong>Where are my signing keys and secrets stored?</strong></summary>

In your OS keychain. Your App Store Connect API key (`.p8`), distribution private key, and Android upload key never touch the repo or anyone's servers - only a certificate-signing request (CSR) is ever sent to Apple. Build secrets live in the keychain too, via `launch secret`, so they stay out of a committed `.env`.

</details>

<details>
<summary><strong>What do I need to run Launch?</strong></summary>

Node.js 24+ everywhere. For iOS: macOS with Xcode and its command-line tools, CocoaPods, and an App Store Connect API key (`.p8` + Key ID + Issuer ID). For Android: a JDK and the Android SDK with `ANDROID_HOME` set (any OS), and a Google Play service-account JSON key. Run `launch doctor` to check it all at once.

</details>

<details>
<summary><strong>How much does Launch cost?</strong></summary>

Launch itself is free (MIT). You pay only for what you would pay anyway: your own build hardware, plus the usual Apple Developer ($99/yr) and Google Play (one-time $25) registration fees. There is no per-build charge and no subscription.

</details>

<details>
<summary><strong>Does Launch run in CI?</strong></summary>

Yes. `launch ci init` scaffolds a GitHub Actions workflow on a hosted macOS runner, and every command degrades to non-interactive when it detects CI, a piped stdout, or an agent - so the same flow runs unattended.

</details>

<details>
<summary><strong>What frameworks does Launch support?</strong></summary>

Expo and bare React Native apps that describe themselves through Expo config (`app.json` / `app.config.{ts,js}`) and `expo prebuild`. Launch reads your bundle id, version, and entitlements from there, so nothing is duplicated.

</details>

<details>
<summary><strong>Can Launch manage store metadata, in-app purchases, and subscriptions?</strong></summary>

Yes - as code, for both stores. `launch sync` reconciles IAPs, subscriptions, pricing, capabilities, and the per-locale listing (copy, screenshots, previews) onto App Store Connect; `launch metadata` covers the listing for iOS and Android; `launch play-products` / `launch play-subscriptions` drive the Google Play catalog. Each runs a read-only plan -> confirm -> apply, so it never clobbers a live or in-review version.

</details>

<details>
<summary><strong>Does Launch lock me into a hosted service?</strong></summary>

No - there is nothing hosted and nothing proprietary. Launch is MIT-licensed, built on Xcode, Gradle, and the platforms' own APIs, with pluggable storage / credentials / build / submit providers. Your keys, artifacts, and updates live in infrastructure you control (handing a build to Expo EAS is the one exception), so there is nothing to migrate off later.

</details>

<details>
<summary><strong>How do I get started?</strong></summary>

Install with `npm install --global launch-store` (or `--save-dev` per project). Then run: `launch init` -> `launch creds set-key` -> `launch creds setup` -> `launch build ios`.

</details>

## Development

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

npm, yarn, and pnpm can each install this repo. Lockfiles stay untracked. [Vitest](https://vitest.dev/) runs the tests. [Biome](https://biomejs.dev/) lints and formats. See [`AGENTS.md`](./AGENTS.md) for module ownership, the ship-path rules, and how to add a backend.

<p align="center">
  <a href="https://github.com/YosefHayim"><img src="https://github.com/YosefHayim.png?size=120" width="120" alt="YosefHayim" /></a>
</p>

<p align="center">
  <a href="https://github.com/YosefHayim/launch-store/graphs/contributors">All contributors</a>
</p>

## License

MIT
