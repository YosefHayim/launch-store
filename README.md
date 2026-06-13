<p align="center">
  <img src="assets/launch-logo.png" alt="Launch" width="220" />
</p>

<h1 align="center">Launch</h1>

<p align="center">
  <strong>Build and ship your iOS apps to the App Store from your own Mac, with your own keys — no Expo bill.</strong>
</p>

Launch does locally what EAS Build does in Expo's cloud: it generates the native project, manages your
Apple signing credentials, builds and signs the `.ipa`, tells you the real per-device download size,
and uploads to TestFlight — using the Mac you already own and keys that never leave your machine.

> v1 is **iOS → TestFlight**. Android, cloud storage, and remote build compute are designed-for but
> not yet built (see [`PLAN.md`](./docs/PLAN.md)). The storage/credentials/build/submit layers are pluggable
> interfaces, so adding a backend is a one-file change.

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

## Why Launch? (the honest version)

If you've hit **Expo's EAS Build** paywall and you're looking for a **free, open-source EAS alternative**,
Launch runs the same build → sign → TestFlight flow on hardware you already control:

- **No subscription, no per-build fees.** EAS bills by build — the free tier caps your monthly builds and
  enforces a 45-minute timeout; paid plans run **$19–$199/mo** plus overage. Launch builds on the Mac you
  already own: **$0 compute, unlimited builds, no queue timeout.**
- **Your signing keys never leave your machine.** Your distribution certificate and App Store Connect API
  key stay in your local **macOS Keychain** — Launch only ever sends a CSR to Apple. With a hosted service
  your keys live on someone else's servers.
- **No lock-in.** MIT-licensed, with `fastlane` + Apple's own tooling underneath and pluggable
  storage/credentials/build/submit layers. Nothing proprietary to migrate off later.
- **It teaches as it runs.** Add `--explain` to any command to expand each step (CSR, provisioning profile,
  TestFlight) into plain English.

**When Launch is _not_ the right tool.** It needs a **Mac with Xcode** — iOS apps can only be signed on
macOS (Apple's rule, not ours), so there is no Windows/Linux build host and no managed cloud queue. v1 also
targets **iOS → TestFlight** only. If you have no Mac and build only occasionally, a hosted service or a
**GitHub Actions macOS runner** (free for public repos, Xcode preinstalled) will likely serve you better.

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

## Requirements

- macOS with **Xcode** + command-line tools
- **fastlane** (`brew install fastlane`)
- **openssl** (ships with macOS) — used to generate your distribution key/CSR locally
- **Node 20+**
- An **App Store Connect API key** (`.p8` + Key ID + Issuer ID) — [generate one here](https://appstoreconnect.apple.com/access/integrations/api)

Run `launch doctor` any time to check all of the above.

## Install

Install Launch as a dev dependency of your app (recommended — this makes the typed `launch.config.ts`
import resolve), or globally for the `launch` command alone:

```bash
npm install --save-dev launch-store     # per-project (recommended)
npm install --global launch-store       # or global
```

## Quick start

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

| Command                                 | What it does                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `launch init`                           | Scaffold `launch.config.ts` (+ `.env.example`) into the current repo.                                                 |
| `launch build <ios\|android>`           | Run the full pipeline and upload to TestFlight. Flags: `--profile`, `--app`, `--explain`, `--no-submit`, `--dry-run`. |
| `launch release <ios\|android>`         | Submit the latest stored build to the **public** App Store review queue (with confirmation).                          |
| `launch creds [status\|set-key\|setup]` | Inspect, import the API key, or provision the cert + profile.                                                         |
| `launch doctor`                         | Check the toolchain and Apple account (missing app record, unsigned agreements).                                      |
| `launch explain [topic]`                | Plain-English glossary (`csr`, `app-record`, `provisioning-profile`, …).                                              |

Add `--explain` to any build to expand every step into a short teaching block — useful whether it's
your first iOS release or your hundredth.

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
  buildEngine: "fastlane",
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
