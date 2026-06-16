/**
 * The single glossary of terms Launch teaches.
 *
 * Both the inline `--explain` expansions ({@link Logger}) and the standalone `launch explain <topic>`
 * command read from here, so there is exactly one place to maintain the explanations and they can
 * never drift from each other or from the docs that embed them.
 *
 * Entries are written for a developer new to the React Native / Expo / Apple / Google ecosystem:
 * each says what the thing IS in plain English, then how Launch uses it. The keys are grouped by
 * domain (ecosystem → Apple → versioning → distribution → updates → Android) for readability; the
 * order is cosmetic — lookups are by key. Keep this aligned with `language.md`, the human reference.
 */

/** A known glossary topic. Adding a term = add a key here and an entry in {@link GLOSSARY}. */
export type GlossaryTopic =
  // Ecosystem & frameworks — the stack your app is built on
  | "react-native"
  | "expo"
  | "eas"
  | "app-config"
  | "config-plugin"
  | "metro"
  | "prebuild"
  // Apple — program, portal & toolchain
  | "apple-developer-program"
  | "app-store-connect"
  | "xcode"
  | "fastlane"
  | "cocoapods"
  | "keychain"
  | "app-record"
  | "agreements"
  | "store-readiness"
  | "submission-readiness"
  | "iap-readiness"
  | "store-snapshot"
  // In-app purchases — subscriptions & offers
  | "subscription-group"
  | "subscription-offer"
  // Apple — identity & code signing
  | "asc-api-key"
  | "bundle-id"
  | "team-id"
  | "csr"
  | "distribution-certificate"
  | "provisioning-profile"
  | "entitlements"
  | "bundle-id-capability"
  | "apns-key"
  | "code-signing"
  | "udid"
  // iOS — versioning & download size
  | "build-number"
  | "marketing-version"
  | "app-thinning"
  // Distribution & testing
  | "testflight"
  | "ad-hoc-distribution"
  // App Store release lifecycle
  | "app-store-version"
  | "review-submission"
  | "release-type"
  | "phased-release"
  | "export-compliance"
  | "release-train"
  // Config-as-code — the GitOps loop over store + signing state
  | "config-reconcile"
  | "plan-drift"
  | "adopt"
  | "migrate"
  // Over-the-air updates
  | "ota-update"
  | "runtime-version"
  | "release-channel"
  // Store listing
  | "store-metadata"
  // Build-time env
  | "env-vars"
  | "env-precedence"
  // Build speed / cache
  | "ccache"
  | "incremental-build"
  | "build-fingerprint"
  // Remote & cloud builds
  | "remote-build"
  | "ec2-mac"
  | "golden-ami"
  | "eas-handoff"
  // Android / Google Play
  | "gradle"
  | "play-console"
  | "service-account"
  | "upload-key"
  | "play-app-signing"
  | "play-track"
  | "version-code"
  | "bundletool"
  // Launch wizard — interactive build-flow steps
  | "build-platform"
  | "build-location"
  | "apple-account"
  | "build-profile";

const GLOSSARY: Record<GlossaryTopic, string> = {
  // ── Ecosystem & frameworks ────────────────────────────────────────────────
  "react-native": [
    "React Native: the framework that lets you write one TypeScript/React codebase that runs as a",
    "real native iOS + Android app (not a web page in a shell). Your app's screens and logic live here.",
    "Launch's whole job is turning that codebase into the signed binaries the App Store and Play accept.",
  ].join("\n"),
  expo: [
    "Expo: a batteries-included toolkit on top of React Native — a config-driven app.json, prebuilt",
    "native modules, and the `expo` CLI — so you describe the app once instead of hand-editing native",
    "code. Launch targets Expo apps: it reads your app.json and runs `expo prebuild` to generate native.",
  ].join("\n"),
  eas: [
    "EAS (Expo Application Services): Expo's paid cloud that builds, signs, and submits your app on",
    "their servers and hosts OTA updates — the metered bill Launch replaces by doing the same steps on",
    "your own machine and accounts. Launch can still hand off to it if you have no Mac (see eas-handoff).",
  ].join("\n"),
  "app-config": [
    "app.json / app.config.js: the single source of truth for an Expo app — name, bundle id, icons,",
    "version, permissions, and config plugins. Launch reads it to know what to build and treats its",
    "version fields as the floor for bumps, so you change one file instead of editing native projects.",
  ].join("\n"),
  "config-plugin": [
    "Config plugin: a function that edits the native project during `expo prebuild` (adds an entitlement,",
    "an Info.plist key, a Gradle line). It's how an Expo app customizes native code while staying",
    "config-driven — you declare plugins in app.json rather than hand-patching ios/ or android/ after.",
  ].join("\n"),
  metro: [
    "Metro: React Native's JavaScript bundler — it packs your TS/JS + assets into the one bundle that",
    "ships inside the app and that OTA updates replace. `expo export` runs Metro to produce the bundle",
    "`launch update` publishes, so an over-the-air update ships new JS without recompiling native code.",
  ].join("\n"),
  prebuild: [
    "expo prebuild: turns your app.json + config plugins into a real native iOS/Android",
    "project (Info.plist, entitlements, Podfile, .xcodeproj). It needs no Expo account and",
    "keeps app.json as the single source of truth — you maintain zero native files by hand.",
  ].join("\n"),

  // ── Apple — program, portal & toolchain ──────────────────────────────────
  "apple-developer-program": [
    "Apple Developer Program: the paid ($99/yr) membership that lets you create certificates, sign apps,",
    "and publish to the App Store. Everything Launch does on the Apple side needs an active membership;",
    "`launch doctor` surfaces account problems (lapsed membership, unsigned agreements) before a build.",
  ].join("\n"),
  "app-store-connect": [
    "App Store Connect (ASC): Apple's web portal + API for managing apps, builds, TestFlight, and your",
    "listing. Launch drives its API with an ASC API key for everything scriptable; the few things the",
    "API can't do (create the app record, sign agreements) it points you to the website to finish.",
  ].join("\n"),
  xcode: [
    "Xcode: Apple's toolchain (compiler, signing, simulators). It only runs on macOS, which is why an",
    "iOS build needs a Mac — yours, a remote one, or EAS. Launch never opens Xcode's UI; it drives the",
    "command-line build through fastlane, but the Xcode toolchain underneath is what compiles and signs.",
  ].join("\n"),
  fastlane: [
    "fastlane: the open-source Ruby toolkit that automates Apple's build/upload steps from the command",
    "line. Launch drives its actions — gym (archive + sign + export the .ipa), pilot (TestFlight),",
    "deliver (App Store + metadata) — so iOS releases are scriptable instead of clicked through Xcode.",
  ].join("\n"),
  cocoapods: [
    "CocoaPods: the dependency manager for iOS native libraries. `pod install` reads the Podfile that",
    "`expo prebuild` generates and fetches the native pods your app needs, pinned in Podfile.lock. Launch",
    "runs it before building; a changed Podfile.lock is part of the build fingerprint that forces a clean.",
  ].join("\n"),
  keychain: [
    "Keychain: the OS's encrypted secret store (macOS Keychain; Credential Manager / libsecret elsewhere).",
    "Launch keeps your signing private keys, certificates, and API keys here — never in the repo or in",
    "~/.launch — so secrets stay on your machine. Code signing reads the cert from the Keychain at build.",
  ].join("\n"),
  "app-record": [
    "App record: the app's entry in App Store Connect. It's the ONE thing Apple's API can't create",
    "(there is no POST /v1/apps) — you make it once on the App Store Connect website. Launch detects",
    "when it's missing and points you to the exact page instead of failing deep in an upload.",
  ].join("\n"),
  agreements: [
    "Agreements: Apple's paid-apps and developer agreements. When a new one is unsigned or expired,",
    "every signing/upload call fails with a 403. Launch probes for this in `doctor` so you fix it in",
    "the UI up front, rather than discovering it halfway through a build.",
  ].join("\n"),
  "store-readiness": [
    "Store readiness: the account-level prerequisites a store needs before it will accept a submission —",
    "an App Store Connect app record, a Play app the service account can reach, a first build uploaded to",
    "Play. None involve the build itself, so a green build can still be unshippable. `launch store doctor`",
    "reads these live and grades them (exit 2 on a blocker) before you waste a release attempt on them.",
  ].join("\n"),
  "submission-readiness": [
    "Submission readiness: the full set of prerequisites a store checks at *submission* — a registered",
    "Bundle ID, a valid (unexpired) distribution certificate, a declared export-compliance answer, plus the",
    "account-level basics. A green build that passes `store doctor` can still bounce on one of these.",
    "`launch audit` reads every submit blocker live and grades them (exit 2 on a blocker) as a pre-release gate.",
  ].join("\n"),
  "iap-readiness": [
    "IAP readiness: whether the in-app purchases and subscriptions your config declares actually exist on",
    "App Store Connect and are submittable — not stuck in MISSING_METADATA (no name, price, or localization).",
    "IAP is the most error-prone surface: a green build says nothing about whether buying the thing works, and",
    "a product the app references but never finished fails silently in production. `launch iap doctor` grades",
    "each declared product against its live state (exit 2 on a blocker) so you catch it before customers do.",
  ].join("\n"),
  "store-snapshot": [
    "Store snapshot: a read-only, point-in-time copy of your live App Store Connect + Google Play catalog —",
    "products, subscriptions, and their states — saved as a named record under ~/.launch/snapshots. It's the",
    "trustworthy 'before' that makes destructive store automation reversible: capture one, run `launch sync`,",
    "then `launch snapshot diff` to see exactly what moved. `launch snapshot` captures, diffs, and exports them.",
  ].join("\n"),

  // ── In-app purchases — subscriptions & offers ─────────────────────────────
  "subscription-group": [
    "Subscription group: Apple's container for mutually-exclusive subscription tiers — a customer holds at",
    "most one active subscription per group (e.g. Monthly vs Yearly of the same plan), and upgrades/downgrades",
    "move them between levels in the group. You declare groups and their subscriptions in launch.config.ts;",
    "`launch sync` reconciles them onto App Store Connect by reference name, the group's natural key.",
  ].join("\n"),
  "subscription-offer": [
    "Subscription offer: a discounted or free entry price on a subscription. Three kinds — introductory (a",
    "new customer's first-time deal), promotional (a win-back/retention deal for lapsed or current users), and",
    "an offer code (a redeemable code, e.g. for press or partners). Apple makes offer terms immutable once",
    "created, so Launch only ever adds missing offers — `launch offers` reconciles them from config, never",
    "edits or deletes (deactivating a code is the explicit `launch offers deactivate`), so it's safe to re-run.",
  ].join("\n"),

  // ── Apple — identity & code signing ───────────────────────────────────────
  "asc-api-key": [
    "App Store Connect API key: a .p8 private key + Key ID + Issuer ID you generate once in",
    "App Store Connect. It authenticates Launch to Apple for BOTH managing credentials and",
    "uploading builds, with no password and no 2FA prompt — which is what makes the CLI scriptable.",
  ].join("\n"),
  "bundle-id": [
    "Bundle ID (App ID): the unique identifier for your app, e.g. com.loopi.pomedero. It must be",
    "registered in your Apple account before a profile can reference it. Launch registers it for you",
    "over the API (POST /v1/bundleIds) so you don't open the Developer portal to do it by hand.",
  ].join("\n"),
  "team-id": [
    "Team ID: the 10-character identifier for your Apple developer team (e.g. ABCDE12345), shown in the",
    "Apple Developer portal. It scopes your bundle ids, certificates, and profiles. Launch reads it from",
    "your account and stamps it into the build so the right team's signing assets are used.",
  ].join("\n"),
  csr: [
    "CSR (Certificate Signing Request): the public half of a fresh key pair, wrapped in a request",
    "Apple signs into a certificate. Launch generates the key pair and CSR locally with openssl —",
    "only the CSR is sent to Apple, so your private key never leaves the machine.",
  ].join("\n"),
  "distribution-certificate": [
    "Distribution Certificate: proves Apple trusts you to sign release builds. It's a key pair;",
    "the private half stays on your machine. Launch creates one via the API from a local CSR, imports",
    "it into the Keychain, and reuses it — Apple caps you at ~2–3, so it never burns a slot per build.",
  ].join("\n"),
  "provisioning-profile": [
    "Provisioning Profile: the file that ties your App ID (e.g. com.loopi.pomedero) to a",
    "certificate and your entitlements (push, etc.). For the store it's an 'App Store' profile.",
    "Launch creates or reuses the matching one over the API and installs it where Xcode looks.",
  ].join("\n"),
  entitlements: [
    "Entitlements: the capabilities an app is allowed to use — push notifications, iCloud, app groups.",
    "They live in an entitlements file and must match what the provisioning profile grants, or signing",
    "fails. `expo prebuild` generates them from your app.json; Launch builds against the matching profile.",
  ].join("\n"),
  "bundle-id-capability": [
    "Bundle ID capability: a service an App ID is allowed to use — push notifications, associated domains,",
    "app groups, iCloud. They're set on the App ID and must match the app's entitlements or signing fails.",
    "Launch syncs them over the API (POST/DELETE /v1/bundleIdCapabilities) from what launch.config.ts",
    "declares — enabling the ones you added, disabling the managed ones you removed — and leaves every",
    "already-correct capability (and its sub-settings, e.g. push 'Broadcast') untouched, unlike EAS.",
  ].join("\n"),
  "apns-key": [
    "APNs auth key: a .p8 your backend uses to send push notifications to your app. Apple has NO API to",
    "create one — it's a download-once, portal-only key (Certificates, IDs & Profiles → Keys), capped at",
    "2 per account — so Launch can't mint it, only import and safeguard one. `launch creds push-key` vaults",
    "it in your keychain and re-exports it on demand; Launch never sends push itself (that's your server).",
  ].join("\n"),
  "code-signing": [
    "Code signing: stamping the app with your distribution certificate so Apple (and the device)",
    "can verify it came from you and wasn't tampered with. Launch signs during export via fastlane gym.",
  ].join("\n"),
  udid: [
    "UDID: the unique hardware identifier of an iPhone/iPad. Ad-hoc (TestFlight-free) installs only run",
    "on devices whose UDID is listed on the provisioning profile, so you register each tester device",
    "first with `launch device add`. The App Store and TestFlight need no UDIDs — only ad-hoc builds do.",
  ].join("\n"),

  // ── iOS — versioning & download size ──────────────────────────────────────
  "build-number": [
    "Build number (CFBundleVersion): Apple requires every upload to carry a number that is unique",
    "and higher than the last for the same version. Launch queries App Store Connect for the",
    "last-used number and auto-bumps, so you never hit 'build number already used'.",
  ].join("\n"),
  "marketing-version": [
    "Marketing version (CFBundleShortVersionString): the human version users see, e.g. 1.2.0 — separate",
    "from the build number. Launch reads the versions already on App Store Connect (App Store + TestFlight)",
    "and suggests the next bump, so you advance the version deliberately instead of reusing or guessing one.",
  ].join("\n"),
  "app-thinning": [
    "App thinning: Apple strips assets/architectures a given device doesn't need, so the real",
    "download is smaller than the .ipa. Xcode's App Thinning Size Report gives the per-device",
    "download and install size locally — Launch reads it so you know the size before TestFlight.",
  ].join("\n"),

  // ── Distribution & testing ────────────────────────────────────────────────
  testflight: [
    "TestFlight: Apple's pre-release testing track. A build uploaded here goes to your testers,",
    "not the public App Store. It's the safe default and where you validate size and behavior;",
    "public release is a separate, deliberate step (launch release --to-store).",
  ].join("\n"),
  "ad-hoc-distribution": [
    "Ad-hoc / internal distribution: an install link for your testers without TestFlight. iOS signs an",
    "ad-hoc .ipa valid only for devices whose UDID is on the profile (register them with `launch device add`)",
    "and serves an itms-services manifest; Android serves the .apk directly. Both host on YOUR own bucket.",
  ].join("\n"),

  // ── App Store release lifecycle ───────────────────────────────────────────
  "app-store-version": [
    "App Store version: the per-release record on App Store Connect (one per marketing version) holding its",
    "review state, the attached build, the release type, and the 'What's New' notes. `launch release` creates",
    "or reuses the editable one, attaches your build, and submits it — the version is the unit Apple reviews",
    "and ships, separate from TestFlight.",
  ].join("\n"),
  "review-submission": [
    "Review submission: Apple's container for what you send to App Review. You add your App Store version to",
    "it as an item, then submit the whole thing. `launch release` drives this over the API (create → add",
    "version → submit), so you never click 'Submit for Review', and re-running resumes a submission already",
    "in progress instead of duplicating it.",
  ].join("\n"),
  "release-type": [
    "Release type: how an APPROVED build reaches the public store. AFTER_APPROVAL goes live automatically the",
    "moment Apple approves (Launch's default); MANUAL holds it until you press release; SCHEDULED goes live at",
    "a date you set. Configure it in launch.config.ts (release.releaseType) or per-run with --manual /",
    "--scheduled <iso>.",
  ].join("\n"),
  "phased-release": [
    "Phased release: Apple's optional 7-day staged rollout of an approved UPDATE — a growing percentage of",
    "users each day instead of everyone at once, so a regression reaches few people. Opt in with",
    "`launch release --phased`, then pause/resume/finish it with `launch rollout`. It applies only to updates",
    "(a first version always ships to 100%).",
  ].join("\n"),
  "export-compliance": [
    "Export compliance: Apple's encryption question every build must answer before it can ship. Standard",
    "HTTPS/system crypto is exempt — Launch declares that over the API (usesNonExemptEncryption=false) so the",
    "build clears 'Waiting for Export Compliance' with no portal trip. Set release.usesNonExemptEncryption to",
    "true only for proprietary/non-exempt encryption, which needs documentation Apple's API can't accept.",
  ].join("\n"),
  "release-train": [
    "Release train: one app's whole release coordinated across iOS, Android, and OTA as a single record —",
    "each platform (and each OTA follower) is a 'car'. `launch release-train start` submits every car, then",
    "`status` reconciles it forward: each car releases on its own approval, and an OTA bundle publishes once",
    "its native platform is live. `--hold` waits until every car is approved, then releases them together.",
  ].join("\n"),

  // ── Config-as-code — the GitOps loop over store + signing state ───────────
  "config-reconcile": [
    "Reconcile: Launch treats launch.config.ts as the desired state and makes the live store match it —",
    "the GitOps loop, applied to App Store Connect and Google Play. It's declarative and additive: each",
    "object is matched on its natural key and created/updated only where it diverges, so a reconcile is",
    "safe to re-run. `launch sync` reconciles the whole config; `offers` and others reconcile one surface.",
  ].join("\n"),
  "plan-drift": [
    "Plan / drift: the read-only half of the reconcile loop. `launch plan` diffs launch.config.ts (desired)",
    "against live store + signing state (actual) and prints what `sync` WOULD change, touching nothing.",
    "`launch drift` is the same read graded for CI (`plan --check`): exit 0 in sync, 2 on drift, 1 on error.",
    "It's the GitOps preview fastlane and EAS don't offer — see what will move before you let anything move.",
  ].join("\n"),
  adopt: [
    "Adopt: the reverse of reconcile — for an app that ALREADY ships. `launch adopt` reads your live App",
    "Store Connect setup (products, capabilities, signing, listing) and writes it back into a populated,",
    "reviewable launch.config.ts (+ app.json entitlements + store.config.json), so an app built by hand or",
    "via EAS comes under config-as-code in one command. From there you drive everything forward with `sync`.",
  ].join("\n"),
  migrate: [
    "Migrate: the file-based onboarding path (vs. adopt, which reads a live account). `launch migrate` reads",
    "an existing EAS (eas.json/app.json) or fastlane setup off disk and emits the equivalent Launch config",
    "plus a report of what to finish by hand. Read-only against both stores — it converts configuration, so",
    "you can try Launch against your current project without touching the App Store or Play.",
  ].join("\n"),

  // ── Over-the-air updates ──────────────────────────────────────────────────
  "ota-update": [
    "OTA update: ship a JS/asset-only change to installed apps without a new store build, using the Expo",
    "Updates protocol your app already embeds (expo-updates). `launch update` exports the bundle, writes a",
    "signed manifest keyed by runtime version + channel to your bucket, and the app fetches it on launch.",
  ].join("\n"),
  "runtime-version": [
    "Runtime version: the contract between a native build and the OTA updates it can accept. An update",
    "only loads if its runtime version matches the installed app's, so a JS change that needs new native",
    "code can't be shipped over the air by mistake. `launch update` keys each manifest by this value.",
  ].join("\n"),
  "release-channel": [
    "Channel: a named stream of OTA updates (e.g. production, staging) that a build subscribes to, so you",
    "can push JS to beta testers without touching production. `launch update` writes the manifest under",
    "the channel + platform + runtime-version path, and the app fetches its own channel on each launch.",
  ].join("\n"),

  // ── Store listing ─────────────────────────────────────────────────────────
  "store-metadata": [
    "Store metadata: your listing — name, subtitle, description, keywords, release notes, URLs. Launch syncs",
    "it from a versioned store.config.json (Expo's schema for iOS, plus an android extension) via fastlane",
    "deliver/supply, so the listing lives in your repo and pushes deterministically alongside the build.",
  ].join("\n"),

  // ── Build-time env ────────────────────────────────────────────────────────
  "env-vars": [
    "Build-time env: Launch loads .env for the chosen profile and exposes those values to the app.",
    "There is no EXPO_PUBLIC_ prefix guard here, so anything in .env can reach the shipped bundle —",
    "keep backend secrets out of it. Launch warns on secret-looking names as a gentle net.",
  ].join("\n"),
  "env-precedence": [
    "Env precedence: build, release, and update resolve env through ONE ladder, so a var never differs",
    "between them. Highest wins: --env flags › keychain secrets › profile env: › .env.local (only with",
    "--include-local) › .env.<profile> › .env. `--print-env` prints the resolved values (secrets masked)",
    "and which layer each came from. .env.local is never loaded unless you opt in.",
  ].join("\n"),

  // ── Build speed / cache ───────────────────────────────────────────────────
  ccache: [
    "ccache: a compiler cache keyed by file content. The first build fills it; later builds reuse the",
    "cached object for any unchanged source — cutting a from-scratch iOS compile 50–70%. Launch wires it",
    "in at `pod install` (USE_CCACHE) and turns it on by default; `launch doctor` installs and sizes it.",
  ].join("\n"),
  "incremental-build": [
    "Incremental build: reusing the warm compiler caches and DerivedData from your last build instead of",
    "recompiling everything. It's the default and the common case (a JS edit needs no native recompile).",
    "Launch falls back to a clean build only when the native graph changed, or you pass `--clean`.",
  ].join("\n"),
  "build-fingerprint": [
    "Build fingerprint: a hash of the inputs that move the native graph — Podfile.lock, the native config",
    "slice, and the Xcode version. Launch stores it per app and compares it each build: unchanged means a",
    "fast incremental build; changed means one `pod install` + a clean build. JS-only edits don't count.",
  ].join("\n"),

  // ── Remote & cloud builds ─────────────────────────────────────────────────
  "remote-build": [
    "Remote build: iOS can only be signed on macOS, so a non-Mac developer builds on a remote Mac.",
    "Launch syncs your project over SSH, uploads a transient copy of your signing keys into a throwaway",
    "keychain on the host, runs the same fastlane build there, pulls the .ipa home, and shreds the host.",
  ].join("\n"),
  "ec2-mac": [
    "EC2 Mac: a Mac instance you rent in your OWN AWS account. It runs on a Dedicated Host with a hard",
    "24-hour minimum (Apple's license) at ~$0.65/hr — about $16 minimum per session, whether you run 1",
    "build or 50. Stopping the instance does NOT stop the bill; only releasing the host does, after 24h.",
  ].join("\n"),
  "golden-ami": [
    "Golden AMI: a snapshot of a Mac instance with the toolchain (Xcode/fastlane/node) already installed,",
    "kept in your own account because Xcode can't be redistributed. Launch bootstraps one on first use and",
    "reuses it so later sessions boot ready to build, wasting less of the paid 24-hour window.",
  ].join("\n"),
  "eas-handoff": [
    "EAS handoff: if you have no Mac and no AWS, Launch can orchestrate Expo's eas-cli for you — it drives",
    "`eas build` in Expo's cloud, downloads the .ipa, and can run `eas submit`. It's the one place Launch",
    "leans on the tool it replaces; you're on Expo's free-tier caps, but it costs nothing and needs no Mac.",
  ].join("\n"),

  // ── Android / Google Play ─────────────────────────────────────────────────
  gradle: [
    "Gradle: Android's build system. Launch runs `:app:bundleRelease` to produce the signed .aab Play",
    "expects (and an .apk for ad-hoc). Unlike iOS it needs no Mac — any machine with a JDK can build",
    "Android — and the native config + versionCode come from the `android` block of your app.json.",
  ].join("\n"),
  "play-console": [
    "Google Play Console: Google's web portal for publishing Android apps — the Play-side counterpart to",
    "App Store Connect. Launch automates releases through the Play Developer API (auth'd by a service",
    "account); the first-time step the API can't do — enrolling in Play App Signing — happens here.",
  ].join("\n"),
  "service-account": [
    "Service account: a Google Cloud robot account whose JSON key authenticates Launch to the Play",
    "Developer API — the Android analog of the App Store Connect key. You create it in Google Cloud and",
    "grant it access in Play Console → Users & Permissions. Launch keeps the JSON in your OS secret store.",
  ].join("\n"),
  "upload-key": [
    "Upload key: the key you sign your .aab with before uploading. Under Play App Signing it is NOT the",
    "real app signing key (Google holds that) — it only proves the upload is yours, so a lost upload key",
    "is recoverable via a Play Console reset. Launch generates/owns it with keytool, like the iOS cert.",
  ].join("\n"),
  "play-app-signing": [
    "Play App Signing: Google holds your real app signing key in its KMS and re-signs every release, so",
    "the key never leaves Google and can't be lost. You enroll once at your first release (a Play Console",
    "step the API can't do). It's what makes the upload key recoverable — Launch mandates it.",
  ].join("\n"),
  "play-track": [
    "Play track: where a release lands — internal, closed, or open testing, or production. A new personal",
    "account must run ~20 testers for 14 days on a testing track before production unlocks, so Launch",
    "defaults to the internal track; production is the deliberate `launch release android`.",
  ].join("\n"),
  "version-code": [
    "versionCode: Android's integer build counter (separate from the human versionName). Every upload",
    "must be higher than the last. Launch reads the latest from the Play Developer API and bumps it,",
    "treating app.json's android.versionCode as a floor — so you never hit 'versionCode already used'.",
  ].join("\n"),
  bundletool: [
    "bundletool: Google's tool that turns your .aab into the per-device APK splits Play would serve, then",
    "estimates the real download. The .aab file size is NOT what users download, so Launch runs bundletool",
    "to report the honest worst-case download before any upload — the Android twin of iOS app thinning.",
  ].join("\n"),

  // ── Launch wizard — interactive build-flow steps ──────────────────────────
  "build-platform": [
    "Platform: which store this build targets. iOS can only be compiled and signed on macOS, so from a",
    "non-Mac (or by choice) Launch routes it to a remote Mac or Expo's cloud; Android builds locally on",
    "any OS with Gradle. Either way the same prepare → build → size → submit spine runs, so the flow matches.",
  ].join("\n"),
  "build-location": [
    "Build location: where the iOS compile actually runs. 'This Mac' uses your local Xcode (free, fastest);",
    "'AWS cloud Mac' rents one in your own AWS account (~$16 min per 24h); 'a Mac over SSH' reuses a Mac you",
    "already reach; 'Expo EAS' hands off to Expo's cloud (free-tier caps). The same signed .ipa comes back.",
  ].join("\n"),
  "apple-account": [
    "Apple account: an App Store Connect API key belongs to exactly one Apple team, so each key IS an",
    "account. Launch keeps several side by side and signs with the one you pick — switching account switches",
    "team. '+ Add another' onboards a new key (.p8 + Key ID + Issuer ID) and makes it the active account.",
  ].join("\n"),
  "build-profile": [
    "Build profile: a named settings bundle from launch.config.ts (e.g. production, preview). It selects",
    "which .env file is loaded into the build and the soft download-size budget to check against. App facts",
    "like version and bundle id still come from app.json, so a profile only carries Launch-specific knobs.",
  ].join("\n"),
};

/** Return the teaching text for a topic. */
export function explainTopic(topic: GlossaryTopic): string {
  return GLOSSARY[topic];
}

/** Return whether a string is a known topic (narrows the type for the `explain` command). */
export function isGlossaryTopic(value: string): value is GlossaryTopic {
  return value in GLOSSARY;
}

/** All known topic keys, for `launch explain` with no argument. */
export function listTopics(): GlossaryTopic[] {
  return Object.keys(GLOSSARY) as GlossaryTopic[];
}
