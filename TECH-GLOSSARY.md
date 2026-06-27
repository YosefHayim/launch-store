# TECH-GLOSSARY.md — React Native / Expo / Apple / Google ecosystem

> Launch-specific domain terms live in CONTEXT.md ## Language. Runtime glossary: src/core/glossary.ts

It's written for someone **new to the React Native / Expo / Apple / Google ecosystem**: the sections below explain the stack your app is built on. Run `launch explain <topic>` (e.g. `launch explain provisioning-profile`) for the same definitions in your terminal.

## Frameworks & the ecosystem

- **React Native** — the framework that lets you write one TypeScript/React codebase that runs as a real native iOS + Android app (not a web page in a shell). Your screens and logic live here; Launch turns that codebase into store-ready binaries.
- **Expo** — a batteries-included toolkit on top of React Native: a config-driven `app.json`, prebuilt native modules, and the `expo` CLI. You describe the app once instead of hand-editing native code. Launch targets Expo apps.
- **EAS** (Expo Application Services) — Expo's _paid cloud_ that builds, signs, submits, and hosts OTA updates on their servers. It's the metered bill Launch replaces by doing the same steps on your own machine and accounts.
- **app.json / app.config.js** (app config) — the single source of truth for an Expo app: name, bundle id, icons, version, permissions, config plugins. Launch reads it to know what to build and treats its version fields as the floor for bumps.
- **config plugin** — a function that edits the native project _during_ `expo prebuild` (adds an entitlement, an Info.plist key, a Gradle line). How an Expo app customizes native code while staying config-driven — declared in `app.json`, not hand-patched after.
- **prebuild** — `expo prebuild`: turns `app.json` + config plugins into a real native `ios/`/`android/` project (Info.plist, Podfile, `.xcodeproj`, Gradle). `app.json` stays the single source of truth; no native files are hand-maintained.
- **Metro** — React Native's JavaScript bundler. It packs your TS/JS + assets into the single bundle that ships inside the app and that OTA updates replace. `expo export` runs Metro to produce the bundle `launch update` publishes.

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
