# Launch — Plan

> **Build and ship your iOS/Android apps to the stores from your own Mac, with your own keys, no Expo bill.**

Launch is an open-source CLI that does locally what EAS Build does in Expo's cloud:
`prebuild → resolve credentials → compile & sign → check size → store the artifact → submit to TestFlight`.
The build compute is your own Mac, the signing keys live in your own Keychain, and the
infrastructure (storage, credentials, build engine, submission) is pluggable behind small
interfaces so a new backend (AWS S3, Cloudflare R2, Supabase, a remote Mac) is a one-file add.

---

## Why this exists (the problem, concretely)

EAS Build bundles three separate jobs into one subscription bill:

| Job                       | What it does                                                                                                                   | What Launch replaces it with                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Build compute**         | Boots a managed macOS VM, runs `prebuild` + `fastlane`, emits a signed `.ipa`. iOS _requires_ macOS.                           | Your own Mac. The expensive part (renting a cloud Mac) becomes the Mac you already own. |
| **Credential management** | Generates/stores your distribution certificate, provisioning profile, push key, and ASC API key — encrypted on Expo's servers. | Your macOS Keychain + `~/.launch/`. The keys never leave your machine.                  |
| **Storage / submission**  | Stores the artifact, hands you a download URL, submits to App Store Connect.                                                   | A pluggable `StorageProvider` (local in v1) + direct App Store Connect submission.      |

The part people fixate on — "store builds in S3/R2" — is the _easy_ part. The hard/costly part is
the macOS build compute, which is why Launch runs the build locally first and treats remote compute
as a later plugin.

---

## Decisions (all locked during planning)

| Area                 | Decision                                                                                                                                                                                                                                             | Rationale                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Build machine**    | Local Mac. Remote/cloud Macs = later plugin.                                                                                                                                                                                                         | iOS can only build on macOS; you already own one → $0 compute.                                                                                               |
| **First platform**   | iOS → TestFlight. Android next.                                                                                                                                                                                                                      | iOS has the hardest credential model; solving it first makes Android easy.                                                                                   |
| **Native project**   | **Auto-detect**: run `expo prebuild` only when there's no committed `ios/`; bare RN apps build as-is. No hard Expo dep.                                                                                                                              | Works in any RN repo, not just Expo-managed ones; `prebuild` is free/local, never Expo's cloud.                                                              |
| **Apple auth**       | App Store Connect **API key** (`.p8` + Key ID + Issuer ID).                                                                                                                                                                                          | No 2FA prompts, fully scriptable, one key manages creds _and_ uploads.                                                                                       |
| **Signing creds**    | **Full API automation**: register App ID, create distribution cert from a local CSR, create App Store profile — reuse-first, all via the API key. `launch creds setup` provisions; builds reuse silently.                                            | Eliminates the Developer-portal trips; private key never leaves the Mac; respects Apple's cert cap.                                                          |
| **Cred storage**     | macOS **Keychain** (secrets + `.p12` password) + `~/.launch/credentials/` (encrypted `.p12` backup, chmod 600, + metadata).                                                                                                                          | Encrypted at rest; the `.p12` backup survives a Keychain reset without burning a cert slot.                                                                  |
| **Build engine**     | `fastlane` `gym` with **manual signing** from the resolved cert/profile, behind a `BuildEngine` interface.                                                                                                                                           | Same engine EAS uses; manual signing makes the signing identity explicit and reproducible.                                                                   |
| **Config loading**   | `launch.config.ts` loaded via **jiti** (on-the-fly TS), package exposes `defineConfig` + types via `exports`.                                                                                                                                        | The compiled bin can't `import()` TS natively; jiti makes the typed config "just work" when installed.                                                       |
| **Quality gate**     | **Max-strict** tsconfig + ESLint (`strict-type-checked`) + Prettier, enforced by a **husky** pre-commit hook.                                                                                                                                        | The codebase is the product's reference implementation; keep it provably clean as contributors arrive.                                                       |
| **Tests / CI**       | **Vitest** over the reliability-critical paths (config/env/registry/glossary, the ASC client, build helpers, and the `--dry-run` pipeline end-to-end). **GitHub Actions** re-runs the whole gate (typecheck/lint/format/test/build) on Node 20 + 22. | Prove the load-bearing logic without brittle shell-arg mocks; CI is authoritative since the local hook can be bypassed. Node floor raised to 20 (18 is EOL). |
| **Dry-run**          | `launch build --dry-run` rehearses every step (CSR, payloads, gym args) with no network/build/account.                                                                                                                                               | Lets anyone validate the flow on a machine with no key, and is the safe way to preview a real run.                                                           |
| **Size check**       | Per-device download/install report; **soft-gate** @ 200 MB default; confirm to proceed.                                                                                                                                                              | Know the real size _before_ a wasted TestFlight round-trip; never hard-block a solo dev.                                                                     |
| **Artifact storage** | `local` provider + `StorageProvider` interface (S3-shaped). No cloud yet.                                                                                                                                                                            | YAGNI: the `.ipa` goes straight to TestFlight regardless; cloud is a later drop-in.                                                                          |
| **Submit target**    | TestFlight by default; public release = explicit `launch release --to-store`; auto-bump build #.                                                                                                                                                     | Nothing reaches real users by accident; Apple requires a unique, increasing build number.                                                                    |
| **Explain layer**    | Clean default + `--explain` expansion + `launch explain <topic>`; one glossary shared with docs.                                                                                                                                                     | Serves new _and_ experienced devs without nagging either; teaching never drifts from code.                                                                   |
| **Config model**     | Hybrid: app facts auto-discovered from each `app.json`; Launch settings in `launch.config.ts`. `eas.json` dropped.                                                                                                                                   | No duplication across 40+ apps; `app.json` stays the single source of truth.                                                                                 |
| **CLI stack**        | `commander` + `@clack/prompts`, TypeScript on Node.                                                                                                                                                                                                  | Conventional + contributor-friendly parser; pretty interactive prompts.                                                                                      |
| **Env vars**         | `.env` + `.env.example` (no prefix); validate `.env` vs `.env.example` pre-build; non-blocking secret-name warning.                                                                                                                                  | Fail before a wasted build on a missing key; gentle guard against bundling a secret.                                                                         |
| **Repo structure**   | Single package; provider interfaces as the seam; internal registry; lazy/optional cloud deps.                                                                                                                                                        | One real implementation per slot today; a monorepo's overhead isn't justified yet.                                                                           |
| **Name**             | **Launch** (command `launch`). npm package `launch-store` (the names `launch`/`launch-cli` are taken).                                                                                                                                               | Clear "hand the build straight to the store, no middleman" story; short to type.                                                                             |
| **License**          | MIT.                                                                                                                                                                                                                                                 | Matches Expo/fastlane/commander/clack; max adoption.                                                                                                         |
| **Visibility**       | Private repo → public after a secrets/security pass.                                                                                                                                                                                                 | Code touches Apple private keys; git history must be clean before going public.                                                                              |

---

## The credentials, in plain terms

These are the things Apple needs, and where Launch keeps each:

- **App Store Connect API key** — a `.p8` private key + Key ID + Issuer ID. Launch's single credential
  for talking to Apple (managing certs/profiles _and_ uploading). → Keychain.
- **App ID (Bundle ID)** — the unique id (`com.loopi.pomedero`). Launch registers it via `POST /v1/bundleIds`. → no portal trip.
- **Distribution Certificate** — proves Apple trusts you to sign release builds. Launch generates the key
  pair + CSR locally (`openssl`), sends only the CSR to `POST /v1/certificates`, and imports the signed
  cert. Apple caps you at ~2–3, so Launch reuses a cached one. → login Keychain + chmod-600 `.p12` backup.
- **Provisioning Profile** — ties the App ID to a certificate and entitlements. Launch creates/reuses an
  "App Store" profile via `POST /v1/profiles` and installs it where Xcode looks. → `~/.launch/credentials/`.
- **App record** — the app's App Store Connect entry. **The one step the API can't do** (no `POST /v1/apps`).
  Launch detects its absence (`launch doctor`) and deep-links you to the exact page. → one-time UI step.
- **Push Key (APNs)** — optional `.p8` for push notifications. → Keychain (deferred).

---

## App Store Connect API — what's wired, what's next

The API key drives every Apple interaction. Endpoints Launch uses today:

| Purpose                        | Endpoint                                                           | Status |
| ------------------------------ | ------------------------------------------------------------------ | ------ |
| Auth                           | ES256 JWT (`aud: appstoreconnect-v1`, ≤20 min TTL)                 | ✓      |
| Resolve app id / detect record | `GET /v1/apps?filter[bundleId]=`                                   | ✓      |
| Auto-bump build number         | `GET /v1/builds?filter[app]=&sort=-version`                        | ✓      |
| TestFlight processing status   | `GET /v1/builds?filter[app]=&filter[version]=` (`processingState`) | ✓      |
| Required-agreements preflight  | `GET /v1/bundleIds?limit=1` → 403 `REQUIRED_AGREEMENTS` probe      | ✓      |
| Register App ID                | `GET`/`POST /v1/bundleIds`                                         | ✓      |
| Distribution certificate       | `GET`/`POST /v1/certificates` (CSR in, cert out)                   | ✓      |
| Provisioning profile           | `GET`/`POST`/`DELETE /v1/profiles`                                 | ✓      |
| Upload (TestFlight / review)   | fastlane `pilot` / `deliver` (same key)                            | ✓      |

**Minimizing the Developer-UI further (candidates, not yet built):**

- **Push key (APNs)** — `GET`/`POST /v1/apiKeys`-style management for `.p8` push keys.
- **Bundle ID capabilities** — `POST /v1/bundleIdCapabilities` to toggle Push, Associated Domains, etc.
- **Device registration** — `POST /v1/devices` (only needed for ad-hoc/development distribution).
- **Native uploader** — replace fastlane `pilot` with Apple's `notarytool`/Transporter or a direct
  upload, dropping the fastlane dependency entirely.

**Irreducible UI step:** creating the **app record** — Apple exposes no `POST /v1/apps`. Launch's job is
to detect it (`doctor`) and link you straight to the page, not to pretend it can automate it.

---

## Architecture — interfaces are the "any infra" seam

The pipeline selects a provider for each slot from `launch.config.ts` via an internal registry.
Adding a backend = implement the interface + `register()`. Cloud SDK deps are lazy-loaded so a
local-only install pulls nothing extra.

```
core/pipeline.ts orchestrates:

  CredentialsProvider  resolve() status()                 ── local (Keychain) ✓   [team / S3 later]
  BuildEngine          build() → { ipaPath, sizeReport } ── fastlane ✓ · eas ✓    [xcodebuild later]
  StorageProvider      put() list() url()                 ── local ✓              [s3 / r2 / supabase later]
  Submitter            submit(ipa, target)                ── App Store Connect ✓ · eas ✓  [google play later]
  SecretStore          get() set() delete()               ── macOS security ✓ · native keyring ✓ (Win/Linux)
  ComputeHost          allocate() status() teardown()     ── aws-ec2-mac ✓ · byo-ssh ✓
```

The last two seams power off-Mac builds: `SecretStore` widens the macOS Keychain to Windows/Linux, and
`ComputeHost` provisions a remote Mac the same fastlane spine runs on over SSH. Full design + verified AWS
costs: [`plan-aws-ec2-mac.md`](./plan-aws-ec2-mac.md).

### Directory layout

```
launch/
  docs/PLAN.md            ← this file (architecture + locked decisions)
  README.md               usage / quick start
  package.json            bin: { launch }, exports defineConfig, name: launch-store
  tsconfig.json           MAX-strict, NodeNext ESM, emits dist + .d.ts (the typecheck + lint config)
  tsconfig.build.json     extends tsconfig, excludes *.test.ts so dist ships production code only
  eslint.config.js        flat config: typescript-eslint strict-type-checked + prettier (+ test override)
  .prettierrc             formatter config (enforced on pre-commit)
  vitest.config.ts        test runner: src/**/*.test.ts, node env, v8 coverage
  .husky/pre-commit       lint-staged (eslint --fix + prettier) then tsc --noEmit
  .github/workflows/ci.yml  CI gate: typecheck/lint/format/test/build on Node 20 + 22
  .gitignore              guards .env, *.p8, *.p12, *.mobileprovision, ~/.launch leakage
  launch.config.example.ts copy → launch.config.ts at repo root of the app monorepo
  examples/hello-world/   reference app (app.json + launch.config.ts) for onboarding + smoke tests
  AGENTS.md / CLAUDE.md   working rules for agents/contributors (CLAUDE.md points to AGENTS.md)
  CONTRIBUTING.md         dev setup, the quality gate, adding a provider, tests + CI
  llms.txt                llmstxt.org index linking the docs + key source files
  LICENSE                 MIT
  src/**/*.test.ts        Vitest specs colocated with the code they cover
  src/
    index.ts            public API barrel: defineConfig + config types (the `exports` entry)
    cli/
      index.ts            commander entry (init, build, release, creds, doctor, explain)
      commands/init.ts    launch init — scaffold launch.config.ts + .env.example
      commands/build.ts   launch build <platform> [--dry-run]
      commands/release.ts launch release <platform> — deliberate public-review submit
      commands/creds.ts   launch creds [status | set-key | setup]
      commands/doctor.ts  launch doctor — toolchain + Apple-account preflight
      commands/explain.ts launch explain <topic>
    core/
      types.ts            ALL domain types + provider interfaces (single source of types)
      registry.ts         provider registry + selection
      config.ts           load launch.config.ts (jiti) + auto-discover apps from app.json
      env.ts              .env vs .env.example validation + secret-name warning
      glossary.ts         single glossary for --explain AND docs
      logger.ts           two-tier output (clean default / --explain expansion)
      pipeline.ts         orchestrates the iOS build → submit flow (+ dry-run)
      paths.ts            ~/.launch layout (artifacts, credentials, profile install dir)
      keychain.ts         macOS `security` CLI wrappers
      exec.ts             child-process helper
    providers/
      credentials/local.ts  Keychain + ~/.launch metadata; silent reuse of cached signing
      storage/local.ts      ~/.launch/artifacts + JSON index
      build/fastlane.ts     generates + runs fastlane gym (manual signing)
      submit/appStoreConnect.ts  fastlane pilot/deliver upload
    apple/
      ascClient.ts          App Store Connect API client (JWT + bundleId/cert/profile/builds)
      credentials.ts        CSR + .p12 + Keychain import + profile install; reuse-first provisioning
```

---

## The v1 pipeline (the iOS spine)

```
launch build ios --profile production [--app pomedero] [--explain] [--dry-run]
  1  resolve config + pick app           (Clack select if --app omitted)
  2  validate .env against .env.example  → fail early, no wasted build
  3  ensure native project               (use committed ios/ → else expo prebuild)
  4  resolve API key                     (Keychain)
  5  resolve signing                     (cached cert+profile reused silently → else provision inline)
  6  auto-bump build number              (query ASC for the last-used number, stamp Info.plist)
  7  fastlane gym (manual signing)       → signed .ipa
  8  App Thinning Size Report            → per-device download/install; soft-gate @ budget
  9  store .ipa                          → ~/.launch/artifacts/ + index
 10  fastlane pilot → poll processing    → upload to TestFlight, report VALID/processing
 11  summary                             artifact path · size · build number

  --dry-run replays steps 1–11 printing what each WOULD do, with no network/build/account.
```

### Command surface

```
launch init                                        # scaffold launch.config.ts + .env.example
launch build <ios|android> [--profile <p>] [--app <name>] [--explain] [--no-submit] [--dry-run]
launch release <ios|android> [--app <name>]        # deliberate public-review submission
launch creds   [status | set-key | setup]          # inspect key / import key / provision cert+profile
launch doctor                                      # Xcode, Ruby, fastlane, CocoaPods, openssl + Apple account
launch explain <topic>                             # glossary: csr, app-record, provisioning-profile, ...
```

---

## Prerequisites (checked by `launch doctor`)

- **Xcode** + command-line tools (`xcodebuild`, `xcrun`)
- **Ruby** + **fastlane** (`gem install fastlane` or Homebrew)
- **openssl** (ships with macOS) — generates the keypair + CSR for the distribution certificate
- **Node** 20+
- An **App Store Connect API key** (`.p8`) imported via `launch creds set-key`

## Dependencies & rationale (per engineering standards §5)

Runtime deps are intentionally tiny; the heavy tools (`expo`, `fastlane`, `openssl`) are invoked from
the user's environment, not bundled.

- **commander** — command/flag parser. MIT. Ubiquitous → low contributor friction.
- **@clack/prompts** — interactive prompts/spinners. MIT. Clean modern UX.
- **jose** — ES256 JWT signing for the App Store Connect API from the `.p8`. MIT. Small, standards-based.
- **jiti** — loads the user's `launch.config.ts` on the fly. MIT. The compiled bin runs on plain Node,
  which can't `import()` TypeScript; jiti is the same loader Nuxt/ESLint use. Alternative (bundling a TS
  toolchain) is heavier; alternative (forcing `.js` config) loses the typed `defineConfig` DX.
- **expo** (not a dep) — `npx expo prebuild` is run from the app when it's Expo-managed and lacks `ios/`.
- **fastlane** (not a dep) — `gym` (archive+export) + `pilot`/`deliver` (upload), invoked as a CLI.

**Optional (cloud / off-Mac builds only — `optionalDependencies`, lazy-loaded):**

- **@aws-sdk/client-ec2** + **@aws-sdk/credential-providers** — allocate/run/release the EC2 Mac host and
  resolve AWS creds via the standard chain. Dynamic-imported inside the `aws-ec2-mac` host only, so a
  local Mac build never loads them. Modular v3 clients keep the footprint to EC2, not the whole SDK.
- **@napi-rs/keyring** — OS-native secret store for Windows/Linux (Credential Manager / libsecret); the
  maintained successor to the archived `keytar`. Loaded only off-macOS (a Mac uses the `security` CLI).
- **eas-cli** (not a dep) — detected/invoked via `npx` for the EAS handoff path; never bundled.

### Dev tooling

- **typescript** (max-strict) + **typescript-eslint** (`strict-type-checked`) + **prettier** — quality gate.
- **husky** + **lint-staged** — run lint+format on staged files and a full typecheck before every commit.
- **vitest** + **@vitest/coverage-v8** — the test runner; specs sit beside the code (`src/**/*.test.ts`).
- **tsx** — runs the CLI from source in development (`npm run dev`).

---

## Scope boundary

**In v1:** local iOS build → TestFlight, local artifact storage, the explain layer, the provider interfaces.

**Deferred (interfaces designed so each is a small add):**

- Android (Gradle build + Google Play submission) — the very next milestone.
- Cloud storage providers (Supabase / R2 / S3) — drop-in behind `StorageProvider`.
- Remote/cloud Mac build compute — **implemented**: a `ComputeHost` (`aws-ec2-mac` / `byo-ssh`) + an SSH remote-build pipeline + an `eas` handoff + a cross-platform `SecretStore`, with a no-args wizard and a `launch cloud` group. Opt-in via `launch` / `--remote`. See [`plan-aws-ec2-mac.md`](./plan-aws-ec2-mac.md).
- OTA JS updates (the EAS Update equivalent) — a separate, larger system.
- Ad-hoc / internal distribution (install links) — needs a different profile type + hosting.

---

## Security notes

- The `.p8` and the distribution private key live in the macOS Keychain. The certificate is also kept as
  a password-protected `.p12` backup under `~/.launch/credentials/` (chmod 600); its password is in the
  Keychain, never beside the file. The CSR private key is generated locally and only the CSR is sent to Apple.
- `.gitignore` blocks `.env`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.keystore`, and `~/.launch/`.
- Without the `EXPO_PUBLIC_` prefix convention, **anything in `.env` can reach the app bundle** — keep
  backend secrets out of `.env`. Launch emits a non-blocking warning on secret-looking names
  (`*SECRET*`, `*PRIVATE*`, `*PASSWORD*`, `*_KEY` that isn't a known publishable one).
- The repo stays **private until** a secrets/identifier scrub + key-handling review is done, then flips public.
