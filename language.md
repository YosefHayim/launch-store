# LANGUAGE

The ubiquitous language of **Launch** — the words this project uses, defined once. Use these terms
(not synonyms) in code, issues, commits, and docs. This is the human/agent-readable reference; the
**runtime** source of truth is [`src/core/glossary.ts`](./src/core/glossary.ts), which powers
`launch explain <topic>` and the `--explain` step expansions. Keep the two aligned — when you add a
glossary topic in code, add it here too.

It's written for someone **new to the React Native / Expo / Apple / Google ecosystem**: the first
sections explain the stack your app is built on before the Launch-specific terms. Run
`launch explain <topic>` (e.g. `launch explain provisioning-profile`) for the same definitions in
your terminal.

## Frameworks & the ecosystem

- **React Native** — the framework that lets you write one TypeScript/React codebase that runs as a real native iOS + Android app (not a web page in a shell). Your screens and logic live here; Launch turns that codebase into store-ready binaries.
- **Expo** — a batteries-included toolkit on top of React Native: a config-driven `app.json`, prebuilt native modules, and the `expo` CLI. You describe the app once instead of hand-editing native code. Launch targets Expo apps.
- **EAS** (Expo Application Services) — Expo's _paid cloud_ that builds, signs, submits, and hosts OTA updates on their servers. It's the metered bill Launch replaces by doing the same steps on your own machine and accounts.
- **app.json / app.config.js** (app config) — the single source of truth for an Expo app: name, bundle id, icons, version, permissions, config plugins. Launch reads it to know what to build and treats its version fields as the floor for bumps.
- **config plugin** — a function that edits the native project _during_ `expo prebuild` (adds an entitlement, an Info.plist key, a Gradle line). How an Expo app customizes native code while staying config-driven — declared in `app.json`, not hand-patched after.
- **prebuild** — `expo prebuild`: turns `app.json` + config plugins into a real native `ios/`/`android/` project (Info.plist, Podfile, `.xcodeproj`, Gradle). `app.json` stays the single source of truth; no native files are hand-maintained.
- **Metro** — React Native's JavaScript bundler. It packs your TS/JS + assets into the single bundle that ships inside the app and that OTA updates replace. `expo export` runs Metro to produce the bundle `launch update` publishes.

## Flow & artifacts

- **archive** — the compiled, signed app bundle Xcode produces before export (the `.xcarchive`); exporting it yields the uploadable `.ipa`.
- **artifact** — a built, uploadable binary: an `.ipa` (iOS) or `.aab` (Android). Stored with a newest-first index by the storage provider.
- **platform vs store** — two concepts Launch keeps distinct. A **platform** is what you _build_ (`ios`, `android`, and later `tvos`/`macos`/`visionos`) — the build engine + artifact type. A **store** is where you _submit_ (a `Submitter`: App Store Connect, Google Play, and later Amazon Appstore / Galaxy Store / AppGallery). They're no longer 1:1 — one Android build can fan out to several stores via a per-platform `submit` map in `launch.config.ts`. See `docs/adr/0006-platform-store-split.md`.
- **profile** — a named set of build settings in `launch.config.ts` (default `production`); selects env, track, rollout, etc. (Not to be confused with a _provisioning profile_.)
- **code signing** — stamping the app with your distribution certificate / upload key so the store and device can verify origin and integrity.
- **size report** — the honest per-device download/install size, computed _before_ upload: from Xcode's App Thinning Size Report (iOS) or bundletool (Android).

## iOS / Apple — program & portal

- **Apple Developer Program** — the paid ($99/yr) membership that lets you create certificates, sign apps, and publish. Everything Launch does on the Apple side needs an active membership; `launch doctor` surfaces account problems first.
- **App Store Connect** (ASC) — Apple's web portal + API for apps, builds, TestFlight, and your listing. Launch drives its API for everything scriptable; the few things the API can't do, it points you to the website to finish.
- **app record** — the app's entry in App Store Connect. The one thing Apple's API can't create (no `POST /v1/apps`) — made once on the website. `launch doctor` detects when it's missing and deep-links you to it.
- **agreements** — Apple's paid-apps/developer agreements; an unsigned/expired one fails signing & upload with a 403. `launch doctor` probes for this up front.
- **team & roles** — the people with access to your App Store Connect account and what each may do (the "Users and Access" page) — account-wide, not app-scoped. `launch team list|invite|remove` reads members + pending invitations and manages access over the API, behind a confirm on the writes.

## iOS / Apple — toolchain

- **Xcode** — Apple's toolchain (compiler, signing, simulators). Runs only on macOS, which is why an iOS build needs a Mac (yours, a remote one, or EAS). Launch never opens Xcode's UI — it drives the command-line build through fastlane.
- **fastlane** — the open-source Ruby toolkit that automates Apple's build/upload steps. Launch drives its actions: **gym** (archive + sign + export the `.ipa`), **pilot** (TestFlight upload), **deliver** (App Store + metadata).
- **CocoaPods / Podfile** — the iOS native-dependency manager. `pod install` reads the Podfile `expo prebuild` generates and fetches native pods, pinned in `Podfile.lock` (which feeds the build fingerprint).
- **Keychain** — the OS's encrypted secret store (macOS Keychain; Credential Manager / libsecret elsewhere). Launch keeps signing keys, certificates, and API keys here — never in the repo or `~/.launch`.

## iOS / Apple — identity & signing

- **ASC API key** — App Store Connect API key: a `.p8` private key + Key ID + Issuer ID. Authenticates Launch to Apple for managing credentials and uploading, with no password/2FA — what makes the CLI scriptable.
- **bundle id** (App ID) — the app's unique identifier, e.g. `com.loopi.pomedero`. Launch registers it over the API before a profile references it.
- **Team ID** — the 10-character identifier for your Apple developer team (e.g. `ABCDE12345`); scopes your bundle ids, certificates, and profiles. Launch stamps it into the build so the right team's assets are used.
- **CSR** — Certificate Signing Request: the public half of a locally generated key pair, sent to Apple to be signed into a certificate. The private key never leaves the machine.
- **distribution certificate** — proves Apple trusts you to sign release builds. Created from a local CSR, imported into the Keychain, and reused (Apple caps you at ~2–3).
- **provisioning profile** — ties the bundle id to a certificate + entitlements; for the store it's an "App Store" profile. Installed where Xcode looks.
- **entitlements** — the capabilities an app may use (push, iCloud, app groups). They must match what the provisioning profile grants or signing fails; `expo prebuild` generates them from `app.json`.
- **bundle id capability** — a service an _App ID_ is allowed to use (push, associated domains, app groups, iCloud). Set on the App ID and must match the app's entitlements or signing fails. Launch syncs them over the API from `launch.config.ts` — enabling what you added, disabling the managed ones you removed, leaving already-correct ones (and sub-settings) untouched.
- **APNs auth key** — a `.p8` your backend uses to send push notifications. Apple has _no_ API to create one (download-once, portal-only, max 2 per account), so `launch creds push-key` only imports and vaults it in your keychain — Launch never sends push itself.
- **UDID** — the unique hardware id of an iPhone/iPad. Ad-hoc installs only run on devices whose UDID is on the profile — register each with `launch device add`. The App Store/TestFlight don't need UDIDs.
- **re-signing** — swapping the signing identity on an _already-built_ artifact (a different cert/profile, or another Apple account during a migration) without paying for a full rebuild. `launch build:resign` pulls a build from local history, re-signs it with the cached credentials, and writes a new `.ipa`/`.aab`.

## iOS — versioning & download size

- **build number** (`CFBundleVersion`) — must be unique and higher than the last for the same version. Launch queries ASC and auto-bumps.
- **marketing version** (`CFBundleShortVersionString`) — the human version users see, e.g. `1.2.0`, separate from the build number. Launch reads the versions already on ASC and suggests the next bump.
- **app thinning** — Apple strips assets/architectures a device doesn't need, so the real download is smaller than the `.ipa`. Xcode's App Thinning Size Report gives the per-device size; Launch reads it before TestFlight.

## Distribution & testing

- **TestFlight** — Apple's pre-release testing track and the safe default for `launch build`. Public App Store release is the separate `launch release`.
- **ad-hoc / internal distribution** — an install link for testers without TestFlight. iOS serves an ad-hoc `.ipa` (valid only for registered UDIDs) via an `itms-services` manifest; Android serves the `.apk` directly. Both host on _your_ own bucket — `launch build --distribution internal`.
- **sandbox tester** — a special Apple ID that buys your in-app purchases against StoreKit's _test_ environment (no real money), so you can verify the purchase flow before release. `launch sandbox` lists the account's testers and clears their purchase history (the local "Clear Purchase History" button).

## App Store release lifecycle

- **App Store version** — the per-release record on App Store Connect (one per marketing version): its review state, the attached build, the release type, and the "What's New" notes. `launch release` creates or reuses the editable one, attaches the build, and submits it. The unit Apple reviews and ships, separate from TestFlight.
- **review submission** — Apple's container for what you send to App Review. `launch release` drives it over the API (create → add the version as an item → submit), so you never click "Submit for Review"; re-running resumes an in-progress submission instead of duplicating it.
- **release type** — how an _approved_ build reaches the public store: `AFTER_APPROVAL` (auto-release on approval, the default), `MANUAL` (you press release), or `SCHEDULED` (a date you set). Set in `launch.config.ts` (`release.releaseType`) or per-run with `--manual` / `--scheduled <iso>`.
- **phased release** — Apple's optional 7-day staged rollout of an approved _update_ — a growing percentage of users per day so a regression reaches few people. Opt in with `launch release --phased`, then pause/resume/finish with `launch rollout`. Applies only to updates (a first version always ships to 100%).
- **export compliance** — Apple's encryption question every build must answer before shipping. Standard HTTPS/system crypto is exempt; Launch declares that over the API (`usesNonExemptEncryption=false`) so the build clears "Waiting for Export Compliance" with no portal trip. Set `release.usesNonExemptEncryption` true only for proprietary/non-exempt encryption.
- **release train** — one app's whole release coordinated across iOS, Android, and OTA as a single record; each platform (and each OTA follower) is a "car". `launch release-train start` submits every car; `status` reconciles forward (each car releases on its own approval, an OTA bundle publishes once its native platform is live). `--hold` waits until all are approved, then releases together.

## Store readiness & state (read-only)

- **store readiness** — the account-level prerequisites a store needs before it accepts a submission (an ASC app record, a Play app the service account can reach, a first Play upload). None involve the build, so a green build can still be unshippable. `launch store doctor` grades them live (exit 2 on a blocker).
- **submission readiness** — the full set a store checks at _submission_: a registered bundle id, a valid distribution certificate, a declared export-compliance answer, plus the account basics. `launch audit` reads every submit blocker live and grades it (exit 2 on a blocker) as a pre-release gate.
- **IAP readiness** — whether the in-app purchases/subscriptions your config declares actually exist on App Store Connect and are submittable (not stuck in `MISSING_METADATA`). The most error-prone surface: a green build says nothing about whether buying works. `launch iap doctor` grades each declared product against its live state (exit 2 on a blocker).
- **store snapshot** — a read-only, point-in-time copy of your live ASC + Play catalog (products, subscriptions, states), saved as a named record under `~/.launch/snapshots`. The trustworthy "before" that makes destructive store automation reversible: capture, run `launch sync`, then `launch snapshot diff` to see what moved.

## In-app purchases — subscriptions & offers

- **subscription group** — Apple's container for mutually-exclusive subscription tiers; a customer holds at most one active subscription per group (e.g. Monthly vs Yearly of one plan), and upgrades/downgrades move them between levels. Declared in `launch.config.ts` and reconciled onto ASC by reference name (the group's natural key).
- **subscription offer** — a discounted/free entry price on a subscription: **introductory** (a new customer's first-time deal), **promotional** (win-back/retention for lapsed or current users), or an **offer code** (a redeemable code). Apple makes offer terms immutable once created, so `launch offers` only _adds_ missing offers — never edits or deletes (deactivating a code is the explicit `launch offers deactivate`), making it safe to re-run.

## Config-as-code — the GitOps loop

- **reconcile** — Launch treats `launch.config.ts` as the _desired state_ and makes the live store match it (the GitOps loop, applied to ASC and Play). Declarative and additive: each object is matched on its natural key and created/updated only where it diverges, so a reconcile is safe to re-run. `launch sync` reconciles the whole config; `offers` and others reconcile one surface.
- **plan / drift** — the read-only half of the loop. `launch plan` diffs `launch.config.ts` (desired) against live store + signing state (actual) and prints what `sync` _would_ change, touching nothing. `launch drift` is the same read graded for CI (`plan --check`): exit `0` in sync, `2` on drift, `1` on error. See `docs/adr/0003-plan-drift.md`.
- **adopt** — the reverse of reconcile, for an app that _already ships_. `launch adopt` reads your live ASC setup (products, capabilities, signing, listing) and writes it back into a populated, reviewable `launch.config.ts` (+ `app.json` entitlements + `store.config.json`), so a hand-built or EAS app comes under config-as-code in one command. See `docs/adr/0002-adopt-existing-app.md`.
- **migrate** — the file-based onboarding path (vs. `adopt`, which reads a live account). `launch migrate` reads an existing EAS (`eas.json`/`app.json`) or fastlane setup off disk and emits the equivalent Launch config plus a report of what to finish by hand. Read-only against both stores.

## OTA updates & store listing

- **OTA update** — ship a JS/asset-only change to installed apps without a new store build, using the Expo Updates protocol your app embeds (`expo-updates`). `launch update` exports the bundle and writes a signed manifest to your bucket.
- **runtime version** — the contract between a native build and the OTA updates it can accept. An update only loads if its runtime version matches the installed app's, so a JS change needing new native code can't ship over the air by mistake.
- **channel** — a named stream of OTA updates (e.g. `production`, `staging`) a build subscribes to, so you can push JS to beta testers without touching production. The manifest is keyed by channel + platform + runtime version.
- **store metadata** — your listing (name, subtitle, description, keywords, release notes, URLs). Synced from a versioned `store.config.json` (Expo's iOS schema + an `android` extension) via fastlane `deliver`/`supply`, so the listing lives in your repo.
- **AI store assets** — store listing material drafted by a model instead of by hand: listing copy today (`launch ai listing`), with generated assets the concept extends to. It only fills the versioned files (`store.config.json`), so the plan→confirm→apply loop stays the safety rail — it never touches a store.

## App Store growth & merchandising

- **App Clip** — a tiny, install-free slice of your app that opens from a link, NFC tag, or QR code so a user can do one task (pay, park, order) without the full download. The "App Clip card" is the sheet shown first; `launch app-clips` reconciles its action + per-locale subtitle from `appclips.config.json`.
- **Game Center** — Apple's gaming network (achievements, leaderboards, multiplayer) layered onto your app as a trophy case and scoreboard. Both are configured per app on ASC; `launch game-center` reconciles your achievements and leaderboards from `gamecenter.config.json` over the API.
- **in-app event** — a timed, discoverable happening inside your app (a tournament, premiere, live stream) that Apple surfaces on your product page and in Search to pull users back. `launch events` reads and manages the event records + their localized copy; scheduling, media, and review stay on ASC.
- **custom product page** — an alternate version of your App Store listing (its own screenshots and promotional text) reachable by a unique URL, so a campaign or audience lands on tailored copy. `launch custom-pages` reconciles each page and its promotional text from `custom-pages.config.json` over the API.
- **product page optimization** (PPO) — Apple's built-in A/B test of your listing: up to three treatment variants of icon/screenshots/text served to a slice of App Store traffic to see which converts best. `launch experiments` reconciles the experiment and its treatment arms (Apple's v2 model) from config.
- **Wallet pass / Apple Pay ids** — team-level identifiers that authorize signing Wallet passes and processing Apple Pay; they gate the payment/pass certificates and are otherwise hand-registered in Certificates, Identifiers & Profiles. `launch wallet` reconciles them from `wallet.config.json` over the API.

## Privacy, compliance & accessibility

- **privacy declarations** — what your app says it collects and why: Apple's privacy manifest / App Privacy label and Play's Data Safety form. A mismatch with the permissions your code actually uses is a common, opaque rejection; `launch privacy scan` reconciles the statically-readable surface against your manifest (the published labels are UI-only).
- **accessibility nutrition labels** — Apple's 2025 declarations of which accessibility features your app supports (VoiceOver, larger text, captions), shown on the product page. `launch accessibility` reconciles them from `accessibility.config.json` over the API with the plan→confirm→apply flow.
- **EU alternative distribution** — under the EU's Digital Markets Act, iOS apps may ship from your own web domains or alternative marketplaces, not only the App Store — which needs authorized domains plus a registered signing key. `launch eu-distribution` reconciles the authorized domains from config over the API.
- **app availability** — the set of App Store territories your app sells in. Apple treats it as one atomic set — you replace the whole list, not toggle one country. `launch availability` reconciles the territories from `availability.config.json` over the API, so where you sell lives in code.

## Reviews, reports & insights

- **store review** — a customer's public rating + comment, plus the single developer reply you can post back. `launch reviews` (App Store) and `launch play-reviews` (Play) read them and manage that reply over the API — the local equivalent of the Ratings & Reviews / Reviews pages, which EAS doesn't touch at all.
- **store reports** — the bulk data behind your dashboards: Sales & Trends, Finance (gzipped TSV), and the multi-step Analytics reports. `launch reports sales|finance|analytics` downloads them from ASC with the API key alone, decompresses, and writes the files — the bulk side EAS never offered.
- **review insights** — the synthesis over raw reviews: average rating, per-star distribution, reply rate, sentiment split, and a month-by-month ratings trend, across both stores at once. `launch insights` aggregates what `reviews` / `play-reviews` already pull; no new data source, just the trends on top.

## Android / Google

- **Gradle** — Android's build system. Launch runs `:app:bundleRelease` for the signed `.aab` (and an `.apk` for ad-hoc). Needs no Mac — any machine with a JDK builds Android.
- **Google Play Console** — Google's web portal for publishing Android apps; the Play-side counterpart to App Store Connect. Launch automates releases via the Play Developer API; first-time Play App Signing enrollment happens here.
- **AAB** — Android App Bundle (`.aab`): the upload format Play expects. Launch builds it via Gradle `:app:bundleRelease`.
- **APK** — Android Package (`.apk`): an installable Android binary. Play serves per-device APKs split from your `.aab`; Launch builds a single `.apk` for ad-hoc/internal installs.
- **JDK** — the Java Development Kit that Gradle needs to compile Android. `launch doctor` checks it's present.
- **service account** — a Google Cloud robot account whose JSON key authenticates Launch to the Play Developer API (the Android analog of the ASC key). Kept in the OS secret store.
- **keystore / upload key** — the key you sign the `.aab` with. Under Play App Signing it only proves the upload is yours (Google holds the real signing key), so a lost upload key is recoverable.
- **keytool** — the JDK utility Launch uses to generate and own your upload key (the Android analog of generating the iOS cert from a CSR).
- **Play App Signing** — Google holds and re-signs with the real app signing key in its KMS; you enroll once at first release. Makes the upload key recoverable; Launch mandates it.
- **Play track** — where a release lands: `internal` / `closed` / `open` testing, or `production`. Launch defaults to `internal`; production is the deliberate `launch release android`.
- **versionCode / versionName** — Android's integer build counter (`versionCode`, every upload must be higher) vs. the human version string (`versionName`). Launch reads the latest `versionCode` from the Play API and bumps it, treating `app.json`'s `android.versionCode` as a floor.
- **bundletool** — Google's tool that turns the `.aab` into the per-device APK splits Play serves and estimates the real download — the Android twin of iOS app thinning.
- **Play in-app products & subscriptions** — Google Play's monetization catalog: one-off managed products and auto-renewable subscriptions (product + base plan + offers). `launch play-products` / `launch play-subscriptions` publish the entries carrying a `play` override from the shared `launch.config.ts` catalog — the Play twin of `sync`.
- **price localization** — turning one base price into a sensible local price for every market, from today's exchange rate plus each country's pricing patterns. `launch play-pricing localize` computes Google's recommendation (`convertRegionPrices`) — advisory only; feed the numbers into `play-products`/`play-subscriptions`.
- **Android vitals** — Google Play's post-launch quality signals (crash rate and ANR rate) that gate your Play ranking and can trigger warnings. `launch play-reports vitals` reads them from the Play Developer Reporting API — the Android counterpart to the iOS reports/insights observability.

## Build speed / cache

- **ccache** — a compiler cache keyed by file content; later builds reuse the cached object for unchanged source, cutting a from-scratch iOS compile 50–70%. Launch wires it in at `pod install` and turns it on by default.
- **incremental build** — reusing the warm compiler caches and DerivedData from the last build instead of recompiling everything. The default; Launch falls back to a clean build only when the native graph changed, or you pass `--clean`.
- **build fingerprint** — a hash of the inputs that move the native graph (`Podfile.lock`, the native config slice, the Xcode version). Unchanged → fast incremental build; changed → one `pod install` + a clean build. JS-only edits don't count.
- **DerivedData** — Xcode's per-project cache of compiled intermediates. Reusing it is what makes an incremental build fast; a fingerprint change is what tells Launch to discard it.

## Remote & cloud builds

- **remote build** — building iOS off your machine because signing needs macOS: Launch syncs the project over SSH, loads transient signing keys into a throwaway keychain on the host, builds there, pulls the `.ipa` home, and shreds the host.
- **EC2 Mac** — a Mac instance rented in your _own_ AWS account, on a Dedicated Host with Apple's hard 24-hour minimum (~$0.65/hr ≈ $16/session). Releasing the host — not stopping the instance — stops the bill.
- **golden AMI** — a snapshot of an EC2 Mac with the toolchain (Xcode/fastlane/node) pre-installed, kept in your account and reused so later sessions boot ready to build.
- **EAS handoff** — with no Mac and no AWS, Launch can drive Expo's `eas-cli` (`eas build`/`eas submit`) in Expo's cloud. The one place Launch leans on the tool it replaces; free-tier caps apply.

## Build-time env

- **build-time env** — Launch loads `.env` for the chosen profile and exposes those values to the app. There's no `EXPO_PUBLIC_` guard, so anything in `.env` can reach the shipped bundle — keep backend secrets out; Launch warns on secret-looking names.
- **env precedence** — `build`, `release`, and `update` resolve env through one ladder, so a value never differs between commands. Highest wins: `--env` flags › keychain secrets › profile `env:` › `.env.local` (only with `--include-local`) › `.env.<profile>` › `.env`. `--print-env` prints the resolved values (secrets masked) and which layer each came from; `.env.local` is never loaded unless you opt in.
