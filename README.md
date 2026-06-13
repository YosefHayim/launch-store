# Relay

**Build and ship your iOS apps to the App Store from your own Mac, with your own keys — no Expo bill.**

Relay does locally what EAS Build does in Expo's cloud: it generates the native project, manages your
Apple signing credentials, builds and signs the `.ipa`, tells you the real per-device download size,
and uploads to TestFlight — using the Mac you already own and keys that never leave your machine.

> v1 is **iOS → TestFlight**. Android, cloud storage, and remote build compute are designed-for but
> not yet built (see [`PLAN.md`](./PLAN.md)). The storage/credentials/build/submit layers are pluggable
> interfaces, so adding a backend is a one-file change.

## Requirements

- macOS with **Xcode** + command-line tools
- **fastlane** (`brew install fastlane`)
- **openssl** (ships with macOS) — used to generate your distribution key/CSR locally
- **Node 20+**
- An **App Store Connect API key** (`.p8` + Key ID + Issuer ID) — [generate one here](https://appstoreconnect.apple.com/access/integrations/api)

Run `relay doctor` any time to check all of the above.

## Install

Install Relay as a dev dependency of your app (recommended — this makes the typed `relay.config.ts`
import resolve), or globally for the `relay` command alone:

```bash
npm install --save-dev relaybuild     # per-project (recommended)
npm install --global relaybuild       # or global
```

## Quick start

```bash
relay init                 # scaffold relay.config.ts + .env.example, tailored to your repo
relay creds set-key        # import your App Store Connect API key into the Keychain
relay creds setup          # register the App ID + create/reuse your cert & provisioning profile
relay build ios --dry-run  # rehearse the whole flow — no network, no build, no account changes
relay build ios            # build, sign, size-check, and upload to TestFlight
```

`relay build` reuses your cached certificate and profile silently; if they're missing it offers to
provision them inline. Public App Store submission is the separate, deliberate `relay release ios`.

## Commands

| Command                                | What it does                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `relay init`                           | Scaffold `relay.config.ts` (+ `.env.example`) into the current repo.                                                  |
| `relay build <ios\|android>`           | Run the full pipeline and upload to TestFlight. Flags: `--profile`, `--app`, `--explain`, `--no-submit`, `--dry-run`. |
| `relay release <ios\|android>`         | Submit the latest stored build to the **public** App Store review queue (with confirmation).                          |
| `relay creds [status\|set-key\|setup]` | Inspect, import the API key, or provision the cert + profile.                                                         |
| `relay doctor`                         | Check the toolchain and Apple account (missing app record, unsigned agreements).                                      |
| `relay explain [topic]`                | Plain-English glossary (`csr`, `app-record`, `provisioning-profile`, …).                                              |

Add `--explain` to any build to expand every step into a short teaching block — useful whether it's
your first iOS release or your hundredth.

## Configuration

App facts (bundle id, version) are read from each `app.json`, so they're never duplicated.
`relay.config.ts` holds only Relay-specific settings:

```ts
import { defineConfig } from "relaybuild";

export default defineConfig({
  // appRoots: ["./apps"],   // for a monorepo; omit to scan the repo root
  credentials: "local", // macOS Keychain + ~/.relay
  storage: "local", // ~/.relay/artifacts (swap for s3/r2/supabase later)
  buildEngine: "fastlane",
  profiles: {
    production: { name: "production", envFile: ".env", sizeBudgetMB: 200 },
  },
});
```

A worked example lives in [`examples/hello-world`](./examples/hello-world).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for dev setup, the quality gate, and how to add a backend.
The architecture and every locked decision are in [`PLAN.md`](./PLAN.md).

## How your credentials are handled

- The API key (`.p8`) and the distribution private key live in the **macOS Keychain**.
- The certificate is also backed up as a password-protected `.p12` under `~/.relay/credentials/`
  (chmod 600); the password is stored in the Keychain, never beside the file.
- Your private key is generated locally — only a CSR is ever sent to Apple.
- Relay reuses an existing distribution certificate instead of creating new ones (Apple caps them).

## License

MIT
