/**
 * The single glossary of terms Relay teaches.
 *
 * Both the inline `--explain` expansions ({@link Logger}) and the standalone `relay explain <topic>`
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
  | "env-vars";

const GLOSSARY: Record<GlossaryTopic, string> = {
  prebuild: [
    "expo prebuild: turns your app.json + config plugins into a real native iOS/Android",
    "project (Info.plist, entitlements, Podfile, .xcodeproj). It needs no Expo account and",
    "keeps app.json as the single source of truth — you maintain zero native files by hand.",
  ].join("\n"),
  "asc-api-key": [
    "App Store Connect API key: a .p8 private key + Key ID + Issuer ID you generate once in",
    "App Store Connect. It authenticates Relay to Apple for BOTH managing credentials and",
    "uploading builds, with no password and no 2FA prompt — which is what makes the CLI scriptable.",
  ].join("\n"),
  "bundle-id": [
    "Bundle ID (App ID): the unique identifier for your app, e.g. com.loopi.pomedero. It must be",
    "registered in your Apple account before a profile can reference it. Relay registers it for you",
    "over the API (POST /v1/bundleIds) so you don't open the Developer portal to do it by hand.",
  ].join("\n"),
  csr: [
    "CSR (Certificate Signing Request): the public half of a fresh key pair, wrapped in a request",
    "Apple signs into a certificate. Relay generates the key pair and CSR locally with openssl —",
    "only the CSR is sent to Apple, so your private key never leaves the machine.",
  ].join("\n"),
  "distribution-certificate": [
    "Distribution Certificate: proves Apple trusts you to sign release builds. It's a key pair;",
    "the private half stays on your machine. Relay creates one via the API from a local CSR, imports",
    "it into the Keychain, and reuses it — Apple caps you at ~2–3, so it never burns a slot per build.",
  ].join("\n"),
  "provisioning-profile": [
    "Provisioning Profile: the file that ties your App ID (e.g. com.loopi.pomedero) to a",
    "certificate and your entitlements (push, etc.). For the store it's an 'App Store' profile.",
    "Relay creates or reuses the matching one over the API and installs it where Xcode looks.",
  ].join("\n"),
  "code-signing": [
    "Code signing: stamping the app with your distribution certificate so Apple (and the device)",
    "can verify it came from you and wasn't tampered with. Relay signs during export via fastlane gym.",
  ].join("\n"),
  "app-thinning": [
    "App thinning: Apple strips assets/architectures a given device doesn't need, so the real",
    "download is smaller than the .ipa. Xcode's App Thinning Size Report gives the per-device",
    "download and install size locally — Relay reads it so you know the size before TestFlight.",
  ].join("\n"),
  "build-number": [
    "Build number (CFBundleVersion): Apple requires every upload to carry a number that is unique",
    "and higher than the last for the same version. Relay queries App Store Connect for the",
    "last-used number and auto-bumps, so you never hit 'build number already used'.",
  ].join("\n"),
  "app-record": [
    "App record: the app's entry in App Store Connect. It's the ONE thing Apple's API can't create",
    "(there is no POST /v1/apps) — you make it once on the App Store Connect website. Relay detects",
    "when it's missing and points you to the exact page instead of failing deep in an upload.",
  ].join("\n"),
  agreements: [
    "Agreements: Apple's paid-apps and developer agreements. When a new one is unsigned or expired,",
    "every signing/upload call fails with a 403. Relay probes for this in `doctor` so you fix it in",
    "the UI up front, rather than discovering it halfway through a build.",
  ].join("\n"),
  testflight: [
    "TestFlight: Apple's pre-release testing track. A build uploaded here goes to your testers,",
    "not the public App Store. It's the safe default and where you validate size and behavior;",
    "public release is a separate, deliberate step (relay release --to-store).",
  ].join("\n"),
  "env-vars": [
    "Build-time env: Relay loads .env for the chosen profile and exposes those values to the app.",
    "There is no EXPO_PUBLIC_ prefix guard here, so anything in .env can reach the shipped bundle —",
    "keep backend secrets out of it. Relay warns on secret-looking names as a gentle net.",
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

/** All known topic keys, for `relay explain` with no argument. */
export function listTopics(): GlossaryTopic[] {
  return Object.keys(GLOSSARY) as GlossaryTopic[];
}
