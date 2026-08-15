# LANGUAGE.md — launch-store

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

## Build & Ship

**platform**
What you _build_ (`ios`, `android`, `tvos`, `macos`, `visionos`) - the build engine + artifact type.
_Avoid_: "store" (a platform is not where you submit).

**store**
Where you _submit_ (a `Submitter`: App Store Connect, Google Play, and later Amazon Appstore / Galaxy Store / AppGallery). One Android build can fan out to several stores.
_Avoid_: "platform" (a store is not what you compile).

**archive**
The compiled, signed app bundle Xcode produces before export (the `.xcarchive`); exporting it yields the uploadable `.ipa`.

**artifact**
A built, uploadable binary: an `.ipa` (iOS) or `.aab` (Android). Stored with a newest-first index by the storage provider.

**code signing**
Stamping the app with your distribution certificate / upload key so the store and device can verify origin and integrity.

**size report**
The honest per-device download/install size, computed _before_ upload: from Xcode's App Thinning Size Report (iOS) or bundletool (Android).

## Configuration

**profile**
A named set of build settings in `launch.config.ts` (default `production`); selects env, track, rollout, etc.
_Avoid_: "provisioning profile" (Apple signing asset).

**reconcile**
Launch treats `launch.config.ts` as the _desired state_ and makes the live store match it (the GitOps loop). Declarative and additive - safe to re-run.

**plan**
The read-only half of the GitOps loop. `launch plan` diffs desired vs. live and prints what `sync` _would_ change, touching nothing.

**drift**
The same read as `plan`, graded for CI: exit `0` in sync, `2` on drift.

**adopt**
The reverse of reconcile - `launch adopt` reads live ASC setup and writes it back into `launch.config.ts`.

**migrate**
File-based onboarding: `launch migrate` reads an existing EAS/fastlane setup off disk and emits the equivalent Launch config.

## App Store Connect

**App Store version**
The per-release record on ASC (one per marketing version): review state, attached build, release type, "What's New" notes.

**review submission**
Apple's container for what you send to App Review. `launch release` drives it over the API.

**release type**
How an approved build reaches the public: `AFTER_APPROVAL` (default), `MANUAL`, or `SCHEDULED`.

**phased release**
Apple's 7-day staged rollout - growing user percentage per day. Opt in with `--phased`.

**export compliance**
Apple's encryption question every build must answer before shipping. Standard HTTPS is exempt.

**subscription group**
Apple's container for mutually-exclusive subscription tiers (e.g. Monthly vs. Yearly).

**subscription offer**
A discounted entry price: introductory, promotional, or offer code. Immutable once created.

## Release Coordination

**release train**
One app's iOS + Android + OTA release coordinated as a single record with per-platform "cars".

**store readiness**
Account-level prerequisites a store needs before accepting a submission.

**submission readiness**
The full set a store checks at submission time (bundle id, cert, compliance, etc.).

**IAP readiness**
Whether declared in-app purchases exist on ASC and are submittable.

**store snapshot**
A read-only, point-in-time copy of your live catalog, for reversible automation.

## OTA Updates

**OTA update**
Ship a JS/asset-only change via the Expo Updates protocol without a new store build.

**runtime version**
Contract between a native build and the updates it can accept.

**channel**
A named stream of updates (e.g. `production`, `staging`) a build subscribes to.

## Store Surfaces

**store metadata**
Your listing (name, subtitle, description, keywords, release notes, URLs).

**AI store assets**
Listing copy drafted by a model - fills versioned files, plan->confirm->apply still gates it.

**App Clip**
A tiny, install-free slice of your app from a link/NFC/QR.

**Game Center**
Apple's gaming network (achievements, leaderboards).

**in-app event**
A timed, discoverable happening (tournament, premiere) surfaced on your product page.

**custom product page**
An alternate listing reachable by unique URL for targeted campaigns.

**product page optimization**
Apple's A/B test of listing variants (icon/screenshots/text).

**Wallet pass / Apple Pay ids**
Team-level identifiers for signing passes and processing Apple Pay.

**privacy declarations**
What your app says it collects (Apple's privacy manifest, Play's Data Safety).

**accessibility nutrition labels**
Apple's 2025 declarations of supported accessibility features.

**EU alternative distribution**
IOS distribution from your own domains under the DMA.

**app availability**
The set of App Store territories your app sells in.

**store review**
A customer's public rating + comment, plus your developer reply.

**store reports**
Bulk data: Sales & Trends, Finance (TSV), Analytics reports.

**review insights**
Synthesis over raw reviews: rating trends, sentiment, reply rate.
