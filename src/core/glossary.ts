/**
 * The single glossary of terms Launch teaches.
 *
 * Both the inline `--explain` expansions ({@link Logger}) and the standalone `launch explain <topic>`
 * command read from here, so there is exactly one place to maintain the explanations and they can
 * never drift from each other or from the docs that embed them.
 */

/** A known glossary topic. Adding a term = add a key here and an entry in {@link GLOSSARY}. */
export type GlossaryTopic =
  | "prebuild"
  | "asc-api-key"
  | "bundle-id"
  | "csr"
  | "distribution-certificate"
  | "provisioning-profile"
  | "code-signing"
  | "app-thinning"
  | "build-number"
  | "app-record"
  | "agreements"
  | "testflight"
  | "env-vars"
  | "remote-build"
  | "ec2-mac"
  | "golden-ami"
  | "eas-handoff"
  | "service-account"
  | "upload-key"
  | "play-app-signing"
  | "play-track"
  | "version-code"
  | "bundletool"
  | "ccache"
  | "incremental-build"
  | "build-fingerprint";

const GLOSSARY: Record<GlossaryTopic, string> = {
  prebuild: [
    "expo prebuild: turns your app.json + config plugins into a real native iOS/Android",
    "project (Info.plist, entitlements, Podfile, .xcodeproj). It needs no Expo account and",
    "keeps app.json as the single source of truth — you maintain zero native files by hand.",
  ].join("\n"),
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
  "code-signing": [
    "Code signing: stamping the app with your distribution certificate so Apple (and the device)",
    "can verify it came from you and wasn't tampered with. Launch signs during export via fastlane gym.",
  ].join("\n"),
  "app-thinning": [
    "App thinning: Apple strips assets/architectures a given device doesn't need, so the real",
    "download is smaller than the .ipa. Xcode's App Thinning Size Report gives the per-device",
    "download and install size locally — Launch reads it so you know the size before TestFlight.",
  ].join("\n"),
  "build-number": [
    "Build number (CFBundleVersion): Apple requires every upload to carry a number that is unique",
    "and higher than the last for the same version. Launch queries App Store Connect for the",
    "last-used number and auto-bumps, so you never hit 'build number already used'.",
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
  testflight: [
    "TestFlight: Apple's pre-release testing track. A build uploaded here goes to your testers,",
    "not the public App Store. It's the safe default and where you validate size and behavior;",
    "public release is a separate, deliberate step (launch release --to-store).",
  ].join("\n"),
  "env-vars": [
    "Build-time env: Launch loads .env for the chosen profile and exposes those values to the app.",
    "There is no EXPO_PUBLIC_ prefix guard here, so anything in .env can reach the shipped bundle —",
    "keep backend secrets out of it. Launch warns on secret-looking names as a gentle net.",
  ].join("\n"),
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
