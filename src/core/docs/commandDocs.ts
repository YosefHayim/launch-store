/**
 * Pure rendering + counting behind `npm run docs:gen`.
 *
 * The I/O half lives in `scripts/gen-docs.ts` — mirroring how `scripts/gen-asc-types.ts` keeps its
 * tested logic in `src/core/asc/specPatch.ts`. This module turns a plain description of the `launch`
 * command tree ({@link CommandSpec}) plus a few repo-wide counts ({@link DocStats}) into the two
 * committed, generated docs: `docs/commands.md` and `llms.txt`. Keeping the command surface defined in
 * `src/cli` as the single source those docs derive from is what stops the AI-facing and human-facing
 * markdown from drifting out of sync with the real CLI.
 *
 * It is deliberately free of commander, prettier, and `fs` so it stays trivially unit-testable: the
 * script adapts commander's tree into {@link CommandSpec}, supplies the counts, prettier-formats the
 * returned markdown, and writes (or, under `--check`, diffs) the files.
 */

/** One option/flag on a command, reduced to what the reference renders. */
export interface OptionSpec {
  /** commander's raw flags string, e.g. `-p, --profile <name>` or `--no-submit`. */
  flags: string;
  /** the one-line help shown beside the flag. */
  description: string;
}

/**
 * A `launch` (sub)command flattened to exactly what the reference needs, recursive via
 * {@link subcommands}. `path` is the command words after `launch` (e.g. `metadata pull`) so a heading
 * can be rendered without threading parent state through the walk.
 */
export interface CommandSpec {
  /** the command words after `launch`, e.g. `build` or `metadata pull`. */
  path: string;
  /** positional-argument usage, pre-formatted, e.g. `<platform>` or `[id|latest]` (empty when none). */
  args: string;
  /** the command's one-line description. */
  description: string;
  /** declared flags in registration order (commander's implicit help/version already stripped). */
  options: OptionSpec[];
  /** nested subcommands, e.g. `metadata` → [`pull`, `push`]. */
  subcommands: CommandSpec[];
}

/**
 * The live numbers in the reference's headline blockquote — computed at generation time so they can
 * never go stale. `operations` is the public async-method count across the two store API clients
 * (`ascClient` + `playClient`), i.e. the store operations Launch wraps.
 */
export interface DocStats {
  /** top-level `launch` commands. */
  commands: number;
  /** public async methods across the App Store Connect + Google Play API clients. */
  operations: number;
  /** test cases (`it`/`test` calls) guarding the codebase. */
  tests: number;
}

/** A generated file the script writes (or diffs under `--check`): repo-relative path + full contents. */
export interface GeneratedDoc {
  /** path relative to the repo root, e.g. `docs/commands.md`. */
  path: string;
  /** the rendered markdown, before prettier formatting. */
  body: string;
}

/**
 * The single canonical category sentence. Kept byte-identical in `package.json` `description`, the
 * README hero, and the `llms.txt` summary blockquote so an LLM sees one consistent sentence to lift —
 * the GEO goal of issue #89. The consistency test asserts all three still match this constant.
 */
export const CANONICAL_SENTENCE =
  "Open-source, self-hosted alternative to Expo EAS — build, sign, configure your stores, and ship Expo / React Native apps to the App Store & Google Play from one typed launch.config.ts — your machine, your keys. No per-build bill.";

/**
 * The "what Launch is / is NOT" disambiguation, shared by the README and `llms.txt`. AI engines
 * currently conflate Launch with thin App Store Connect SDK/MCP wrappers; this block states the
 * category difference in lines a model can lift verbatim. The consistency test asserts both surfaces
 * still contain {@link IS_NOT_SIGNATURE}.
 */
export const WHAT_LAUNCH_IS_BLOCK = `**Launch is** an end-to-end release tool: it owns the whole path from source to store — build, code-sign, size-check, store-config-as-code, upload, public release, and over-the-air updates — for both iOS and Android, on hardware you own.

**Launch is not** just an App Store Connect SDK or an ASC MCP server. Those wrap a slice of Apple's API; Launch drives the entire release across Apple **and** Google, with signing, building, and OTA updates that an API wrapper doesn't touch. If you want a self-hosted Expo EAS — not just an API client — that's Launch.`;

/** A stable sentence from {@link WHAT_LAUNCH_IS_BLOCK} the consistency test greps for on both surfaces. */
export const IS_NOT_SIGNATURE = "**Launch is not** just an App Store Connect SDK";

/**
 * The HTML-comment fences around the README's live-stats badge row. `npm run docs:gen` rewrites only
 * the text between these markers (via {@link spliceReadmeBadges}); everything else in the curated
 * README is left byte-for-byte untouched. Kept here — beside the other generated-doc constants — so the
 * one place that owns "what the docs say" also owns where in the README they go.
 */
export const STATS_BADGES_START =
  "<!-- stats-badges:start — generated by `npm run docs:gen`; edit the source, then regenerate. -->";

/** Closing fence for the README badge region; see {@link STATS_BADGES_START}. */
export const STATS_BADGES_END = "<!-- stats-badges:end -->";

/**
 * The generative-engine FAQ — claim-first, self-contained Q&As targeting the natural-language queries
 * LLMs field about Expo EAS alternatives (cost, no-Mac iOS, Android, OTA, migration, "is it just an ASC
 * wrapper", lock-in). Front-loaded with the comparison/cost questions an engine is most likely to lift.
 *
 * Single source of truth for the FAQ, exactly like {@link WHAT_LAUNCH_IS_BLOCK}: rendered into `llms.txt`
 * by {@link renderLlmsTxt} and spliced into the English README's `## FAQ` region by {@link renderFaqRegion},
 * so neither surface can drift; the consistency test asserts {@link FAQ_SIGNATURE} survives on each. The
 * translated READMEs carry a hand-translated FAQ, kept honest by the README structural-parity test. Every
 * claim here is true to the repo — no "production-ready" or "no Mac ever" inflation.
 */
export const GENERATIVE_AI_FAQ = `**What is Launch?** Launch is an open-source, self-hosted alternative to Expo EAS: it builds, signs, and ships Expo / React Native apps to TestFlight and Google Play from your own machine, with your own keys, and no per-build bill. It runs the same build → submit → update pipeline EAS does, and adds the store-setup steps EAS leaves to the App Store Connect and Play Console websites — in-app purchases, subscriptions, capabilities, and listing metadata — as code.

**Is Launch a free, open-source alternative to Expo EAS?** Yes. Launch is MIT-licensed and fully open source, and builds run on hardware you own, so there is no per-build fee, build-minute meter, or monthly subscription — versus EAS's $19–$199/mo paid tiers plus per-build overage. The only optional cost is renting a cloud Mac if you need to build iOS without one.

**How is Launch different from Expo EAS?** EAS runs your builds on Expo's cloud and keeps your credentials, artifacts, and OTA updates on Expo's servers. Launch runs the identical pipeline on your own machine, keeps signing keys in your OS keychain, and stores artifacts and OTA updates in your own bucket (S3 / R2 / Supabase) — then manages the store config EAS does not (IAPs, subscriptions, capabilities, and the iOS and Android listing) as code. The commands map one-for-one: \`eas build\` → \`launch build\`, \`eas submit\` → \`launch release\`, \`eas update\` → \`launch update\`, \`eas metadata\` → \`launch metadata\`, \`eas credentials\` → \`launch creds\`.

**Can I build iOS apps without a Mac?** iOS code signing and the build toolchain are macOS-only, so a Mac has to be in the loop — but it does not have to be yours. Launch can provision a cloud Mac in your own AWS account (an EC2 Mac), build over SSH on any Mac you can reach, or hand off to Expo EAS's cloud. Android builds anywhere a JDK runs, with no Mac at all.

**Does Launch support Android and Google Play?** Yes. Launch builds and signs Android apps and uploads them to Google Play, and it reconciles Play in-app products, subscriptions (base plans + offers), release tracks, and review replies from the same \`launch.config.ts\` catalog that drives App Store Connect — one source of truth for both stores.

**Does Launch do over-the-air updates like EAS Update?** Yes. \`launch update\` publishes JS and asset updates over the Expo Updates protocol your \`expo-updates\` runtime already speaks — code-signed and hosted on your own bucket (S3 / R2 / Supabase) instead of Expo's servers. \`launch updates rollback\` reverses a bad release by promoting a known-good update or dropping clients back to the embedded bundle.

**How do I migrate from Expo EAS to Launch?** Swap the commands one-for-one (\`eas build\` → \`launch build\`, \`eas submit\` → \`launch release\`, \`eas update\` → \`launch update\`, \`eas credentials\` → \`launch creds\`, \`eas metadata\` → \`launch metadata\`). If your app already ships, \`launch adopt\` reads its live App Store Connect setup — products, capabilities, signing, and listing — and writes it back into \`launch.config.ts\` in one step. Launch can also still hand off to \`eas build\` when you have no Mac, so you can migrate incrementally.

**Is Launch just an App Store Connect SDK or MCP wrapper?** No. An App Store Connect SDK or MCP server wraps a slice of Apple's API. Launch drives the entire release across Apple and Google — code signing, native builds, size checks, store-config-as-code, the confirmed public release, and OTA updates — none of which an API wrapper touches. If you want a self-hosted Expo EAS rather than an API client, that is Launch.

**How is Launch different from Fastlane?** Fastlane is a building block; Launch orchestrates it. Launch drives fastlane for the iOS archive (\`gym\`), the TestFlight / App Store upload (\`pilot\`), and store-listing metadata (\`deliver\` / \`supply\`), and wraps the whole release around it: credential provisioning, the native build, the real download-size check, store-config-as-code for both stores, the deliberate public release, phased-rollout control, and OTA updates — all from one typed \`launch.config.ts\`.

**Where are my signing keys and secrets stored?** In your OS keychain. Your App Store Connect API key (\`.p8\`), distribution private key, and Android upload key never touch the repo or anyone's servers — only a certificate-signing request (CSR) is ever sent to Apple. Build secrets live in the keychain too, via \`launch secret\`, so they stay out of a committed \`.env\`.

**What do I need to run Launch?** Node 20+ everywhere. For iOS: macOS with Xcode and its command-line tools, fastlane, and an App Store Connect API key (\`.p8\` + Key ID + Issuer ID) — or a remote Mac if you do not have one. For Android: a JDK (any OS) and a Google Play service-account JSON key. Run \`launch doctor\` to check it all at once.

**How much does Launch cost?** Launch itself is free (MIT). You pay only for what you would pay anyway: your own build hardware (or cloud-Mac time if you build iOS without a local Mac), plus the usual Apple Developer ($99/yr) and Google Play (one-time $25) registration fees. There is no per-build charge and no subscription.

**Does Launch run in CI?** Yes. \`launch ci init\` scaffolds a GitHub Actions workflow on a hosted macOS runner, and every command degrades to non-interactive when it detects CI, a piped stdout, or an agent — so the same flow runs unattended.

**What frameworks does Launch support?** Expo and bare React Native apps that describe themselves through Expo config (\`app.json\` / \`app.config.{ts,js}\`) and \`expo prebuild\`. Launch reads your bundle id, version, and entitlements from there, so nothing is duplicated.

**Can Launch manage store metadata, in-app purchases, and subscriptions?** Yes — as code, for both stores. \`launch sync\` reconciles IAPs, subscriptions, pricing, capabilities, and the per-locale listing (copy, screenshots, previews) onto App Store Connect; \`launch metadata\` covers the listing for iOS and Android; \`launch play-products\` / \`launch play-subscriptions\` drive the Google Play catalog. Each runs a read-only plan → confirm → apply, so it never clobbers a live or in-review version.

**Does Launch lock me into a hosted service?** No — there is nothing hosted and nothing proprietary. Launch is MIT-licensed, built on fastlane, Gradle, and the platforms' own APIs, with pluggable storage / credentials / build / submit providers. Your keys, artifacts, and updates live in infrastructure you control, so there is nothing to migrate off later.

**How do I get started?** Install with \`npm install --global launch-store\` (or \`--save-dev\` per project), then run \`launch demo\` for a 60-second simulated walkthrough — no setup or account needed. When you are ready: \`launch init\` → \`launch creds set-key\` → \`launch creds setup\` → \`launch build ios\`.`;

/** A stable question from {@link GENERATIVE_AI_FAQ} the consistency test greps for in `llms.txt` and the README. */
export const FAQ_SIGNATURE = "Is Launch a free, open-source alternative to Expo EAS?";

/**
 * The HTML-comment fences around the English README's `## FAQ` body. `npm run docs:gen` rewrites only
 * the text between these markers (via {@link spliceReadmeFaq}), so the English FAQ is generated from
 * {@link GENERATIVE_AI_FAQ} — never hand-edited — and can't drift from `llms.txt`. Only the English README
 * carries these fences; the translated READMEs keep a hand-translated FAQ, guarded by the parity test.
 */
export const FAQ_REGION_START =
  "<!-- faq:start — generated by `npm run docs:gen` from GENERATIVE_AI_FAQ; edit the source, then regenerate. -->";

/** Closing fence for the English README FAQ region; see {@link FAQ_REGION_START}. */
export const FAQ_REGION_END = "<!-- faq:end -->";

/**
 * One titled group in the {@link FEATURE_SECTIONS} capability map: a bold section label, an optional
 * one-line lead, and the single-line capability statements under it. Kept as data (not prose) so
 * {@link renderFeaturesList} can number every item continuously (1..N) across sections and the README +
 * `llms.txt` feature lists render from one source instead of two hand-maintained copies.
 */
export interface FeatureSection {
  /** the bold section label, e.g. `Build & ship — iOS and Android`. */
  title: string;
  /** an optional one-line lead rendered under the title, before the numbered items (e.g. the reconcile model). */
  intro?: string;
  /** the section's capabilities, each a single-line markdown statement of the form `**Name.** summary`. */
  features: string[];
}

/**
 * The canonical, ordered capability map of Launch — the single source for the README's `## Features`
 * section and the `llms.txt` `## Features` section, so the human- and AI-facing feature lists can't
 * drift. {@link renderFeaturesList} numbers every item continuously (1..N) across these sections; the
 * consistency test asserts {@link FEATURES_SIGNATURE} survives on both surfaces. Each line is true to a
 * shipped command/behavior — edit here, then run `npm run docs:gen`.
 */
export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    title: "Set up & verify",
    features: [
      "**Config in one step.** `launch init` detects your app(s) — including an `apps/*` monorepo — and writes a commented `launch.config.ts` plus a starter `.env.example`, touching no credentials or native code.",
      "**Onboard a live app.** `launch adopt` imports an already-shipping app's App Store Connect setup — products, capabilities, listing, signing — back into `launch.config.ts`.",
      "**Keys in your keychain.** `launch creds set-key` validates your `AuthKey_*.p8` against Apple and vaults it in your OS keychain; `creds use`/`rename`/`remove` switch between teams.",
      "**APNs push-key vault.** `launch creds push-key` safe-keeps a download-once APNs auth key and re-exports it on demand — Apple exposes no API to recreate one.",
      "**Secrets, not plaintext `.env`.** `launch secret set`/`list`/`rm` stores build secrets in your OS keychain, scoped per app/profile, and injects them into the build env.",
      "**One-command doctor.** `launch doctor --fix` detects the iOS/Android toolchain, installs the missing brew-able tools behind a single consent, and flags store-side blockers.",
      "**Hands-off setup.** `launch setup` scaffolds config, installs tools, renders a readiness board, and rehearses the whole pipeline as a dry run.",
      "**Signing status at a glance.** `launch setup ios` reports active account, App ID, capabilities, certificate, profile, and registered devices — with `--provision` to ensure them.",
    ],
  },
  {
    title: "Configure App Store Connect — as code",
    intro:
      "Each is declared in `launch.config.ts` (or a `*.config.json` sidecar) and reconciled with a read-only **plan → your confirmation → apply** — idempotently, never touching a live or in-review version. This is the surface EAS leaves to the website.",
    features: [
      "**Products, pricing & listing.** `launch sync` reconciles in-app purchases, subscriptions, capabilities, and pricing onto App Store Connect — plus the per-locale listing copy, screenshots, and app previews — across every app at once.",
      "**Preview & gate drift.** `launch plan [surface]` diffs `launch.config.ts` against live App Store Connect and Google Play state read-only across every config-as-code surface — capabilities, IAPs, subscriptions, pricing and listing, plus release attributes, Game Center, App Clips, availability, accessibility, experiments, custom pages, and team-level Wallet & EU distribution; `launch drift` fails CI when they've diverged.",
      "**Subscription offers.** `launch offers` reconciles offer codes and promotional, introductory & win-back offers, plus the promoted-purchase order; `offers generate-codes`/`list`/`deactivate` drive campaigns from the CLI.",
      "**Release attributes.** `launch release-config` reconciles the age rating, categories, base price, and App Review details (contact + demo account) onto the editable version.",
      "**Store availability.** `launch availability` sets the App Store territories the app sells in.",
      "**Custom product pages.** `launch custom-pages` reconciles alternate App Store listings.",
      "**Product-page A/B tests.** `launch experiments` reconciles product-page experiments and their treatments.",
      "**In-app events.** `launch events list`/`create`/`localize`/`delete` manages App Store in-app events and their localizations.",
      "**Game Center.** `launch game-center` reconciles achievements and leaderboards.",
      "**Accessibility labels.** `launch accessibility` reconciles the accessibility nutrition labels.",
      "**App Clips.** `launch app-clips` reconciles each App Clip card's action and per-locale subtitle.",
      "**Wallet & Apple Pay ids.** `launch wallet` registers Apple Pay merchant ids and Wallet pass type ids.",
      "**EU distribution (DMA).** `launch eu-distribution` authorizes alternative-distribution domains and registers the package-signing key.",
      "**Listing round-trip.** `launch metadata pull`/`push` syncs the full store listing for iOS _and_ Android — `eas metadata` is iOS-only.",
    ],
  },
  {
    title: "Configure Google Play — as code",
    features: [
      "**Play products & subscriptions.** `launch play-products` and `launch play-subscriptions` reconcile your Play in-app products and subscriptions (base plans + offers) from the **same** `launch.config.ts` catalog that drives App Store Connect.",
      "**Tracks.** `launch play-tracks` shows track status and promotes a build to a track at a chosen rollout with release notes, and reads/sets tester groups.",
      "**Play reviews.** `launch play-reviews list`/`reply` reads Play customer reviews (with optional machine translation) and posts replies — without the Play Console.",
    ],
  },
  {
    title: "Build & ship — iOS and Android",
    features: [
      "**One command per platform.** `launch build ios` / `launch build android` runs prebuild → sign → size-check → upload to the testing track (TestFlight / Play internal) — the same flow EAS runs.",
      "**Fast by default.** ccache wires in at `pod install`, DerivedData stays warm, and a native-graph fingerprint forces a clean build only when your native deps actually change; `--clean` forces from scratch.",
      "**Build-time ETA & progress bar.** A learned per-build estimate drives a live progress bar; `--verbose` streams the raw `xcodebuild`/Gradle output instead.",
      "**Real download-size check.** Reports the actual per-device size (App Thinning report / bundletool) and gates on the `sizeBudgetMB` you configured.",
      "**Safety nets.** Refuses to upload a simulator build, a `.app`, or an empty artifact; `--dry-run` rehearses the whole pipeline with no network, build, or account changes.",
      "**Keep server vars out of the app.** An `envExclude` denylist in `launch.config.ts` (exact names or `PREFIX*` wildcards) drops backend-only environment variables before the build, so they're never injected into the shipped bundle.",
      "**Deliberate public release.** The testing track is the default; `launch release <platform>` drives the public store over the API end to end — version, compliance, notes, rollout, submit — with no portal.",
      "**Steer the rollout.** `launch status [--watch]` tracks the review with CI exit codes; `launch rollout pause`/`resume`/`complete` steers an iOS phased release.",
      "**Coordinated release train.** `launch release-train` drives an app's iOS, Android, and OTA legs as one resumable record — `start`/`status`/`release`/`abort`, with `--hold` to gate every leg until all are approved and release them together, `--platform`/`--no-ota` to scope it, and `--watch` to poll until it settles.",
      "**Re-sign without rebuilding.** `launch build:resign` re-signs a stored `.ipa`/`.aab` with different credentials straight from the artifact.",
      "**Completion notifications.** A `notify` block pings a Slack/Discord webhook and/or runs a shell hook when a build or submit finishes — on success _and_ failure.",
    ],
  },
  {
    title: "Build without a Mac",
    features: [
      "**Cloud Mac in your own AWS.** `launch build ios --remote aws` provisions an EC2 Mac, builds over SSH, and auto-releases it near the 24-hour billing floor; `launch cloud` manages the host lifecycle and shows running cost.",
      "**Any Mac over SSH.** `launch build ios --remote user@host` builds on a Mac you already have, with no allocation and no billing.",
      '**Hand off to EAS.** Set `buildEngine: "eas"` to delegate the build to Expo\'s cloud and still ship through Launch — handy for migrating incrementally.',
    ],
  },
  {
    title: "Distribute & update",
    features: [
      "**Internal distribution.** `launch build <platform> --distribution internal` hosts an ad-hoc iOS install link / Android `.apk` on your own bucket; register testers with `launch device add <udid>`.",
      "**Over-the-air updates.** `launch update` publishes a code-signed JS/asset update via the **Expo Updates protocol** your `expo-updates` runtime already speaks, hosted on your own bucket (S3 / R2 / Supabase).",
      "**Roll back a bad update.** `launch updates list`/`view` show the per-channel history; `launch updates rollback` promotes a known-good update or drops clients back to the embedded bundle.",
      "**Pluggable storage.** Artifacts and updates live in local storage or your own S3 / R2 / Supabase bucket, served from a URL you control — no hosted service.",
    ],
  },
  {
    title: "Manage testers, team, reviews & reports — API-key only",
    features: [
      "**TestFlight from the CLI.** `launch testflight groups`/`create-group`/`testers`/`add`/`rm` manages beta groups and invites testers, and `testflight release` submits a build for Beta App Review — no Apple-ID password, no 2FA.",
      "**Reviews, read & reply.** `launch reviews list`/`reply`/`delete` reads App Store reviews (filter by rating/territory) and posts, replaces, or removes the developer response.",
      "**Sales, finance & analytics.** `launch reports sales`/`finance`/`analytics` downloads App Store Connect's reports (gzipped TSV, or `--json`) straight to your machine.",
      "**Team & access.** `launch team list`/`invite`/`remove` reads and manages App Store Connect team members and pending invitations over the same API key.",
      "**Sandbox testers.** `launch sandbox list`/`clear` lists your StoreKit sandbox testers and clears their purchase history for clean in-app-purchase re-tests.",
    ],
  },
  {
    title: "Inspect & debug",
    features: [
      "**Build history.** `launch builds list`/`view`/`log`/`prune` reads the local artifact index — ids, per-device sizes, paths, and redacted logs — and prunes binaries past the retention window.",
      "**Install & run.** `launch run [id|latest]` installs a built artifact onto a connected device (`adb`/`bundletool` for Android, `devicectl` for iOS).",
      "**Explain a failure.** `launch diagnose` maps an `xcodebuild`/Gradle/CocoaPods error to a plain-English cause and fix.",
      "**Why clean vs incremental.** `launch fingerprint` shows the native fingerprint and why the next build will be clean or incremental.",
      "**Tell your Apple accounts apart.** `launch creds` leads its account summary with the app names each API key can see, so you know which Apple account — and which apps — a build will use before you ship.",
    ],
  },
  {
    title: "Onboarding, teaching & maintenance",
    features: [
      "**Animated launch banner.** A glowing pixel-art `LAUNCH` wordmark with an aurora violet→cyan gradient greets you on startup — an adoptable banner style that still degrades to plain text under `NO_COLOR`.",
      "**Zero-setup demo.** `launch demo` replays a simulated walkthrough of the whole build → sign → submit pipeline, and auto-plays once on first run.",
      "**Teaching on demand.** `--explain` on any command and `launch explain <topic>` cover the Apple/iOS/Android terminology inline.",
      "**Interactive wizard.** Running bare `launch` opens a guided wizard that remembers your last flow and offers a one-keypress repeat.",
      "**Drive it from an AI agent.** `launch agents init`/`check` scaffolds Claude / Cursor / Codex skills so coding agents run the workflows under the same plan → confirm → apply guardrails.",
      "**CI in one command.** `launch ci init` scaffolds a GitHub Actions workflow that builds and ships unattended.",
      "**Silent self-upgrade.** Picks up a newer npm release and re-runs your command on it — throttled to once a day, and a no-op in CI, when piped, and for agents.",
    ],
  },
];

/** A stable phrase from the first {@link FEATURE_SECTIONS} item the consistency test greps for in `llms.txt` and the README. */
export const FEATURES_SIGNATURE = "Config in one step";

/**
 * The HTML-comment fences around the README's `## Features` list. `npm run docs:gen` rewrites only the
 * text between these markers (via {@link spliceReadmeFeatures}) from {@link FEATURE_SECTIONS}, so the
 * English README's feature list can't drift from `llms.txt`. English only — the translated READMEs keep a
 * hand-translated Features section, held in structural parity by the README parity test.
 */
export const FEATURES_REGION_START =
  "<!-- features:start — generated by `npm run docs:gen` from FEATURE_SECTIONS; edit the source, then regenerate. -->";

/** Closing fence for the README Features region; see {@link FEATURES_REGION_START}. */
export const FEATURES_REGION_END = "<!-- features:end -->";

/** Curated prose describing the EAS-parity pipeline, lifted verbatim into both llms files. */
const PIPELINE_PROSE = `Launch runs the EAS pipeline locally: prebuild → resolve credentials → compile & sign → size-check → store → submit to the testing track (TestFlight / Play internal); \`launch release\` is the separate, confirmed public release. EAS → Launch mapping: \`eas build\` → \`launch build\`, \`eas submit\` → \`launch release\`, \`eas update\` → \`launch update\` (Expo Updates protocol, hosted on your own S3/R2/Supabase bucket, with \`launch updates rollback\`), \`eas metadata\` → \`launch metadata\` (iOS _and_ Android), \`eas credentials\` → \`launch creds\` (multi-account, keychain-stored, with an APNs push-key vault). Beyond parity it adds store config as code (\`launch sync\` reconciles IAPs, subscriptions, and capabilities onto App Store Connect), keychain-backed build secrets with a documented env-precedence ladder (\`launch secret\`), internal/ad-hoc distribution, build history and re-signing (\`launch builds\`, \`launch build:resign\`), native-failure diagnosis (\`launch diagnose\`), and no-Mac builds on your own AWS EC2 Mac or any Mac over SSH. Signing keys stay in the OS keychain (macOS Keychain, or the platform secret store elsewhere); storage, credentials, build engine, and submission are pluggable behind small interfaces. App facts come from each \`app.json\`, so nothing is duplicated. \`launch demo\` walks the whole flow as a zero-setup simulation.`;

/** Curated "Source" link list, shared by both llms files; every link is asserted to resolve on disk. */
const SOURCE_LINKS = `- [Domain types & provider interfaces](./src/core/types.ts): the single source of truth for Launch's vocabulary (incl. SecretStore, ComputeHost).
- [Pipeline](./src/core/pipeline.ts): the build → submit spine, the shared \`prepareBuild\` front half, and the \`--dry-run\` rehearsal.
- [Remote pipeline](./src/core/remotePipeline.ts): the C1–C7 host lifecycle for off-Mac builds; [EAS pipeline](./src/core/easPipeline.ts): the Expo handoff.
- [AWS EC2 Mac host](./src/providers/compute/awsEc2Mac.ts): allocate/status/teardown + golden-AMI + \`cloud doctor\`; [SSH transport](./src/core/ssh.ts) and [remote build ops](./src/core/remoteBuild.ts).
- [Glossary](./src/core/glossary.ts): plain-English term definitions shared by \`launch explain\` and the docs.
- [App Store Connect client](./src/apple/ascClient.ts): the Apple API integration (JWT auth, bundle ids, certs, profiles, builds).
- [ASC product sync](./src/core/ascSync.ts): the declarative reconciler behind \`launch sync\` (capabilities, IAPs, subscriptions, pricing).
- [Config preflight](./src/core/configCheck.ts): the app-config footgun validator run by \`launch doctor\` and at the head of \`launch build\`.
- [Build secrets](./src/core/buildSecrets.ts): keychain-backed \`launch secret\` storage, injected through the [env-precedence ladder](./src/core/env.ts) shared by \`build\`, \`release\`, and \`update\`.
- [Completion notifications](./src/core/notify.ts): the \`notify\` webhook + shell hook fired on build/submit completion.
- [Public API](./src/index.ts): what a user's \`launch.config.ts\` imports (\`defineConfig\`, the \`products\` catalog, the \`notify\` config).`;

/**
 * Escape a markdown table cell's structural characters — backslash and pipe — in one pass. Escaping
 * both together (rather than only `|`) means a literal backslash in the text can't combine with a
 * following pipe to slip an unescaped delimiter through and split the cell; prettier handles the rest.
 * Shared with the config reference renderer ({@link import("./configDocs.js")}) — table-cell escaping
 * is one concern, so both generated docs escape identically.
 */
export function escapeCell(text: string): string {
  return text.replace(/[\\|]/g, (ch) => `\\${ch}`);
}

/** Render a command's flag table, or `""` when it has no options. */
function renderOptionsTable(options: OptionSpec[]): string {
  if (options.length === 0) return "";
  const rows = options.map((o) => `| \`${escapeCell(o.flags)}\` | ${escapeCell(o.description)} |`);
  return ["", "| Flag | Description |", "| --- | --- |", ...rows].join("\n");
}

/** Render one command (heading + description + flag table) and, recursively, its subcommands. */
function renderCommand(command: CommandSpec, level: number): string {
  const usage = command.args ? `launch ${command.path} ${command.args}` : `launch ${command.path}`;
  const parts = [`${"#".repeat(level)} \`${usage}\``, "", command.description];
  const table = renderOptionsTable(command.options);
  if (table) parts.push(table);
  for (const sub of command.subcommands) parts.push("", renderCommand(sub, level + 1));
  return parts.join("\n");
}

/** Render `docs/commands.md`: the generated header, the live-stats blockquote, and every command. */
export function renderCommandReference(commands: CommandSpec[], stats: DocStats): string {
  const header =
    "<!-- AUTOGENERATED by `npm run docs:gen` — do not edit by hand; edit the commands, then regenerate. -->";
  const blockquote = `> Launch wraps **${stats.operations} App Store Connect & Google Play API operations** across **${stats.commands} commands**, guarded by **${stats.tests} tests**.`;
  const intro =
    "Generated from the `commander` definitions in `src/cli/` by `npm run docs:gen` — edit the commands, then regenerate. For the curated overview, install, and configuration, see the [README](../README.md).";
  const body = commands.map((command) => renderCommand(command, 2)).join("\n\n");
  return `${header}\n\n# Launch command reference\n\n${blockquote}\n\n${intro}\n\n${body}\n`;
}

/** Render one command as an `llms.txt` bullet (and its subcommands as nested bullets). */
function renderCommandBullet(command: CommandSpec, indent: string): string {
  const usage = command.args ? `launch ${command.path} ${command.args}` : `launch ${command.path}`;
  const lines = [`${indent}- \`${usage}\` — ${command.description}`];
  for (const sub of command.subcommands) lines.push(renderCommandBullet(sub, `${indent}  `));
  return lines.join("\n");
}

/**
 * Render `llms.txt`: the single AI-facing map of Launch — the llmstxt.org summary blockquote, the
 * EAS-parity prose, the {@link WHAT_LAUNCH_IS_BLOCK is/is-not} disambiguation, the {@link GENERATIVE_AI_FAQ FAQ}
 * AI engines lift to answer "EAS alternative" queries, the full command list (so one fetch ingests the
 * whole surface), and the curated doc/source links. Merged from the former `llms.txt` + `llms-full.txt`
 * into one file at the conventional `/llms.txt` endpoint that crawlers probe for.
 */
export function renderLlmsTxt(commands: CommandSpec[], stats: DocStats): string {
  const everyCommand = commands.map((command) => renderCommandBullet(command, "")).join("\n");
  return `# Launch

> ${CANONICAL_SENTENCE}

${PIPELINE_PROSE}

## What Launch is — and is not

${WHAT_LAUNCH_IS_BLOCK}

## Features

Everything Launch does, grouped and numbered:

${renderFeaturesList()}

## FAQ

${GENERATIVE_AI_FAQ}

## Commands

All ${stats.commands} \`launch\` commands (${stats.operations} store-API operations underneath, ${stats.tests} tests):

${everyCommand}

## Docs

- [README](./README.md): install, quick start, the command surface, configuration, and how credentials are handled.
- [CONTRIBUTING](./CONTRIBUTING.md): dev setup, the quality gate, adding a provider, tests, and CI.
- [AGENTS](./AGENTS.md): working rules for AI agents and contributors.

## Reference

- [Command reference](./docs/commands.md): all ${stats.commands} \`launch\` commands and every flag, generated from the CLI.

## Source

${SOURCE_LINKS}

## Optional

- [Example app](./examples/hello-world): a worked \`app.json\` + \`launch.config.ts\`.
- [LICENSE](./LICENSE): MIT.
`;
}

/**
 * Render the README's live-stats badge row from {@link DocStats}: the store-API endpoint count, the
 * full-CRUD lifecycle marker, and the passing-test count, all centered under the hero badges. The
 * numbers are generated (never hand-typed) so they track the real codebase — the endpoint and test
 * badges move with every new API method or test, and `docs:check` fails the build if the committed
 * README drifts, exactly like the generated command reference. The CRUD badge is qualitative (the two
 * clients implement create/read/update/delete across the catalog), so it carries no number to go stale.
 *
 * Returns the block *including* both {@link STATS_BADGES_START} / {@link STATS_BADGES_END} fences so
 * {@link spliceReadmeBadges} can swap the whole region in one slice and the marker text lives in one place.
 */
export function renderStatsBadges(stats: DocStats): string {
  const endpoints = `https://img.shields.io/badge/store%20API-${stats.operations}%20endpoints-8957e5?logo=apple&logoColor=white`;
  const crud = "https://img.shields.io/badge/CRUD-full%20lifecycle-1f6feb";
  const tests = `https://img.shields.io/badge/tests-${stats.tests}%20passing-3fb950?logo=vitest&logoColor=white`;
  return [
    STATS_BADGES_START,
    "",
    '<p align="center">',
    `  <a href="./docs/commands.md"><img src="${endpoints}" alt="${stats.operations} App Store Connect &amp; Google Play API operations" /></a>`,
    `  <img src="${crud}" alt="Full create / read / update / delete coverage across the store APIs" />`,
    `  <a href="https://github.com/YosefHayim/launch-store/actions/workflows/ci.yml"><img src="${tests}" alt="${stats.tests} tests passing" /></a>`,
    "</p>",
    "",
    STATS_BADGES_END,
  ].join("\n");
}

/**
 * Replace everything between a start/end HTML-comment fence in `content` with `replacement` (the markers
 * are part of `replacement`, so the whole region is swapped in one slice). Throws when either fence is
 * missing rather than silently appending — a dropped marker means the README was edited in a way that
 * would lose the generated section, and the build should fail loudly so it gets fixed. Shared by the
 * badge and FAQ splices so both regions are managed exactly the same way.
 */
function spliceRegion(
  content: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
  label: string,
): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error(
      `README.md is missing the ${label} markers — add the fences back so \`docs:gen\` can regenerate the ${label} region.`,
    );
  }
  return content.slice(0, start) + replacement + content.slice(end + endMarker.length);
}

/**
 * Splice a freshly {@link renderStatsBadges rendered} badge row into a README, replacing the whole
 * {@link STATS_BADGES_START}…{@link STATS_BADGES_END} region. Applied to every `README*.md`: the badge
 * URLs are language-neutral, so the same block goes into the English README and all translations.
 */
export function spliceReadmeBadges(readme: string, badges: string): string {
  return spliceRegion(readme, STATS_BADGES_START, STATS_BADGES_END, badges, "stats-badges");
}

/**
 * Render the English README's FAQ region from {@link GENERATIVE_AI_FAQ}, fenced by
 * {@link FAQ_REGION_START}/{@link FAQ_REGION_END} so {@link spliceReadmeFaq} can swap the whole block.
 * The FAQ thus has one source and stays byte-identical to the `## FAQ` section {@link renderLlmsTxt} emits.
 */
export function renderFaqRegion(): string {
  return [FAQ_REGION_START, "", GENERATIVE_AI_FAQ, "", FAQ_REGION_END].join("\n");
}

/**
 * Splice the {@link renderFaqRegion rendered} FAQ into the English README, replacing the whole
 * {@link FAQ_REGION_START}…{@link FAQ_REGION_END} region. English only — the source block is English, so
 * translated READMEs carry a hand-translated FAQ that the README structural-parity test keeps in sync.
 */
export function spliceReadmeFaq(readme: string, faq: string): string {
  return spliceRegion(readme, FAQ_REGION_START, FAQ_REGION_END, faq, "faq");
}

/**
 * Render the numbered capability map from {@link FEATURE_SECTIONS}: each section as a bold label (and its
 * optional lead line) followed by its features as a markdown ordered list, numbered **continuously**
 * across sections (1..N) so the whole feature surface reads as one ordered list. Pure and arg-free — the
 * same output is spliced into the README and inlined into `llms.txt`, so the two can't drift. The
 * continuing ordinal is emitted explicitly per section, which prettier preserves when it reformats.
 */
export function renderFeaturesList(): string {
  let n = 0;
  return FEATURE_SECTIONS.map((section) => {
    const lead = section.intro ? [section.intro, ""] : [];
    const items = section.features.map((feature) => `${(n += 1)}. ${feature}`);
    return [`**${section.title}**`, "", ...lead, ...items].join("\n");
  }).join("\n\n");
}

/**
 * Render the README's Features region from {@link renderFeaturesList}, fenced by
 * {@link FEATURES_REGION_START}/{@link FEATURES_REGION_END} so {@link spliceReadmeFeatures} can swap the
 * whole block. English only — the translated READMEs carry a hand-translated Features section.
 */
export function renderFeaturesRegion(): string {
  return [FEATURES_REGION_START, "", renderFeaturesList(), "", FEATURES_REGION_END].join("\n");
}

/**
 * Splice the {@link renderFeaturesRegion rendered} Features list into the English README, replacing the
 * whole {@link FEATURES_REGION_START}…{@link FEATURES_REGION_END} region. English only, exactly like the
 * FAQ — the source is English and the translated READMEs keep a hand-translated Features section.
 */
export function spliceReadmeFeatures(readme: string, region: string): string {
  return spliceRegion(readme, FEATURES_REGION_START, FEATURES_REGION_END, region, "features");
}

/**
 * The shared "drive Launch from your AI agent" callout. Like the live-stats badge row, it is
 * language-neutral (mostly command names) and spliced into EVERY README, so a reader in any language
 * learns that `launch agents init` scaffolds Claude / Cursor / Codex skills from this repo — letting an
 * agent run the documented workflows under Launch's plan → confirm → apply guardrails. Single source of
 * truth: edited here, regenerated into all READMEs by `npm run docs:gen`, gated by `docs:check`. The
 * workflow list mirrors the six task skills in `src/core/agents/registry.ts` (kept honest there by
 * `findUnknownCommands`); this is a prose summary, not the authoritative list.
 */
export const AGENT_SKILLS_BLURB =
  "> **Driving Launch from an AI agent?** `launch agents init` scaffolds ready-made skills into your repo — Claude Skills (`.claude/skills/`), Cursor rules (`.cursor/rules/`), and a Launch section in `AGENTS.md` for Codex — so Claude Code, Cursor, and Codex can run the workflows above (ship, release, store-config-as-code, OTA updates, CI, and `launch doctor`) with the same plan → confirm → apply guardrails Launch uses, and never publish without your say-so. `launch agents check` keeps them in sync.";

/** A stable phrase from {@link AGENT_SKILLS_BLURB} the consistency test greps for in every README. */
export const AGENT_SKILLS_SIGNATURE = "Driving Launch from an AI agent?";

/**
 * The HTML-comment fences around the README's agent-skills callout. `npm run docs:gen` rewrites only the
 * text between these markers (via {@link spliceReadmeAgentSkills}). The callout is heading-less by design,
 * so splicing it into the translated READMEs leaves their `##` section skeleton — and the structural-parity
 * test — untouched. Kept here beside the other generated-region markers.
 */
export const AGENT_SKILLS_START =
  "<!-- agent-skills:start — generated by `npm run docs:gen` from AGENT_SKILLS_BLURB; edit the source, then regenerate. -->";

/** Closing fence for the README agent-skills region; see {@link AGENT_SKILLS_START}. */
export const AGENT_SKILLS_END = "<!-- agent-skills:end -->";

/**
 * Render the README's agent-skills callout from {@link AGENT_SKILLS_BLURB}, fenced by
 * {@link AGENT_SKILLS_START}/{@link AGENT_SKILLS_END} so {@link spliceReadmeAgentSkills} can swap the whole
 * region. Language-neutral, so the same block is spliced into the English README and every translation.
 */
export function renderAgentSkillsRegion(): string {
  return [AGENT_SKILLS_START, "", AGENT_SKILLS_BLURB, "", AGENT_SKILLS_END].join("\n");
}

/**
 * Splice the {@link renderAgentSkillsRegion rendered} agent-skills callout into a README, replacing the
 * whole {@link AGENT_SKILLS_START}…{@link AGENT_SKILLS_END} region. Applied to every `README*.md`, exactly
 * like the badge row — the callout is language-neutral.
 */
export function spliceReadmeAgentSkills(readme: string, region: string): string {
  return spliceRegion(readme, AGENT_SKILLS_START, AGENT_SKILLS_END, region, "agent-skills");
}

/** Count public async methods (`  async name(`) in one API-client source — the {@link DocStats.operations} unit. */
export function countAsyncMethods(source: string): number {
  return (source.match(/^[ \t]*async\s+[A-Za-z_$]/gm) ?? []).length;
}

/** Count test cases (`it(` / `test(` calls, including `.each` / `.skip`) across the given test sources. */
export function countTestCases(sources: string[]): number {
  return sources.reduce(
    (total, source) => total + (source.match(/^[ \t]*(?:it|test)(?:\.[a-z]+)?\(/gm) ?? []).length,
    0,
  );
}
