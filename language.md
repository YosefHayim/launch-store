# LANGUAGE

The ubiquitous language of **Launch** — the words this project uses, defined once. Use these terms
(not synonyms) in code, issues, commits, and docs. This is the human/agent-readable reference; the
**runtime** source of truth is [`src/core/glossary.ts`](./src/core/glossary.ts), which powers
`launch explain <topic>` and the `--explain` step expansions. Keep the two aligned — when you add a
glossary topic in code, add it here too.

## Flow & artifacts

- **prebuild** — `expo prebuild`: turns `app.json` + config plugins into a real native `ios/`/`android/` project (Info.plist, Podfile, `.xcodeproj`, Gradle). `app.json` stays the single source of truth; no native files are hand-maintained.
- **archive** — the compiled, signed app bundle Xcode produces before export (the `.xcarchive`); exporting it yields the uploadable `.ipa`.
- **artifact** — a built, uploadable binary: an `.ipa` (iOS) or `.aab` (Android). Stored with a newest-first index by the storage provider.
- **profile** — a named set of build settings in `launch.config.ts` (default `production`); selects env, track, rollout, etc. (Not to be confused with a _provisioning profile_.)
- **code signing** — stamping the app with your distribution certificate / upload key so the store and device can verify origin and integrity.
- **size report** — the honest per-device download/install size, computed _before_ upload: from Xcode's App Thinning Size Report (iOS) or bundletool (Android).

## iOS / Apple

- **ASC API key** — App Store Connect API key: a `.p8` private key + Key ID + Issuer ID. Authenticates Launch to Apple for managing credentials and uploading, with no password/2FA — what makes the CLI scriptable.
- **bundle id** (App ID) — the app's unique identifier, e.g. `com.loopi.pomedero`. Launch registers it over the API before a profile references it.
- **CSR** — Certificate Signing Request: the public half of a locally generated key pair, sent to Apple to be signed into a certificate. The private key never leaves the machine.
- **distribution certificate** — proves Apple trusts you to sign release builds. Created from a local CSR, imported into the Keychain, and reused (Apple caps you at ~2–3).
- **provisioning profile** — ties the bundle id to a certificate + entitlements; for the store it's an "App Store" profile. Installed where Xcode looks.
- **app record** — the app's entry in App Store Connect. The one thing Apple's API can't create (no `POST /v1/apps`) — made once on the website.
- **agreements** — Apple's paid-apps/developer agreements; an unsigned/expired one fails signing & upload with a 403. `launch doctor` probes for this up front.
- **TestFlight** — Apple's pre-release testing track and the safe default for `launch build`. Public App Store release is the separate `launch release`.
- **gym** — the fastlane action Launch drives to archive, sign (manual), and export the `.ipa`.
- **build number** (`CFBundleVersion`) — must be unique and higher than the last for the same version. Launch queries ASC and auto-bumps.

## Android / Google

- **AAB** — Android App Bundle (`.aab`): the upload format Play expects. Launch builds it via Gradle `:app:bundleRelease`.
- **service account** — a Google Cloud robot account whose JSON key authenticates Launch to the Play Developer API (the Android analog of the ASC key). Kept in the OS secret store.
- **keystore / upload key** — the key you sign the `.aab` with. Under Play App Signing it only proves the upload is yours (Google holds the real signing key), so a lost upload key is recoverable.
- **Play App Signing** — Google holds and re-signs with the real app signing key in its KMS; you enroll once at first release. Makes the upload key recoverable; Launch mandates it.
- **Play track** — where a release lands: `internal` / `closed` / `open` testing, or `production`. Launch defaults to `internal`; production is the deliberate `launch release android`.
- **versionCode** — Android's integer build counter (separate from the human `versionName`); every upload must be higher. Launch reads the latest from the Play API and bumps it, treating `app.json`'s `android.versionCode` as a floor.
- **bundletool** — Google's tool that turns the `.aab` into the per-device APK splits Play serves and estimates the real download — the Android twin of iOS app thinning.

## Remote & cloud builds

- **remote build** — building iOS off your machine because signing needs macOS: Launch syncs the project over SSH, loads transient signing keys into a throwaway keychain on the host, builds there, pulls the `.ipa` home, and shreds the host.
- **EC2 Mac** — a Mac instance rented in your _own_ AWS account, on a Dedicated Host with Apple's hard 24-hour minimum (~$0.65/hr ≈ $16/session). Releasing the host — not stopping the instance — stops the bill.
- **golden AMI** — a snapshot of an EC2 Mac with the toolchain (Xcode/fastlane/node) pre-installed, kept in your account and reused so later sessions boot ready to build.
- **EAS handoff** — with no Mac and no AWS, Launch can drive Expo's `eas-cli` (`eas build`/`eas submit`) in Expo's cloud. The one place Launch leans on the tool it replaces; free-tier caps apply.

## Build-time env

- **build-time env** — Launch loads `.env` for the chosen profile and exposes those values to the app. There's no `EXPO_PUBLIC_` guard, so anything in `.env` can reach the shipped bundle — keep backend secrets out; Launch warns on secret-looking names.
