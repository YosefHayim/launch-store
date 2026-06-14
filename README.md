<p align="center">
  <img src="assets/launch-logo.png" alt="Launch" width="220" />
</p>

<h1 align="center">Launch</h1>

<p align="center">
  <strong>Ship your iOS and Android apps to TestFlight and Google Play from your own machine — your keys, your hardware, no Expo bill.</strong>
</p>

Launch does locally what EAS Build/Submit/Update do in Expo's cloud: it generates the native project,
manages your signing credentials, builds and signs the binary, reports the real per-device download
size, stores the artifact, and uploads it to the testing track — on the machine you already own, with
keys that stay in your local keychain. iOS signing needs a Mac; if you don't have one, Launch builds on
a cloud Mac in **your own** AWS account or hands off to Expo EAS — see [Building without a Mac](#building-without-a-mac).

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

## Why switch to Launch

Hit **Expo's EAS Build** paywall? Launch runs the same build → sign → submit flow on hardware you
already control — free and open source.

- **$0 compute, unlimited builds.** EAS bills by build, caps the free tier behind a 45-minute timeout,
  and runs **$19–$199/mo** plus overage on paid plans. Launch builds on your own machine — no meter, no
  queue, no timeout.
- **Your keys stay local.** Your distribution certificate, App Store Connect API key, and Android upload
  key stay in your OS keychain; Launch only ever sends a CSR to Apple. (Building without a Mac is the one
  exception — see below.)
- **No lock-in, ever.** MIT-licensed, built on `fastlane`, Gradle, and the platforms' own APIs, with
  pluggable storage/credentials/build/submit providers. Nothing proprietary to migrate off later.
- **It teaches as it runs.** Add `--explain` to any command — or run `launch demo` — to expand each step
  (CSR, provisioning profile, TestFlight, Play track) into plain English.

## Features

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
- **Deliberate public release.** The testing track is the default; the public App Store / Play
  production track is the separate, confirmed `launch release <platform>`.

**Credentials, kept local**

- **Keys in your keychain.** The ASC `.p8` + distribution key (iOS) and the Play service account +
  upload key (Android) live in your OS secret store — only a CSR is ever sent to Apple.
- **Auto-discovering setup.** `launch creds set-key` finds the `AuthKey_*.p8` in `~/Downloads` and asks
  only for what it can't infer; multi-account `creds use/rename/remove` switches between teams.
- **Reuses what the stores cap.** Picks up an existing distribution certificate + provisioning profile
  instead of minting new ones, and enforces Play App Signing.

**Onboarding & teaching**

- **`launch demo`.** A simulated, zero-setup walkthrough of the whole pipeline (auto-plays once on first
  run); `--explain` on any command and `launch explain <topic>` cover the terminology on demand.
- **`launch doctor --fix`.** Detects the iOS/Android toolchain and installs the missing brew-able tools
  behind a single consent. `--yes` skips every prompt for CI and agents.
- **Silent self-upgrade.** Picks up a newer npm release and re-runs your command on it — throttled to
  once a day and a no-op in CI, when piped, and for agents.

**Distribute & update**

- **Internal distribution.** `launch build <platform> --distribution internal` hosts an ad-hoc iOS
  install link / Android `.apk` on your own bucket; register testers with `launch device add <udid>`.
- **Store metadata, both platforms.** `launch metadata pull/push` syncs your listing from a versioned
  `store.config.json`. (`eas metadata` is iOS-only; Launch covers Play too.)
- **Over-the-air updates.** `launch update` publishes a JS/asset update via the **Expo Updates protocol**
  `expo-updates` already speaks — code-signed and hosted on your own bucket (S3 / R2 / Supabase).

## Launch vs EAS

Launch matches the EAS Build/Submit/Update/metadata surface on hardware you own — and structurally
avoids the failure modes EAS users hit most:

| Pain in EAS                                                   | In Launch                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Apple-ID **2FA** prompts / rejected codes block builds        | Authenticates with an **App Store Connect API key (JWT)** — no password, no 2FA, ever  |
| Builds **queue** in a shared cloud, sometimes for hours       | Builds on **your machine** — no queue, no timeout                                      |
| Toolchain/Node pinned by the build image; `.env` not resolved | Uses **your own** toolchain and environment                                            |
| `eas metadata` is **iOS-only**                                | `launch metadata` covers **iOS _and_ Android**                                         |
| EAS Update runs on **Expo's servers** (paid)                  | `launch update` serves the **same protocol** from **your own bucket**                  |
| Per-build pricing, monthly caps                               | **$0 compute** on your machine; pay only your own cloud if you build iOS without a Mac |

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

## Commands

| Command                                          | What it does                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch`                                         | Interactive wizard — guided setup on a fresh checkout, then build (auto-plays `launch demo` on first run).                                                            |
| `launch demo [ios\|android]`                     | Simulated, zero-setup walkthrough of the build → sign → submit pipeline.                                                                                              |
| `launch init`                                    | Scaffold `launch.config.ts` (+ `.env.example`) into the current repo.                                                                                                 |
| `launch build <ios\|android>`                    | Run the full pipeline and upload to the testing track. Flags: `--profile`, `--app`, `--explain`, `--no-submit`, `--remote`, `--distribution`, `--clean`, `--dry-run`. |
| `launch release <ios\|android>`                  | Submit the latest stored build to the **public** App Store / Play production track (with confirmation).                                                               |
| `launch creds [status\|set-key\|setup\|use\|…]`  | Inspect credentials, import the API key, provision signing, or switch Apple accounts.                                                                                 |
| `launch metadata [pull\|push]`                   | Sync the store listing (name, description, keywords, screenshots) via `store.config.json` — iOS + Android.                                                            |
| `launch update`                                  | Publish an over-the-air JS update (Expo Updates protocol, code-signed) to your own bucket.                                                                            |
| `launch device [add\|list]`                      | Register/list devices for ad-hoc (internal) distribution.                                                                                                             |
| `launch cloud [setup\|status\|teardown\|doctor]` | Manage the remote AWS EC2 Mac build host (see [Building without a Mac](#building-without-a-mac)).                                                                     |
| `launch doctor`                                  | Check the toolchain and store account (missing app record, unsigned agreements).                                                                                      |
| `launch explain [topic]`                         | Plain-English glossary (`csr`, `app-record`, `ota-update`, `play-track`, …).                                                                                          |

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
    production: { name: "production", envFile: ".env", sizeBudgetMB: 200 },
  },
});
```

A worked example lives in [`examples/hello-world`](./examples/hello-world).

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

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev setup, the quality gate, and how to add a backend.

## License

MIT
