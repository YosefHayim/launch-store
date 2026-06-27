# CONTEXT

Project + architecture context for **Launch** — the domain map the engineering skills read before
exploring. For the working rules (module ownership, code patterns, the validation gate) see
[`AGENTS.md`](./AGENTS.md); for Launch-specific domain terms see **Language** below; for the React
Native / Expo / Apple / Google stack see [`TECH-GLOSSARY.md`](./TECH-GLOSSARY.md).

## Language

The ubiquitous language of **Launch** — use these terms (not synonyms) in code, issues, commits,
and docs. The **runtime** source of truth is [`src/core/glossary.ts`](./src/core/glossary.ts), which
powers `launch explain <topic>` and the `--explain` step expansions. Keep the two aligned.

**archive**:
The compiled, signed app bundle Xcode produces before export (the `.xcarchive`); exporting it yields
the uploadable `.ipa`.

**artifact**:
A built, uploadable binary: an `.ipa` (iOS) or `.aab` (Android). Stored with a newest-first index by
the storage provider.

**platform**:
What you _build_ (`ios`, `android`, `tvos`, `macos`, `visionos`) — the build engine + artifact type.
_Avoid_: store (a platform is not where you submit).

**store**:
Where you _submit_ (a `Submitter`: App Store Connect, Google Play, and later Amazon Appstore / Galaxy
Store / AppGallery). One Android build can fan out to several stores via a per-platform `submit` map
in `launch.config.ts`. They're no longer 1:1 with platform.
_Avoid_: platform (a store is not what you compile).

**profile**:
A named set of build settings in `launch.config.ts` (default `production`); selects env, track,
rollout, etc.
_Avoid_: provisioning profile (Apple signing asset).

**code signing**:
Stamping the app with your distribution certificate / upload key so the store and device can verify
origin and integrity.

**size report**:
The honest per-device download/install size, computed _before_ upload: from Xcode's App Thinning Size
Report (iOS) or bundletool (Android).

**App Store version**:
The per-release record on App Store Connect (one per marketing version): its review state, the attached
build, the release type, and the "What's New" notes. `launch release` creates or reuses the editable
one, attaches the build, and submits it. The unit Apple reviews and ships, separate from TestFlight.

**review submission**:
Apple's container for what you send to App Review. `launch release` drives it over the API (create →
add the version as an item → submit), so you never click "Submit for Review"; re-running resumes an
in-progress submission instead of duplicating it.

**release type**:
How an _approved_ build reaches the public store: `AFTER_APPROVAL` (auto-release on approval, the
default), `MANUAL` (you press release), or `SCHEDULED` (a date you set). Set in `launch.config.ts`
(`release.releaseType`) or per-run with `--manual` / `--scheduled <iso>`.

**phased release**:
Apple's optional 7-day staged rollout of an approved _update_ — a growing percentage of users per day
so a regression reaches few people. Opt in with `launch release --phased`, then pause/resume/finish
with `launch rollout`. Applies only to updates (a first version always ships to 100%).

**export compliance**:
Apple's encryption question every build must answer before shipping. Standard HTTPS/system crypto is
exempt; Launch declares that over the API (`usesNonExemptEncryption=false`) so the build clears
"Waiting for Export Compliance" with no portal trip. Set `release.usesNonExemptEncryption` true only
for proprietary/non-exempt encryption.

**release train**:
One app's whole release coordinated across iOS, Android, and OTA as a single record; each platform
(and each OTA follower) is a "car". `launch release-train start` submits every car; `status`
reconciles forward (each car releases on its own approval, an OTA bundle publishes once its native
platform is live). `--hold` waits until all are approved, then releases together.

**store readiness**:
The account-level prerequisites a store needs before it accepts a submission (an ASC app record, a
Play app the service account can reach, a first Play upload). None involve the build, so a green build
can still be unshippable. `launch store doctor` grades them live (exit 2 on a blocker).

**submission readiness**:
The full set a store checks at _submission_: a registered bundle id, a valid distribution
certificate, a declared export-compliance answer, plus the account basics. `launch audit` reads every
submit blocker live and grades it (exit 2 on a blocker) as a pre-release gate.

**IAP readiness**:
Whether the in-app purchases/subscriptions your config declares actually exist on App Store Connect
and are submittable (not stuck in `MISSING_METADATA`). The most error-prone surface: a green build
says nothing about whether buying works. `launch iap doctor` grades each declared product against its
live state (exit 2 on a blocker).

**store snapshot**:
A read-only, point-in-time copy of your live ASC + Play catalog (products, subscriptions, states),
saved as a named record under `~/.launch/snapshots`. The trustworthy "before" that makes destructive
store automation reversible: capture, run `launch sync`, then `launch snapshot diff` to see what
moved.

**subscription group**:
Apple's container for mutually-exclusive subscription tiers; a customer holds at most one active
subscription per group (e.g. Monthly vs Yearly of one plan), and upgrades/downgrades move them between
levels. Declared in `launch.config.ts` and reconciled onto ASC by reference name (the group's natural
key).

**subscription offer**:
A discounted/free entry price on a subscription: **introductory** (a new customer's first-time deal),
**promotional** (win-back/retention for lapsed or current users), or an **offer code** (a redeemable
code). Apple makes offer terms immutable once created, so `launch offers` only _adds_ missing offers —
never edits or deletes (deactivating a code is the explicit `launch offers deactivate`), making it
safe to re-run.

**reconcile**:
Launch treats `launch.config.ts` as the _desired state_ and makes the live store match it (the GitOps
loop, applied to ASC and Play). Declarative and additive: each object is matched on its natural key
and created/updated only where it diverges, so a reconcile is safe to re-run. `launch sync`
reconciles the whole config; `offers` and others reconcile one surface.

**plan**:
The read-only half of the GitOps loop. `launch plan` diffs `launch.config.ts` (desired) against live
store + signing state (actual) and prints what `sync` _would_ change, touching nothing.

**drift**:
The same read as `plan`, graded for CI (`plan --check`): exit `0` in sync, `2` on drift, `1` on
error. See `docs/adr/0003-plan-drift.md`.

**adopt**:
The reverse of reconcile, for an app that _already ships_. `launch adopt` reads your live ASC setup
(products, capabilities, signing, listing) and writes it back into a populated, reviewable
`launch.config.ts` (+ `app.json` entitlements + `store.config.json`), so a hand-built or EAS app
comes under config-as-code in one command. See `docs/adr/0002-adopt-existing-app.md`.

**migrate**:
The file-based onboarding path (vs. `adopt`, which reads a live account). `launch migrate` reads an
existing EAS (`eas.json`/`app.json`) or fastlane setup off disk and emits the equivalent Launch
config plus a report of what to finish by hand. Read-only against both stores.

**OTA update**:
Ship a JS/asset-only change to installed apps without a new store build, using the Expo Updates
protocol your app embeds (`expo-updates`). `launch update` exports the bundle and writes a signed
manifest to your bucket.

**runtime version**:
The contract between a native build and the OTA updates it can accept. An update only loads if its
runtime version matches the installed app's, so a JS change needing new native code can't ship over
the air by mistake.

**channel**:
A named stream of OTA updates (e.g. `production`, `staging`) a build subscribes to, so you can push
JS to beta testers without touching production. The manifest is keyed by channel + platform +
runtime version.

**store metadata**:
Your listing (name, subtitle, description, keywords, release notes, URLs). Synced from a versioned
`store.config.json` (Expo's iOS schema + an `android` extension) via fastlane `deliver`/`supply`, so
the listing lives in your repo.

**AI store assets**:
Store listing material drafted by a model instead of by hand: listing copy today (`launch ai
listing`), with generated assets the concept extends to. It only fills the versioned files
(`store.config.json`), so the plan→confirm→apply loop stays the safety rail — it never touches a
store.

**App Clip**:
A tiny, install-free slice of your app that opens from a link, NFC tag, or QR code so a user can do
one task (pay, park, order) without the full download. The "App Clip card" is the sheet shown first;
`launch app-clips` reconciles its action + per-locale subtitle from `appclips.config.json`.

**Game Center**:
Apple's gaming network (achievements, leaderboards, multiplayer) layered onto your app as a trophy
case and scoreboard. Both are configured per app on ASC; `launch game-center` reconciles your
achievements and leaderboards from `gamecenter.config.json` over the API.

**in-app event**:
A timed, discoverable happening inside your app (a tournament, premiere, live stream) that Apple
surfaces on your product page and in Search to pull users back. `launch events` reads and manages the
event records + their localized copy; scheduling, media, and review stay on ASC.

**custom product page**:
An alternate version of your App Store listing (its own screenshots and promotional text) reachable by
a unique URL, so a campaign or audience lands on tailored copy. `launch custom-pages` reconciles each
page and its promotional text from `custom-pages.config.json` over the API.

**product page optimization** (PPO):
Apple's built-in A/B test of your listing: up to three treatment variants of icon/screenshots/text
served to a slice of App Store traffic to see which converts best. `launch experiments` reconciles the
experiment and its treatment arms (Apple's v2 model) from config.

**Wallet pass / Apple Pay ids**:
Team-level identifiers that authorize signing Wallet passes and processing Apple Pay; they gate the
payment/pass certificates and are otherwise hand-registered in Certificates, Identifiers & Profiles.
`launch wallet` reconciles them from `wallet.config.json` over the API.

**privacy declarations**:
What your app says it collects and why: Apple's privacy manifest / App Privacy label and Play's Data
Safety form. A mismatch with the permissions your code actually uses is a common, opaque rejection;
`launch privacy scan` reconciles the statically-readable surface against your manifest (the published
labels are UI-only).

**accessibility nutrition labels**:
Apple's 2025 declarations of which accessibility features your app supports (VoiceOver, larger text,
captions), shown on the product page. `launch accessibility` reconciles them from
`accessibility.config.json` over the API with the plan→confirm→apply flow.

**EU alternative distribution**:
Under the EU's Digital Markets Act, iOS apps may ship from your own web domains or alternative
marketplaces, not only the App Store — which needs authorized domains plus a registered signing key.
`launch eu-distribution` reconciles the authorized domains from config over the API.

**app availability**:
The set of App Store territories your app sells in. Apple treats it as one atomic set — you replace
the whole list, not toggle one country. `launch availability` reconciles the territories from
`availability.config.json` over the API, so where you sell lives in code.

**store review**:
A customer's public rating + comment, plus the single developer reply you can post back. `launch
reviews` (App Store) and `launch play-reviews` (Play) read them and manage that reply over the API —
the local equivalent of the Ratings & Reviews / Reviews pages, which EAS doesn't touch at all.

**store reports**:
The bulk data behind your dashboards: Sales & Trends, Finance (gzipped TSV), and the multi-step
Analytics reports. `launch reports sales|finance|analytics` downloads them from ASC with the API key
alone, decompresses, and writes the files — the bulk side EAS never offered.

**review insights**:
The synthesis over raw reviews: average rating, per-star distribution, reply rate, sentiment split,
and a month-by-month ratings trend, across both stores at once. `launch insights` aggregates what
`reviews` / `play-reviews` already pull; no new data source, just the trends on top.

## What Launch is

Launch is an open-source CLI (`launch`, published to npm as `launch-store`) that **builds and ships
your iOS and Android apps to the App Store and Google Play from your own machine** — your Apple/Google
credentials, your hardware, no Expo/EAS bill. It targets Expo/React Native apps: it prebuilds the
native project, archives and signs it, estimates the store download size, stores the artifact, and
uploads it to the testing track (a separate, deliberate command does the public release).

The product goal is a "boring, traceable" path from source to store that an individual developer can
run and understand, with an `--explain` mode that teaches the why and the terminology as it goes — and a
first-run `launch demo` that simulates the whole pipeline (no config, build, or account needed) so a
newcomer sees the flow before committing to it.

## Ecosystem primer (new to React Native / Expo / EAS?)

If the terms below are unfamiliar, read this first; every italicized word is defined term-by-term in
[`TECH-GLOSSARY.md`](./TECH-GLOSSARY.md) (or run `launch explain <topic>`). The stack, bottom to top:

1. **Your code is _React Native_** — one TypeScript/React codebase that runs as a real native iOS +
   Android app. **_Expo_** sits on top of it so you describe the app once in **_app.json_** (name,
   icons, version, permissions, _config plugins_) instead of editing native projects by hand.
2. **_prebuild_ generates the native projects.** `expo prebuild` turns `app.json` into real `ios/`
   and `android/` folders. From there it's ordinary native tooling: on iOS, **_Xcode_** (compiler +
   signing, macOS-only) driven by **_fastlane_**, with native libraries from **_CocoaPods_**; on
   Android, **_Gradle_** (needs only a JDK, no Mac).
3. **Publishing needs accounts + signing.** Apple: an **_Apple Developer Program_** membership, the
   **_App Store Connect_** portal/API, and a chain of signing assets (_bundle id_ → _CSR_ →
   _distribution certificate_ → _provisioning profile_) so a build can be _code-signed_ and sent to
   **_TestFlight_**. Google: the **_Play Console_**, a _service account_ for its API, and an _upload
   key_ under _Play App Signing_. Launch automates all of this except the handful of one-time steps
   the APIs genuinely can't do (creating the _app record_, signing _agreements_, enrolling Play App
   Signing) — for those it deep-links you to the right page.
4. **_EAS_ is the thing Launch replaces.** EAS (Expo Application Services) is Expo's _paid cloud_ that
   runs steps 2–3 on their servers and hosts _OTA updates_. Launch does the same steps on **your own
   machine and accounts** for $0 — and can still _hand off_ to `eas-cli` if you have no Mac.

So Launch's place in the world: it owns the orchestration (`app.json` → prebuild → sign → build →
size-check → store → submit), and delegates the heavy lifting to the same native tools Expo/EAS use
(Xcode/fastlane, Gradle, the ASC and Play APIs) — just locally, transparently, and without the bill.

## The core flow: build → sign → submit

`src/core/pipeline.ts` is the single linear spine; its phases are named in `src/core/phases.ts`
(`PIPELINE_PHASES`), the canonical list the first-run tour also narrates. One `launch build <platform>`
runs, in order:

1. **Resolve app + profile + env** — pick the app from `launch.config.ts`, validate `.env`.
2. **Prebuild** — `expo prebuild` only if there's no native `ios/` / `android/` yet.
3. **Resolve credentials** — signing assets from the OS keychain (provisioning the Apple resources on first run).
4. **Build** — fastlane `gym` (iOS) or Gradle `:app:bundleRelease` (Android), with manual signing.
5. **Size report** — per-device download/install from Xcode's thinning report or bundletool.
6. **Store** — copy the artifact into local (or pluggable) storage with a newest-first index.
7. **Submit** — upload to TestFlight / the Play testing track by default (`--no-submit` stops after the build).

`launch release <platform>` is the **separate** public path: it takes the latest stored artifact and,
after an explicit confirmation, submits it to the App Store review queue / Play production track.
Keeping public release out of `launch build` is what makes an accidental public release impossible.

`--dry-run` rehearses the entire flow with no network call, build, or account change.

## Architecture / module map

One TypeScript / Node ESM package, four areas under `src/`:

| Path            | Owns                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli`       | Thin `commander` wiring — one file per command, each attaching via a `register*` function.                                                                                                                                                                             |
| `src/core`      | The domain: `types`, the `pipeline` (+ `remotePipeline` / `easPipeline`) and its `phases`, the provider `registry`, the first-run `tour` / `firstRun` marker, and `exec` / `paths` / `glossary` / `logger` / `progress` / `config` / `env` / `toolchain` / `keychain`. |
| `src/providers` | The swappable backends, grouped by role: `build`, `storage`, `credentials`, `submit`, `compute`.                                                                                                                                                                       |
| `src/apple`     | The App Store Connect integration (JWT auth, bundle ids, certs, profiles). The import-only APNs push-key vault lives beside it in `core/pushKeyStore.ts`.                                                                                                              |
| `src/google`    | The Google Play integration (service-account auth, upload keystore, Play client).                                                                                                                                                                                      |

## The provider model

Infrastructure is swappable behind five interfaces in `src/core/types.ts`: `BuildEngine`,
`StorageProvider`, `CredentialsProvider`, `Submitter`, `ComputeHost`. A backend is a named object
implementing one interface, registered in `src/providers/index.ts`. The pipeline resolves the
backend by the `name` in the user's `launch.config.ts`, so adding or swapping infrastructure never
touches `pipeline.ts`. Built-ins today: build `fastlane` / `gradle` / `eas`; storage `local`;
submit App Store Connect / Google Play; compute AWS EC2 Mac / BYO-SSH.

The **build platform** (what you compile — `ios`/`android`/`tvos`/`macos`/`visionos`) and the **store**
(where you submit — a `Submitter`) are deliberately decoupled: `config.submit` is either one submitter name
or a per-platform map, and `resolveSubmitters(config, platform)` returns the store **list** a build fans out
to (one Android `.aab` → Google Play + Amazon, etc.). The four Apple platforms share one App Store Connect
account, certificate, and submitter — they differ only in the Xcode build destination, the ASC platform
attribute, and the signing-profile type, all centralized in `src/core/platform.ts`. This is the seam new
stores and new Apple platforms extend; see `docs/adr/0006-platform-store-split.md` and
`docs/adr/0007-apple-platform-family.md`.

## State, secrets, and platforms

- **Secrets never touch the repo.** The `.p8` / `.p12` / private keys live in the OS keychain;
  `~/.launch` holds only non-secret paths, ids, and caches (artifacts, the credentials index, logs).
- **iOS needs a Mac.** When you're off a Mac, `--remote` builds on a remote host — AWS EC2 Mac
  (`src/providers/compute/awsEc2Mac.ts`, via `remotePipeline.ts`) or your own Mac over SSH — or
  `buildEngine: "eas"` hands the build off to Expo's cloud (`easPipeline.ts`).
- **Android builds anywhere** Gradle + a JDK run (no Mac required).

## Where to look first

- A new command → `src/cli/commands/` + `src/cli/index.ts`.
- The end-to-end flow → `src/core/pipeline.ts`.
- A new backend → the matching interface in `src/core/types.ts` + a file under `src/providers/<role>/`.
- Domain terms / teaching copy → `src/core/glossary.ts` (runtime), **Language** above, and [`TECH-GLOSSARY.md`](./TECH-GLOSSARY.md) (stack).
