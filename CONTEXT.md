# CONTEXT

Project + architecture context for **Launch** — the domain map the engineering skills read before
exploring. For the working rules (module ownership, code patterns, the validation gate) see
[`AGENTS.md`](./AGENTS.md); for the term-by-term glossary see [`language.md`](./language.md).

## What Launch is

Launch is an open-source CLI (`launch`, published to npm as `launch-store`) that **builds and ships
your iOS and Android apps to the App Store and Google Play from your own machine** — your Apple/Google
credentials, your hardware, no Expo/EAS bill. It targets Expo/React Native apps: it prebuilds the
native project, archives and signs it, estimates the store download size, stores the artifact, and
uploads it to the testing track (a separate, deliberate command does the public release).

The product goal is a "boring, traceable" path from source to store that an individual developer can
run and understand, with an `--explain` mode that teaches the why and the terminology as it goes — and a
first-run `launch demo` that simulates the whole pipeline (no config, build, or account needed) so a
newcomer sees the flow before committing to it.

## Ecosystem primer (new to React Native / Expo / EAS?)

If the terms below are unfamiliar, read this first; every italicized word is defined term-by-term in
[`language.md`](./language.md) (or run `launch explain <topic>`). The stack, bottom to top:

1. **Your code is _React Native_** — one TypeScript/React codebase that runs as a real native iOS +
   Android app. **_Expo_** sits on top of it so you describe the app once in **_app.json_** (name,
   icons, version, permissions, _config plugins_) instead of editing native projects by hand.
2. **_prebuild_ generates the native projects.** `expo prebuild` turns `app.json` into real `ios/`
   and `android/` folders. From there it's ordinary native tooling: on iOS, **_Xcode_** (compiler +
   signing, macOS-only) driven by **_fastlane_**, with native libraries from **_CocoaPods_**; on
   Android, **_Gradle_** (needs only a JDK, no Mac).
3. **Publishing needs accounts + signing.** Apple: an **_Apple Developer Program_** membership, the
   **_App Store Connect_** portal/API, and a chain of signing assets (_bundle id_ → _CSR_ →
   _distribution certificate_ → _provisioning profile_) so a build can be _code-signed_ and sent to
   **_TestFlight_**. Google: the **_Play Console_**, a _service account_ for its API, and an _upload
   key_ under _Play App Signing_. Launch automates all of this except the handful of one-time steps
   the APIs genuinely can't do (creating the _app record_, signing _agreements_, enrolling Play App
   Signing) — for those it deep-links you to the right page.
4. **_EAS_ is the thing Launch replaces.** EAS (Expo Application Services) is Expo's _paid cloud_ that
   runs steps 2–3 on their servers and hosts _OTA updates_. Launch does the same steps on **your own
   machine and accounts** for $0 — and can still _hand off_ to `eas-cli` if you have no Mac.

So Launch's place in the world: it owns the orchestration (`app.json` → prebuild → sign → build →
size-check → store → submit), and delegates the heavy lifting to the same native tools Expo/EAS use
(Xcode/fastlane, Gradle, the ASC and Play APIs) — just locally, transparently, and without the bill.

## The core flow: build → sign → submit

`src/core/pipeline.ts` is the single linear spine; its phases are named in `src/core/phases.ts`
(`PIPELINE_PHASES`), the canonical list the first-run tour also narrates. One `launch build <platform>`
runs, in order:

1. **Resolve app + profile + env** — pick the app from `launch.config.ts`, validate `.env`.
2. **Prebuild** — `expo prebuild` only if there's no native `ios/` / `android/` yet.
3. **Resolve credentials** — signing assets from the OS keychain (provisioning the Apple resources on first run).
4. **Build** — fastlane `gym` (iOS) or Gradle `:app:bundleRelease` (Android), with manual signing.
5. **Size report** — per-device download/install from Xcode's thinning report or bundletool.
6. **Store** — copy the artifact into local (or pluggable) storage with a newest-first index.
7. **Submit** — upload to TestFlight / the Play testing track by default (`--no-submit` stops after the build).

`launch release <platform>` is the **separate** public path: it takes the latest stored artifact and,
after an explicit confirmation, submits it to the App Store review queue / Play production track.
Keeping public release out of `launch build` is what makes an accidental public release impossible.

`--dry-run` rehearses the entire flow with no network call, build, or account change.

## Architecture / module map

One TypeScript / Node ESM package, four areas under `src/`:

| Path            | Owns                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli`       | Thin `commander` wiring — one file per command, each attaching via a `register*` function.                                                                                                                                                                             |
| `src/core`      | The domain: `types`, the `pipeline` (+ `remotePipeline` / `easPipeline`) and its `phases`, the provider `registry`, the first-run `tour` / `firstRun` marker, and `exec` / `paths` / `glossary` / `logger` / `progress` / `config` / `env` / `toolchain` / `keychain`. |
| `src/providers` | The swappable backends, grouped by role: `build`, `storage`, `credentials`, `submit`, `compute`.                                                                                                                                                                       |
| `src/apple`     | The App Store Connect integration (JWT auth, bundle ids, certs, profiles). The import-only APNs push-key vault lives beside it in `core/pushKeyStore.ts`.                                                                                                              |
| `src/google`    | The Google Play integration (service-account auth, upload keystore, Play client).                                                                                                                                                                                      |

## The provider model

Infrastructure is swappable behind five interfaces in `src/core/types.ts`: `BuildEngine`,
`StorageProvider`, `CredentialsProvider`, `Submitter`, `ComputeHost`. A backend is a named object
implementing one interface, registered in `src/providers/index.ts`. The pipeline resolves the
backend by the `name` in the user's `launch.config.ts`, so adding or swapping infrastructure never
touches `pipeline.ts`. Built-ins today: build `fastlane` / `gradle` / `eas`; storage `local`;
submit App Store Connect / Google Play; compute AWS EC2 Mac / BYO-SSH.

## State, secrets, and platforms

- **Secrets never touch the repo.** The `.p8` / `.p12` / private keys live in the OS keychain;
  `~/.launch` holds only non-secret paths, ids, and caches (artifacts, the credentials index, logs).
- **iOS needs a Mac.** When you're off a Mac, `--remote` builds on a remote host — AWS EC2 Mac
  (`src/providers/compute/awsEc2Mac.ts`, via `remotePipeline.ts`) or your own Mac over SSH — or
  `buildEngine: "eas"` hands the build off to Expo's cloud (`easPipeline.ts`).
- **Android builds anywhere** Gradle + a JDK run (no Mac required).

## Where to look first

- A new command → `src/cli/commands/` + `src/cli/index.ts`.
- The end-to-end flow → `src/core/pipeline.ts`.
- A new backend → the matching interface in `src/core/types.ts` + a file under `src/providers/<role>/`.
- Domain terms / teaching copy → `src/core/glossary.ts` (runtime) and [`language.md`](./language.md) (reference).
