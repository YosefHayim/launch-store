<p align="center">
  <img src="assets/launch-logo.png" alt="Launch" width="220" />
</p>

<h1 align="center">Launch</h1>

<p align="center">
  <strong>Ship your iOS app to TestFlight from your own Mac — your keys, your hardware, no Expo bill.</strong>
</p>

Launch does locally what EAS Build does in Expo's cloud: it generates the native project, manages your
Apple signing credentials, builds and signs the `.ipa`, reports the real per-device download size, and
uploads to TestFlight — on the Mac you already own, with keys that stay in your local Keychain. No Mac?
Launch can also build on a cloud Mac in **your own** AWS account or hand off to Expo EAS — see
[Building without a Mac](#building-without-a-mac).

> Today Launch ships **iOS → TestFlight**. Storage, credentials, build, and submit are pluggable
> interfaces, so Android and cloud backends drop in as one-file additions — see [`PLAN.md`](./docs/PLAN.md).

<table align="center">
  <tr>
    <td align="center"><img src="assets/badges/zero-build-cost.jpg" alt="Zero build cost — $0 on your Mac, stop renting Expo builds" width="250" /></td>
    <td align="center"><img src="assets/badges/no-queue-wait.jpg" alt="No queue wait — build on your own machine, no shared cloud line" width="250" /></td>
    <td align="center"><img src="assets/badges/no-timeout-limit.jpg" alt="No timeout limit — run as long as needed, no 45-minute or 2-hour cap" width="250" /></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/badges/keys-stay-local.jpg" alt="Keys stay local — signing keys stay in the macOS Keychain and never leave your Mac" width="250" /></td>
    <td align="center"><img src="assets/badges/no-vendor-lock-in.jpg" alt="No vendor lock-in — MIT-licensed with swappable providers, you stay in control" width="250" /></td>
    <td align="center"><img src="assets/badges/best-for-mac-owners.jpg" alt="Best for Mac owners — if you own a Mac, Launch makes sense (Apple Developer account still required)" width="250" /></td>
  </tr>
</table>

## Why developers switch to Launch

Hit **Expo's EAS Build** paywall? Launch runs the same build → sign → TestFlight flow on hardware you
already control — free and open source.

- **$0 compute, unlimited builds.** EAS bills by build: the free tier caps your monthly builds behind a
  45-minute timeout, and paid plans run **$19–$199/mo** plus overage. Launch builds on your own Mac — no
  meter, no queue, no timeout.
- **Your keys stay in your local keychain.** For local builds, your distribution certificate and App Store
  Connect API key stay in your OS keychain; Launch only ever sends a CSR to Apple. A hosted service keeps
  your keys on _its_ servers — Launch never sees them. (Building without a Mac is the one exception: with
  your explicit consent, a transient copy is uploaded to **your own** cloud/remote Mac and shredded after
  the build — never to anyone else's servers. See [Building without a Mac](#building-without-a-mac).)
- **No lock-in, ever.** MIT-licensed, built on `fastlane` and Apple's own tooling, with pluggable
  storage/credentials/build/submit layers. Nothing proprietary to migrate off later.
- **It teaches as it runs.** Add `--explain` to any command to expand each step — CSR, provisioning
  profile, TestFlight — into plain English.

## Platform support

<table align="center">
  <tr>
    <td align="center" width="240"><img src="assets/platforms/ios.jpg" alt="iOS" width="200" /></td>
    <td align="center" width="240"><img src="assets/platforms/android.jpg" alt="Android" width="200" /></td>
  </tr>
  <tr>
    <td align="center"><strong>iOS</strong><br />✅ Shipping now — build, sign &amp; upload to TestFlight</td>
    <td align="center"><strong>Android</strong><br />🚧 Planned — pluggable interfaces designed, not yet built</td>
  </tr>
</table>

## Built for Mac owners

Launch needs a **Mac with Xcode** — Apple only allows iOS apps to be signed on macOS. That constraint is
exactly why your signing keys stay on your own hardware instead of a build farm: no Windows or Linux host,
no shared cloud queue, just your machine.

No Mac, or you ship only once in a while? A **GitHub Actions macOS runner** (free on public repos, Xcode
preinstalled) is a solid fit too — and Launch itself can build without a local Mac, below.

## Building without a Mac

iOS signing is macOS-only, so a Windows/Linux developer needs a Mac somewhere. Run `launch` with no
arguments for an interactive wizard that detects your OS and offers three honest paths:

| Path                    | What happens                                                                                            | Cost                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **AWS cloud Mac**       | Launch provisions an EC2 Mac in **your own** AWS account, builds + signs + submits, then tears it down. | You pay AWS directly — **~$16 minimum per 24h session** (Apple's license sets a hard 24h floor). |
| **Expo EAS**            | Launch orchestrates `eas-cli` end-to-end (`eas build` → download → `eas submit`) on Expo's cloud.       | Expo's **free tier** with monthly caps.                                                          |
| **Connect a Mac (SSH)** | Build on any Mac you can reach — a colleague's, MacStadium, a hand-launched instance.                   | Whatever that Mac costs you.                                                                     |

Or drive it directly:

```bash
launch build ios --remote aws            # build on a cloud Mac in your AWS account
launch build ios --remote ec2-user@host  # build on a Mac you reach over SSH
launch cloud doctor                      # check AWS creds, region, Mac-host quota, IAM
launch cloud status                      # live host: age, cost so far, releasable-after time
launch cloud teardown                    # stop + release the host (warns about the 24h floor)
```

The honest tradeoff: for occasional builds a GitHub Actions macOS runner is cheaper than EC2 Mac. Launch's
value here is automation in **your own** account with the **same keys everywhere**, not "cheaper than EAS."
Remote builds upload a transient copy of your signing keys to your own host with explicit consent and shred
them after — full design and verified AWS costs are in [`docs/plan-aws-ec2-mac.md`](./docs/plan-aws-ec2-mac.md).

## Requirements

- macOS with **Xcode** + command-line tools
- **fastlane** (`brew install fastlane`)
- **openssl** (ships with macOS) — generates your distribution key/CSR locally
- **Node 20+**
- An **App Store Connect API key** (`.p8` + Key ID + Issuer ID) — [generate one here](https://appstoreconnect.apple.com/access/integrations/api)

Run `launch doctor` any time to check all of the above.

## Install

Launch is on npm. Install it as a dev dependency of your app so the typed `launch.config.ts` import
resolves, or globally for just the `launch` command:

```bash
npm install --save-dev launch-store     # per-project (recommended)
npm install --global launch-store       # or global
```

## Quick start

From paywall to TestFlight in five commands:

```bash
launch init                 # scaffold launch.config.ts + .env.example, tailored to your repo
launch creds set-key        # import your App Store Connect API key into the Keychain
launch creds setup          # register the App ID + create/reuse your cert & provisioning profile
launch build ios --dry-run  # rehearse the whole flow — no network, no build, no account changes
launch build ios            # build, sign, size-check, and upload to TestFlight
```

`launch build` reuses your cached certificate and profile silently; if they're missing it offers to
provision them inline. Public App Store submission is the separate, deliberate `launch release ios`.

## Commands

| Command                                          | What it does                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `launch`                                         | Interactive wizard — detects your OS and routes (the Expo-style front door, great on a non-Mac).                                  |
| `launch init`                                    | Scaffold `launch.config.ts` (+ `.env.example`) into the current repo.                                                             |
| `launch build <ios\|android>`                    | Run the full pipeline and upload to TestFlight. Flags: `--profile`, `--app`, `--explain`, `--no-submit`, `--remote`, `--dry-run`. |
| `launch release <ios\|android>`                  | Submit the latest stored build to the **public** App Store review queue (with confirmation).                                      |
| `launch creds [status\|set-key\|setup]`          | Inspect, import the API key, or provision the cert + profile.                                                                     |
| `launch cloud [setup\|status\|teardown\|doctor]` | Manage the remote AWS EC2 Mac build host (see [Building without a Mac](#building-without-a-mac)).                                 |
| `launch doctor`                                  | Check the toolchain and Apple account (missing app record, unsigned agreements).                                                  |
| `launch explain [topic]`                         | Plain-English glossary (`csr`, `app-record`, `provisioning-profile`, `ec2-mac`, …).                                               |

Add `--explain` to any build to expand every step into a short teaching block — useful whether it's your
first iOS release or your hundredth.

## Configuration

App facts (bundle id, version) are read from each app's Expo config — `app.json` or a dynamic
`app.config.{ts,js}` — so they're never duplicated. `launch.config.ts` holds only Launch-specific
settings:

```ts
import { defineConfig } from "launch-store";

export default defineConfig({
  // appRoots: ["./apps"],   // for a monorepo; omit to scan the repo root
  credentials: "local", // macOS Keychain + ~/.launch
  storage: "local", // ~/.launch/artifacts (swap for s3/r2/supabase later)
  buildEngine: "fastlane", // "fastlane" (local Mac) · "remote-mac" (AWS EC2 Mac) · "eas" (Expo cloud)
  // submit: "app-store-connect", // or "eas" to submit through Expo

  // Only needed to build without a Mac via `--remote aws` — see "Building without a Mac".
  // aws: { region: "us-east-1" },

  profiles: {
    production: { name: "production", envFile: ".env", sizeBudgetMB: 200 },
  },
});
```

A worked example lives in [`examples/hello-world`](./examples/hello-world).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev setup, the quality gate, and how to add a backend.
The architecture and every locked decision are in [`PLAN.md`](./docs/PLAN.md).

## How your credentials are handled

- The API key (`.p8`) and the distribution private key live in the **macOS Keychain**.
- The certificate is also backed up as a password-protected `.p12` under `~/.launch/credentials/`
  (chmod 600); the password is stored in the Keychain, never beside the file.
- Your private key is generated locally — only a CSR is ever sent to Apple.
- Launch reuses an existing distribution certificate instead of creating new ones (Apple caps them).

## License

MIT
