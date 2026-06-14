<p align="center">
  <img src="assets/launch-logo.png" alt="Launch" width="220" />
</p>

<h1 align="center">Launch</h1>

<p align="center">
  <strong>Launch is the open-source, self-hosted alternative to Expo EAS — set up signing, configure the stores, build, and ship your Expo &amp; React Native app to TestFlight &amp; Google Play from the machine you already own. Your keys, your hardware, no Expo bill.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/launch-store"><img src="https://img.shields.io/npm/v/launch-store?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/launch-store"><img src="https://img.shields.io/npm/dm/launch-store?logo=npm&color=cb3837" alt="npm downloads" /></a>
  <a href="https://github.com/YosefHayim/launch-store/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/YosefHayim/launch-store/ci.yml?branch=main&logo=github&label=CI" alt="CI status" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/launch-store?color=blue" alt="MIT license" /></a>
  <img src="https://img.shields.io/node/v/launch-store?logo=node.js&color=339933" alt="Node version" />
  <img src="https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white" alt="TypeScript types included" />
</p>

Shipping an app is more than a build: signing setup, App Store Connect / Play Console config, in-app
purchases, listing metadata, the upload, and the over-the-air updates after. EAS builds and submits —
the rest is scattered across Apple's and Google's portals and a handful of tools. Launch pulls the
**whole release** into one local, declarative workflow: it provisions your signing, reconciles your
store products, generates the native project, builds and signs the binary, reports the real per-device
download size, stores the artifact, and uploads to the testing track — on hardware you own, with keys
that stay in your local keychain. iOS signing needs a Mac; if you don't have one, Launch builds on a
cloud Mac in **your own** AWS account or hands off to Expo EAS — see [Building without a Mac](#building-without-a-mac).

> **New here?** Run `launch demo` for a 60-second simulated walkthrough of the whole pipeline — no
> setup, no build, no account needed. It also auto-plays the first time you run `launch`.

<table align="center">
  <tr>
    <td align="center"><img src="assets/badges/zero-build-cost.jpg" alt="Zero build cost — $0 on your machine, stop renting Expo builds" width="250" /></td>
    <td align="center"><img src="assets/badges/no-queue-wait.jpg" alt="No queue wait — build on your own machine, no shared cloud line" width="250" /></td>
    <td align="center"><img src="assets/badges/no-timeout-limit.jpg" alt="No timeout limit — run as long as needed, no 45-minute or 2-hour cap" width="250" /></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/badges/keys-stay-local.jpg" alt="Keys stay local — signing keys stay in your OS keychain and never leave your machine" width="250" /></td>
    <td align="center"><img src="assets/badges/no-vendor-lock-in.jpg" alt="No vendor lock-in — MIT-licensed with swappable providers, you stay in control" width="250" /></td>
    <td align="center"><img src="assets/badges/best-for-mac-owners.jpg" alt="Best for Mac owners — if you own a Mac, Launch makes sense (developer accounts still required)" width="250" /></td>
  </tr>
</table>

## Why Launch

The build was never the hard part — the release around it is. Launch owns that whole surface, locally
and open source:

- **The whole release, one workflow.** Signing, store products, build, size-check, upload, and OTA
  updates come from one `launch.config.ts` and a handful of commands — not a dozen dashboards and CI
  snippets.
- **Store setup as code.** `launch sync` reconciles in-app purchases, subscriptions, and capabilities
  onto App Store Connect from config; `launch metadata` does the same for your listing. These are the
  parts EAS leaves you to click through by hand.
- **$0 compute, unlimited builds.** EAS bills by build, caps the free tier behind a 45-minute timeout,
  and runs **$19–$199/mo** plus overage on paid plans. Launch builds on your own machine — no meter, no
  queue, no timeout.
- **Your keys stay local.** Your distribution certificate, App Store Connect API key, and Android upload
  key stay in your OS keychain; Launch only ever sends a CSR to Apple. (Building without a Mac is the one
  exception — see below.)
- **No lock-in, ever.** MIT-licensed, built on `fastlane`, Gradle, and the platforms' own APIs, with
  pluggable storage/credentials/build/submit providers. Nothing proprietary to migrate off later.
- **It teaches as it runs.** Add `--explain` to any command — or run `launch demo` — to expand each step
  (CSR, provisioning profile, TestFlight, Play track, subscription group) into plain English.

## Features

**Set up & verify**

- **Config in one step.** `launch init` detects your app(s) — including an `apps/*` monorepo — and writes
  a commented `launch.config.ts` (+ a starter `.env.example`). It only writes config; it never touches
  credentials or the native project.
- **Keys in your keychain.** `launch creds set-key` finds the `AuthKey_*.p8` in `~/Downloads`, validates
  it against Apple, and stores it in your OS secret store; `creds setup` registers the app id + creates or
  reuses the signing assets; multi-account `creds use/rename/remove` switches between teams. `creds push-key`
  vaults a download-once APNs auth key (Apple has no API to create one) and re-exports it on demand.
- **Secrets, not plaintext `.env`.** `launch secret set <NAME>` stores a build secret in your OS keychain
  (scoped per app/profile) and injects it into the build env — keeping real secrets out of a committed
  `.env`; `secret list` (masked) and `secret rm` round it out.
- **`launch doctor --fix`.** Detects the iOS/Android toolchain and installs the missing brew-able tools
  behind a single consent (`--yes` skips it for CI/agents), flags the store-side blockers — a missing App
  Store Connect record, an unsigned Apple agreement — and validates your Expo config for known
  native-config footguns (a bad bundle id / package, a splash with no `backgroundColor`) — the same
  preflight `launch build` runs up front, so a one-line config mistake fails in a second, not a build. It
  also surfaces the two submission-time gotchas EAS leaves silent: the **export-compliance** answer (read
  once from `ios.config.usesNonExemptEncryption`, and with `--fix` answered on the latest build over the
  API), and the one-time manual **App Privacy** questionnaire — which Apple exposes no API for, so Launch
  prints the exact checklist instead of letting it block a submission by surprise.

**Configure the stores — as code**

- **Products as code.** `launch sync` reconciles your in-app purchases, subscriptions, and capabilities
  onto App Store Connect to match `launch.config.ts` — a read-only plan, your confirmation, then apply,
  across every app at once. This is the gap EAS leaves entirely: IAPs and subscriptions are otherwise
  hand-work in the App Store Connect UI.
- **Store metadata, both platforms.** `launch metadata pull/push` syncs your listing (name, description,
  keywords, screenshots, release notes) from a versioned `store.config.json`. (`eas metadata` is iOS-only;
  Launch covers Play too.)
- **Listing copy, reconciled over the API.** `launch sync` also reconciles your App Store **textual
  listing** per locale — name, subtitle, description, keywords, what's-new, and the privacy / support /
  marketing URLs — straight onto the editable App Store version via the API, idempotently (it never
  touches a live or in-review version).

**Build & ship — iOS and Android**

- **One command per platform.** `launch build ios` / `launch build android` runs prebuild → sign →
  size-check → upload to the testing track (TestFlight / Play internal) — the same flow EAS runs.
- **Fast by default.** ccache wires in at `pod install`, DerivedData stays warm, and a native-graph
  fingerprint forces a clean build only when your native deps actually change. JS edits rebuild
  incrementally; `--clean` forces from scratch.
- **Real download-size check.** Reports the actual per-device size (App Thinning report / bundletool)
  and gates on the `sizeBudgetMB` you configured.
- **Safety nets.** Refuses to upload a simulator build, a `.app`, or an empty artifact; `--dry-run`
  rehearses the whole pipeline with no network, build, or account changes.
- **Deliberate public release — no portal.** The testing track is the default; the public store is the
  separate, confirmed `launch release <platform>`. For iOS it drives the App Store Connect API end to
  end — create/reuse the version, answer export compliance, attach the build, write the release notes,
  pick immediate / scheduled / phased rollout, and submit for review — so a release never needs the
  website. `launch status [--watch] [--json]` tracks the review (with CI exit codes), and `launch rollout
pause|resume|complete` steers a phased rollout. fastlane is scoped to the binary upload only.
- **Re-sign without rebuilding.** `launch build:resign` re-signs a stored `.ipa`/`.aab` with different
  credentials (a new account or profile) straight from the artifact — no rebuild.
- **Completion notifications.** A `notify` block pings a Slack/Discord webhook and/or runs a shell hook
  when a build or submit finishes — on success _and_ failure — so an unattended/CI run tells you when
  it's done. EAS-`webhook` parity, with no hosted service.

**Distribute & update**

- **Internal distribution.** `launch build <platform> --distribution internal` hosts an ad-hoc iOS
  install link / Android `.apk` on your own bucket; register testers with `launch device add <udid>`.
- **Over-the-air updates.** `launch update` publishes a JS/asset update via the **Expo Updates protocol**
  `expo-updates` already speaks — code-signed and hosted on your own bucket (S3 / R2 / Supabase).
- **Roll back a bad update.** `launch updates list/view` show the per-channel history; `launch updates
rollback` reverses a bad OTA — promote a known-good update or drop testers back to the embedded bundle.

**Manage testers, reviews & reports — API-key only**

- **TestFlight from the CLI.** `launch testflight groups/create-group/testers/add/rm` manages beta groups
  and invites testers over the same App Store Connect API key — the management layer around the build
  upload, with no Apple-ID password and no 2FA.
- **Reviews, read & reply.** `launch reviews [list]` reads customer reviews (filter by rating / territory);
  `launch reviews reply` posts or replaces the developer response, and `launch reviews delete` removes it —
  without opening App Store Connect.
- **Sales, finance & analytics reports.** `launch reports sales/finance/analytics` downloads App Store
  Connect's Sales & Trends, Finance, and Analytics reports (gzipped TSV) straight to your machine for
  scripting — the numbers EAS never surfaces.

**Inspect & debug**

- **Build history.** `launch builds list/view/log` reads the local artifact index — ids, per-device
  sizes, artifact paths, and the raw build log for any build.
- **Install & run.** `launch run [id|latest]` installs a built artifact onto a connected device or
  simulator (`adb`/`bundletool` for Android, `devicectl` for iOS).
- **Explain a failure.** `launch diagnose` maps an `xcodebuild`/Gradle/CocoaPods error to a plain-English
  cause and fix; `launch fingerprint` shows why the next build will be clean vs incremental. `--verbose`
  streams the raw build output instead of the progress spinner.

**Onboarding & teaching**

- **`launch demo`.** A simulated, zero-setup walkthrough of the whole pipeline (auto-plays once on first
  run); `--explain` on any command and `launch explain <topic>` cover the terminology on demand.
- **Silent self-upgrade.** Picks up a newer npm release and re-runs your command on it — throttled to
  once a day and a no-op in CI, when piped, and for agents.

## Launch vs EAS

Launch runs the same `eas build` → `eas submit` → `eas update` pipeline (plus `eas metadata` and
`eas credentials`) on hardware you own — and covers the store-setup steps EAS leaves to you. Where the
two differ on the same workflow:

| In Expo EAS                                                                                                 | In Launch                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Build compute runs on **Expo's cloud**, **$19–$199/mo** + per-build fees                                    | Builds on **your own machine** — **$0 compute**, MIT-licensed, unlimited builds                                    |
| Builds **queue** in a shared cloud, sometimes for hours                                                     | Builds **start immediately** on your hardware — no queue                                                           |
| Free-tier builds are **capped at a 45-minute timeout**                                                      | **No timeout** — a build runs as long as it needs                                                                  |
| Apple-ID **2FA** prompts / expired codes interrupt builds                                                   | Authenticates with an **App Store Connect API key (JWT)** — no password, no 2FA                                    |
| Toolchain/Node **pinned by the build image**; local `.env` not resolved                                     | Your own Xcode/Node/toolchain and a documented **env-precedence ladder** (`--print-env` to audit)                  |
| **In-app purchases & subscriptions** are hand-work in the ASC UI                                            | `launch sync` reconciles **IAPs, subscriptions & capabilities** from `launch.config.ts`                            |
| EAS **rewrites bundle-id capabilities every build** (clobbers toggles)                                      | `launch sync` applies a **minimal safe-diff** — capabilities it doesn't manage stay untouched                      |
| `eas metadata` is **iOS-only**                                                                              | `launch metadata` syncs the listing for **iOS _and_ Android**                                                      |
| After `eas submit`, the **App Store release** (version, compliance, notes, rollout) is **portal hand-work** | `launch release` drives it over the **API** — then `launch status --watch` and `launch rollout` track and steer it |
| **Reviews, reports & TestFlight management** mean a trip to the website                                     | `launch reviews` / `launch reports` / `launch testflight` do them over the **API key** — no portal                 |
| **EAS Update** hosts your OTA updates on **Expo's servers** (paid)                                          | `launch update` serves the **same Expo Updates protocol** from **your own bucket** (S3/R2/Supabase)                |
| **Internal-distribution** builds are hosted by Expo                                                         | `--distribution internal` hosts the ad-hoc `.ipa`/`.apk` on **your own bucket**; `launch device`                   |
| Signing **credentials can live on Expo's servers**                                                          | Keys stay in **your OS keychain** — only a **CSR** ever leaves your machine                                        |
| Build **artifacts are hosted on Expo**                                                                      | Artifacts land in **your own storage** (local, or S3 / R2 / Supabase)                                              |
| **No Mac?** EAS's paid cloud is the only path                                                               | **No Mac?** A cloud Mac in **your own AWS**, any Mac over **SSH**, or hand off to **`eas build`**                  |
| **Closed SaaS** — proprietary, vendor lock-in                                                               | **MIT, open source** — `fastlane`/Gradle/platform APIs, swappable providers, nothing to migrate                    |

## Platform support

<table align="center">
  <tr>
    <td align="center" width="240"><img src="assets/platforms/ios.jpg" alt="iOS" width="200" /></td>
    <td align="center" width="240"><img src="assets/platforms/android.jpg" alt="Android" width="200" /></td>
  </tr>
  <tr>
    <td align="center"><strong>iOS</strong><br />✅ Shipping — build, sign &amp; upload to TestFlight</td>
    <td align="center"><strong>Android</strong><br />✅ Shipping — build, sign &amp; upload to Google Play</td>
  </tr>
</table>

## Requirements

- **iOS:** macOS with **Xcode** + command-line tools, **fastlane** (`brew install fastlane`), and an
  **App Store Connect API key** (`.p8` + Key ID + Issuer ID) — [generate one here](https://appstoreconnect.apple.com/access/integrations/api).
  No Mac? See [Building without a Mac](#building-without-a-mac).
- **Android:** a **JDK** (any OS — no Mac needed) and a **Google Play service account** JSON key.
- **Node 20+** on every platform.

Run `launch doctor` any time to check all of the above.

## Install

```bash
npm install --save-dev launch-store     # per-project (recommended; resolves the typed launch.config.ts)
npm install --global launch-store       # or global, for just the `launch` command
```

## Quick start

From paywall to the testing track in five commands (swap `ios` → `android` for Google Play):

```bash
launch init                 # scaffold launch.config.ts + .env.example, tailored to your repo
launch creds set-key        # import your store API key into the OS keychain
launch creds setup          # register the app id + create/reuse signing assets
launch build ios --dry-run  # rehearse the whole flow — no network, no build, no account changes
launch build ios            # build, sign, size-check, and upload to the testing track
```

`launch build` reuses your cached credentials silently; if they're missing it offers to provision them
inline. Public release is the separate, deliberate `launch release <platform>`.

Selling in-app purchases or subscriptions? Declare them in `launch.config.ts` and run `launch sync` to
create and reconcile them on App Store Connect — no clicking through the portal.

## Commands

| Command                                                      | What it does                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch`                                                     | Interactive wizard — guided setup on a fresh checkout, then build (auto-plays `launch demo` on first run).                                                                                                                                                                         |
| `launch demo [ios\|android]`                                 | Simulated, zero-setup walkthrough of the build → sign → submit pipeline.                                                                                                                                                                                                           |
| `launch init`                                                | Scaffold `launch.config.ts` (+ `.env.example`) into the current repo.                                                                                                                                                                                                              |
| `launch build <ios\|android>`                                | Run the full pipeline and upload to the testing track. Flags: `--profile`, `--app`, `--distribution`, `--bump`/`--track`/`--rollout`, `--env`/`--print-env`, `--remote`, `--clean`, `--dry-run`, `--explain`, `--no-submit`, `--verbose`.                                          |
| `launch release <ios\|android>`                              | Ship to the **public** store (with confirmation). iOS drives the App Store Connect API: version, export compliance, build attach, release notes, immediate/scheduled/phased rollout, submit. Flags: `--build`, `--no-wait`, `--manual`, `--scheduled`, `--phased`, `--create-app`. |
| `launch status [--watch] [--json]`                           | Show each iOS app's App Store version, review state, build processing, and phased-rollout state — `--watch` polls to a terminal verdict; CI exit codes (0/2/3/1).                                                                                                                  |
| `launch rollout <pause\|resume\|complete>`                   | Steer an in-progress iOS phased release — pause, resume, or complete the 7-day ramp now.                                                                                                                                                                                           |
| `launch build:resign [id\|latest]`                           | Re-sign a stored `.ipa`/`.aab` with different credentials (account/profile) — no rebuild.                                                                                                                                                                                          |
| `launch creds [status\|set-key\|setup\|use\|push-key\|…]`    | Inspect credentials, import the API key, provision signing, switch Apple accounts, or vault an APNs push key.                                                                                                                                                                      |
| `launch secret [list\|set\|rm]`                              | Store build secrets in your OS keychain instead of plaintext `.env` (alias: `env`); injected into the build env at build time.                                                                                                                                                     |
| `launch sync`                                                | Reconcile IAPs, subscriptions & capabilities (from `launch.config.ts`) **and** per-locale App Store listing text — name, subtitle, description, keywords, what's-new, URLs (from `store.config.json`) — plan → confirm → apply, all apps.                                          |
| `launch metadata [pull\|push]`                               | Sync the store listing (name, description, keywords, screenshots) via `store.config.json` — iOS + Android.                                                                                                                                                                         |
| `launch testflight [groups\|create-group\|testers\|add\|rm]` | Manage TestFlight beta groups and invite/remove testers over the App Store Connect API key.                                                                                                                                                                                        |
| `launch reviews [list\|reply\|delete]`                       | Read App Store customer reviews and post/replace/delete the developer response from the CLI.                                                                                                                                                                                       |
| `launch reports [sales\|finance\|analytics]`                 | Download App Store Connect Sales & Trends, Finance, and Analytics reports (gzipped TSV).                                                                                                                                                                                           |
| `launch update`                                              | Publish an over-the-air JS update (Expo Updates protocol, code-signed) to your own bucket. Flags: `--channel`, `--platform`, `--runtime-version`, `--no-sign`, `--dry-run`.                                                                                                        |
| `launch updates [list\|view\|rollback]`                      | Inspect the OTA history and **roll back** a bad update — promote a prior update or drop to the embedded bundle.                                                                                                                                                                    |
| `launch device [add\|list]`                                  | Register/list devices for ad-hoc (internal) distribution.                                                                                                                                                                                                                          |
| `launch builds [list\|view\|log]`                            | Inspect local build history from the artifact index — ids, per-device sizes, artifact paths, and raw logs.                                                                                                                                                                         |
| `launch run [id\|latest]`                                    | Install a built artifact on a connected device/simulator (`adb`/`bundletool` for Android, `devicectl` for iOS).                                                                                                                                                                    |
| `launch fingerprint`                                         | Show the native build fingerprint and why the next build is clean vs incremental.                                                                                                                                                                                                  |
| `launch diagnose`                                            | Explain a native build failure — map `xcodebuild`/Gradle/CocoaPods errors to a plain-English cause + fix.                                                                                                                                                                          |
| `launch ci init`                                             | Scaffold a GitHub Actions macOS-runner workflow wired to the CLI's unattended flags (`--android` adds an Android job).                                                                                                                                                             |
| `launch cloud [setup\|status\|teardown\|doctor]`             | Manage the remote AWS EC2 Mac build host (see [Building without a Mac](#building-without-a-mac)).                                                                                                                                                                                  |
| `launch doctor`                                              | Check the toolchain and store account (missing app record, unsigned agreements, export-compliance answer, the manual App Privacy checklist).                                                                                                                                       |
| `launch explain [topic]`                                     | Plain-English glossary (`csr`, `app-record`, `ota-update`, `play-track`, …).                                                                                                                                                                                                       |

## Configuration

App facts (bundle id, version) are read from each app's Expo config — `app.json` or `app.config.{ts,js}`
— so they're never duplicated. `launch.config.ts` holds only Launch-specific settings:

```ts
import { defineConfig } from "launch-store";

export default defineConfig({
  // appRoots: ["./apps"],   // for a monorepo; omit to scan the repo root
  credentials: "local", // OS keychain + ~/.launch
  storage: "local", // ~/.launch/artifacts (swap for s3/r2/supabase later)
  buildEngine: "fastlane", // "fastlane" (local Mac) · "remote-mac" (AWS EC2 Mac) · "eas" (Expo cloud)
  // submit: "app-store-connect", // or "eas" to submit through Expo

  // Only needed to build iOS without a Mac via `--remote aws` — see "Building without a Mac".
  // aws: { region: "us-east-1" },

  profiles: {
    // `env` is inline per-profile vars; `envFile` renames the base dotenv. Precedence, highest first:
    // --env flags › keychain secrets › profile `env:` › .env.local (--include-local) › .env.<profile> › .env
    production: { name: "production", envFile: ".env", env: {}, sizeBudgetMB: 200 },
  },

  // Ping a Slack/Discord webhook and/or run a shell hook when a build or submit finishes (success or
  // failure). Both fields are optional; omit `notify` entirely for no notifications.
  // notify: { webhookUrl: "https://hooks.slack.com/services/…", command: "say build done" },

  // In-app purchases & subscriptions, keyed by bundle id — `launch sync` reconciles these onto App Store
  // Connect. Capabilities aren't declared here; they're read from app.json's `ios.entitlements`. Omit if
  // your app sells nothing. See examples/hello-world for a worked catalog.
  // products: { "com.company.app": { subscriptionGroups: [/* … */], inAppPurchases: [/* … */] } },
});
```

Run `launch build <platform> --print-env` to see the fully resolved environment and where each value
came from (secrets masked), before a single build runs. A full-feature, dual-platform (iOS + Android)
example — exercising every config-as-code surface, from products and offers to Game Center, Wallet, and
store metadata — lives in [`examples/hello-world`](./examples/hello-world) (see its README for a
feature-by-feature tour).

## Building without a Mac

iOS signing is macOS-only, so a Windows/Linux developer needs a Mac somewhere. Run `launch` (the wizard)
or pick a path directly. Android builds anywhere a JDK runs, so none of this applies to it.

| Path                    | What happens                                                                                            | Cost                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **AWS cloud Mac**       | Launch provisions an EC2 Mac in **your own** AWS account, builds + signs + submits, then tears it down. | You pay AWS directly — **~$16 minimum per 24h session** (Apple's license sets a hard 24h floor). |
| **Connect a Mac (SSH)** | Build on any Mac you can reach — a colleague's, MacStadium, a hand-launched instance.                   | Whatever that Mac costs you.                                                                     |
| **Expo EAS**            | Launch orchestrates `eas-cli` end-to-end (`eas build` → download → `eas submit`) on Expo's cloud.       | Expo's **free tier** with monthly caps.                                                          |

```bash
launch build ios --remote aws            # build on a cloud Mac in your AWS account
launch build ios --remote ec2-user@host  # build on a Mac you reach over SSH
launch cloud doctor                      # check AWS creds, region, Mac-host quota, IAM
launch cloud status                      # live host: age, cost so far, releasable-after time
launch cloud teardown                    # stop + release the host (warns about the 24h floor)
```

Remote builds upload a transient copy of your signing keys to **your own** host with explicit consent
and shred them after — never to anyone else's servers. For occasional iOS builds a GitHub Actions macOS
runner is cheaper than EC2 Mac; Launch's value here is automation in your own account with the same keys
everywhere.

## How your credentials are handled

- The API key (`.p8`), distribution private key, and Android upload key live in your **OS keychain**.
- The iOS certificate is also backed up as a password-protected `.p12` under `~/.launch/credentials/`
  (chmod 600); the password is stored in the keychain, never beside the file.
- Your private key is generated locally — only a CSR is ever sent to Apple.
- Launch reuses an existing distribution certificate instead of creating new ones (the stores cap them).

## FAQ

**Is Launch free?** Yes — it's MIT-licensed and open source, and builds run on your own machine, so
there's no per-build fee or subscription. The only cost is optional: building iOS without a Mac means
paying your own AWS for an EC2 Mac (or using a Mac you already have).

**Is this an Expo EAS alternative?** Yes. Launch runs the same build → submit → update pipeline — plus
the store-setup steps EAS leaves to you (IAPs, subscriptions, capabilities, Android metadata) — locally,
on your own Apple and Google accounts. It can still hand off to `eas build` when you have no Mac.

**Do I need a Mac?** For iOS, yes — Apple's signing and toolchain are macOS-only. No Mac? Launch builds
on a cloud Mac in **your own** AWS account, any Mac over SSH, or hands off to EAS. Android builds
anywhere a JDK runs, no Mac required.

**Does it work with React Native and Expo?** Launch targets Expo / React Native apps that describe
themselves through Expo config (`app.json` / `app.config.ts`) and `expo prebuild` — it reads your app
facts from there and never duplicates them.

**Where do my keys live?** In your OS keychain. The `.p8` API key, the distribution private key, and the
Android upload key never touch the repo or anyone's servers; only a CSR is ever sent to Apple.

**Can I use it in CI?** Yes — `launch ci init` scaffolds a GitHub Actions macOS-runner workflow wired to
the unattended flags, and every command degrades to non-interactive in CI, when piped, and for agents.

**What about over-the-air updates?** `launch update` publishes via the Expo Updates protocol your
`expo-updates` runtime already speaks — code-signed and hosted on your own bucket (S3 / R2 / Supabase),
with `launch updates rollback` to reverse a bad release.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev setup, the quality gate, and how to add a backend.

## License

MIT

---

<sub>Launch is an open-source **Expo EAS alternative** — a local, self-hosted way to **build and ship
React Native apps to the App Store and Google Play from your own machine**: iOS code signing, TestFlight
& Google Play submission, store config as code, and Expo-protocol OTA updates, with no per-build bill.</sub>
