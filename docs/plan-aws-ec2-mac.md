# Launch — Remote / Cloud-Mac Build (AWS EC2 Mac + EAS handoff)

How non-Mac developers (Windows / Linux) build, sign, and submit iOS apps through Launch — either by
orchestrating a **cloud Mac on AWS EC2 Mac**, or by **handing off to Expo EAS**. This extends the
local-Mac spine in [`PLAN.md`](./PLAN.md); read that first for the core architecture, the credential
model, the provider seam, and the v1 pipeline. This document adds the remote layer **without repeating**
those — it links back where they apply.

> **Status:** designed and locked via a `/grill-me` session on 2026-06-13; **implemented** 2026-06-14
> (Phases 0–4 + cross-cutting). It ships behind explicit opt-in (`launch` wizard / `--remote`) with the
> amended key promise — see [Security](#security--amendments-to-the-plan). The repo stays **private until
> the security pass** ([`PLAN.md` § Security notes](./PLAN.md)); this feature is part of what that pass reviews.

---

## Why this exists (the problem, concretely)

The v1 spine assumes you own a Mac. A large share of the React Native / Expo world develops on Windows or
Linux and has **no Mac to sign on** — that is exactly the wall that pushes them onto EAS. Launch's answer is
to detect a non-Mac host in the wizard and offer two honest paths:

1. **Cloud Mac (AWS EC2 Mac)** — Launch provisions a Mac in _your own_ AWS account, builds + signs + submits
   on it, then tears it down. You pay AWS directly (~$16 minimum per session — see [Cost](#cost--verified-against-aws-docs)).
2. **Expo EAS handoff** — Launch orchestrates `eas-cli` end-to-end for you (build + submit) using Expo's
   free-tier cloud. No Mac, no AWS, but you're on Expo's plan limits.

Neither path is "free cloud Mac" — that claim would be false. The product stays honest: own a Mac → $0; no
Mac → either pay AWS per session, or use Expo's free tier with its caps.

---

## The two hard truths (stated plainly)

1. **iOS signing is macOS-only, so signing keys must travel.** `codesign` / `fastlane gym` can only run on
   macOS, and the user has no local Mac, so the `.p8` + distribution `.p12` + provisioning profile **have to
   reach the remote Mac**. There is no cryptographic trick around this. We make it safe with consent + an
   ephemeral keychain + shredding (decision 1), and we **amend the README promise** to say so.
2. **EC2 Mac has a hard ~$16 / 24-hour floor.** It is genuinely more expensive than EAS for _occasional_
   builds, and a GitHub Actions macOS runner is cheaper still. We surface this up front rather than hiding it.

---

## Cost — verified against AWS docs

Verified 2026-06-13 against AWS's own documentation (not memory). These facts shape the entire lifecycle UX.

| Fact                                             | Source (verbatim)                                                                                                                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **24h minimum allocation, per-second after**     | EC2 Mac FAQ: _"Billing is per second, with a 24-hour minimum allocation period for the Dedicated Host to comply with the Apple macOS Software License Agreement."_                                                                             |
| **Release only after 24h**                       | EC2 Mac FAQ: _"At the end of the 24-hour minimum allocation period, the host can be released at any time with no further commitment."_                                                                                                         |
| **Stopping the instance does NOT stop the bill** | Dedicated Host billing doc: _"You pay per second (with a minimum of 60 seconds) for active Dedicated Host, regardless of the quantity or the size of instances that you choose to launch on it."_ — only **releasing the host** stops charges. |
| **Rate**                                         | `mac2.metal` (M1) and `mac2-m2.metal` (M2) ≈ **$0.65/hr** → **~$15.60 minimum** per 24h allocation, whether you run 1 build or 50.                                                                                                             |

**Cost-reduction levers — what actually exists, and why they don't help the target user:**

- **Savings Plans — "up to 44% off"** (FAQ), but require a **1–3 year commitment to continuous usage**. For an
  occasional indie builder that's a _net loss_ (you pay every hour for a year). Only wins for high-volume CI.
- **Dedicated Host Reservations** — same 1–3 yr lock-in, and _"the Dedicated Host can't be released until the
  reservation's term is over."_ Worse for occasional use.
- **Batch builds into the one 24h window you already paid for** — the **only** lever that helps occasional
  users, because the ~$15.60 is **per-allocation, not per-build**. Launch _enforces_ this (decision 3).

**Conclusion:** there is no per-build option under ~$16 on EC2 Mac. For people who build occasionally, a
GitHub Actions macOS runner (per-minute, no 24h floor, free on public repos) stays cheaper — keep that
honest framing in the README. Launch's value here is _automation + your-own-account + same-keys-everywhere_,
not "cheaper than EAS."

Sources: [EC2 Mac FAQ](https://aws.amazon.com/ec2/instance-types/mac/faqs/) ·
[Dedicated Host billing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/dedicated-hosts-billing.html).

---

## Decisions (all locked during the grill)

| #   | Area                  | Decision                                                                                                                                                                                                                                                                 | Rationale                                                                                                                                                         |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Keys on remote**    | Upload `.p8`/`.p12`/profile to the host into an **ephemeral keychain**, build, then **shred** keychain + files on teardown. Explicit one-time consent. **Amend the README promise.**                                                                                     | Signing off-Mac is impossible; this is the only honest way to ship it. The remote host is treated as user-controlled infra.                                       |
| 2   | **Architecture**      | Two layers. A generic **`RemoteMac` BuildEngine over SSH** (works against _any_ reachable Mac) is the reusable core; **AWS provisioning is a separate, optional `ComputeHost` provider** on top.                                                                         | Quarantines AWS billing/quota code; the SSH core works against MacStadium / a colleague's Mac / a hand-launched EC2 instance on day one.                          |
| 3   | **Cost lifecycle**    | Typed consent showing the ~$15.60/24h floor → **paid-window reuse** (batched builds ~free) → persistent cost banner + `cloud status` → **auto-release at ~23.5h** → `cloud teardown` anytime. No Savings-Plan management.                                                | Makes the only real cost lever automatic and a forgotten host _unable_ to bill a second $16.                                                                      |
| 4   | **AWS auth**          | Standard SDK **credential chain** (env → `~/.aws` profiles → SSO → IMDS). `aws: { region, profile, amiId? }` in `launch.config.ts`. **Zero AWS secrets stored** by Launch. Lazy-load the SDK.                                                                            | Idiomatic; reuses `aws configure`; works the same on Windows/Linux; no new secret store for AWS.                                                                  |
| 5   | **Wizard**            | New top-level **no-args `launch` wizard** (Expo-style front door) that detects the OS and routes init/creds/build/cloud; the non-Mac "pick your path" branch lives here. Plus a `launch cloud` group for scripting.                                                      | First-run UX parity with Expo; one front door. The wizard **calls the same functions** the subcommands use (DRY), not a second copy.                              |
| 6   | **Secret store**      | New **`SecretStore` interface** backed by each OS's native store via `@napi-rs/keyring` (**not** `keytar` — archived 2023): macOS Keychain, Windows Credential Manager, Linux libsecret.                                                                                 | Non-Mac users have no macOS Keychain; this gives a real OS-native store everywhere. Native dep ships via `optionalDependencies` — no bloat to our tarball.        |
| 7   | **Cert lifecycle**    | Distribution key + CSR **born locally via `openssl`** (cross-platform; never on rented infra). Durable home = local native keychain + encrypted `.p12` backup in `~/.launch`. A **transient copy** rides to each host (decision 1). **One cert reused** across sessions. | Apple caps distribution certs at ~2–3; minting per session would blow the cap. The private key never originates on AWS.                                           |
| 8   | **Toolchain / AMI**   | If `aws.amiId` is set → use it (**BYO**). Else **bootstrap once** (Xcode/fastlane/node) → snapshot a **golden AMI in the user's own account** → persist the ID to **`~/.launch/cloud.json`** → reuse.                                                                    | Xcode can't be legally redistributed in a shared AMI, so it must live in the user's account. Golden-AMI reuse keeps later sessions fast (less paid-window waste). |
| 9   | **Source sync**       | **Clean archive over SSH/SFTP** honoring `.gitignore` + explicit excludes (`node_modules`, `.git`, native build dirs, `.env`). Fresh install on host. `.env` **values** injected as build env vars separately.                                                           | Deterministic, no extra services; never uploads `node_modules`, history, or local secrets to rented infra.                                                        |
| 10  | **Submit + artifact** | **Submit from the host** (reuse the fastlane submitter — toolchain + uploaded `.p8` already there) → TestFlight. **Also pull the `.ipa` home** to `~/.launch/artifacts`.                                                                                                 | Avoids a giant double-upload; keeping a local artifact preserves `launch release ios` (stored-build → public App Store).                                          |
| 11  | **EAS path**          | **Orchestrate `eas-cli` end-to-end**, contained behind one `eas` adapter: detect `eas-cli` (don't bundle), drive `eas build --json` / `eas submit`, fail loudly if Expo's CLI shape drifts.                                                                              | User preference. Containment keeps the coupling to Expo's frequently-changing CLI in one replaceable place.                                                       |

> **Supersedes** the tentative `ComputeProvider` note in [`PLAN.md` § Scope boundary](./PLAN.md): the interface
> is **`ComputeHost`**, and remote build compute is now designed (this doc), not merely deferred.

---

## Credentials on a remote host, in plain terms

Extends [`PLAN.md` § The credentials, in plain terms](./PLAN.md). Same Apple artifacts; what changes is the
journey to a machine you don't physically own:

- **Distribution key + cert** — generated locally with `openssl`, kept in your native keychain + a chmod-600
  `.p12` backup in `~/.launch`. A **transient copy** is uploaded to the host's ephemeral keychain for the
  build, then shredded. One cert, reused across every session.
- **App Store Connect `.p8`** — held in your native keychain (Keychain / Credential Manager / libsecret); a
  transient copy is uploaded so the host can upload the build to TestFlight. Shredded on teardown.
- **Provisioning profile** — installed on the host where Xcode looks, for the duration of the build only.
- **App record** — still the one irreducible Developer-UI step ([`PLAN.md`](./PLAN.md)); unchanged by remote builds.

Everything uploaded lives in a per-session ephemeral keychain and a temp dir that the teardown step deletes,
on every exit path (success, failure, or `cloud teardown`).

---

## Architecture — the new seams

Adds two interfaces to the provider model in [`PLAN.md` § Architecture](./PLAN.md). Cloud SDK + native deps
stay lazy/optional so a local-only install pulls nothing extra.

```
core/pipeline.ts orchestrates (additions in **bold**):

  CredentialsProvider  resolve() status()                 ── local (Keychain) ✓
  SecretStore          get() set() delete()               ── **native: keytar-free, per-OS** (new seam under credentials)
  BuildEngine          build() → { ipaPath, sizeReport }  ── fastlane ✓ · **remote-mac (SSH)** · eas (orchestrated)
  ComputeHost          allocate() connect() exec()         ── **aws-ec2-mac** · [byo-ssh, macstadium later]
                       teardown() status()
  StorageProvider      put() list() url()                  ── local ✓
  Submitter            submit(ipa, target)                 ── App Store Connect ✓ (runs on the host for remote builds)
```

- **`SecretStore`** — generic secret get/set/delete behind the native OS store. The existing macOS `security`
  calls that _import a cert into a codesign keychain_ are **not** secret storage and stay as-is.
- **`RemoteMac` BuildEngine** — given an SSH-reachable Mac (from any `ComputeHost`, or a user-supplied host),
  it archives + syncs the project, uploads transient creds, runs the same `fastlane gym` + submit on the host,
  and pulls the `.ipa` home. Host-agnostic — it does not know about AWS.
- **`ComputeHost`** — `allocate` / `connect` / `exec` / `teardown` / `status`. `aws-ec2-mac` is the first impl;
  a `byo-ssh` (connect to a Mac you already have) impl is the trivial fallback the SSH core enables for free.

---

## The remote build pipeline (extends the v1 spine)

When `buildEngine` resolves to `remote-mac` (or the wizard routes a non-Mac user to AWS), the
[v1 pipeline](./PLAN.md) gains a host lifecycle around the same steps — the build/sign/submit logic is reused,
it just executes over SSH:

```
launch build ios --remote            (or via the wizard on a non-Mac)
  C1  resolve AWS creds + cloud doctor   (credential chain; quota + IAM preflight; consent on first allocate)
  C2  acquire host                       (reuse a live paid-window host → else allocate Dedicated Host)
  C3  ensure toolchain                   (boot golden AMI → else bootstrap once + snapshot AMI)
  C4  upload transient creds             (.p8/.p12/profile → ephemeral keychain on host)
   ‖   ── then the standard spine, on the host ──
   3  ensure native project · 5 resolve signing · 6 bump build # · 7 fastlane gym → .ipa
   8  size report · 10 fastlane pilot → TestFlight
  C5  pull artifact home                 (.ipa → ~/.launch/artifacts so `launch release` still works)
  C6  shred                              (delete ephemeral keychain + uploaded files on the host)
  C7  host disposition                   (keep alive for the paid window; auto-release scheduled at ~23.5h)

  --dry-run rehearses C1–C7 with NO AWS calls / NO SSH / NO account changes (mirrors the local dry-run).
```

---

## Command + wizard surface (additions to [`PLAN.md`](./PLAN.md))

```
launch                                   # NEW: no-args interactive wizard (Expo-style front door)
                                         #   detects OS → on non-Mac offers: [AWS cloud Mac | Expo EAS | connect existing Mac]
launch build ios --remote [aws|<ssh>]    # opt into a remote build (also auto-offered on non-Mac)
launch cloud setup                       # configure AWS region/profile, run cloud doctor, first golden-AMI bootstrap
launch cloud status                      # show any live host: age, ~$ so far, releasable-after time
launch cloud teardown                    # stop instance + release host (warns it bills until the 24h mark)
launch cloud doctor                      # AWS creds, Dedicated-Host quota, IAM perms, region availability
```

`--remote` is available to Mac users too (e.g. a slow machine); it is only _auto-offered_ on non-Mac.

## Config additions (`launch.config.ts`)

```ts
export default defineConfig({
  // ...existing...
  buildEngine: "remote-mac", // or keep "fastlane" for local
  aws: {
    region: "us-east-1",
    profile: "default", // a named profile in ~/.aws; resolved via the standard chain
    amiId: undefined, // optional BYO golden AMI; omit to let Launch bootstrap + snapshot one
    instanceType: "mac2.metal", // default: cheapest M-series available in the region
  },
});
```

Machine-discovered state (the auto-created golden AMI id, live host id + allocation timestamp) lives in
**`~/.launch/cloud.json`**, never in `.env` and never committed. `aws.amiId` in config is the optional,
shareable override; the state file holds what Launch created for this machine.

---

## The EAS handoff path (the wizard's other branch)

When a non-Mac user picks **Expo EAS**, Launch orchestrates `eas-cli` behind a single adapter:

- Detect `eas-cli` (global or `npx`); guide install if missing. **Never bundled** as a dependency.
- Ensure an Expo session (`eas whoami` → `eas login` interactively); Launch stores no Expo credentials.
- Run `eas build --platform ios --profile <profile> --json`, parse the result, then optionally `eas submit`.
- **Fail loudly with actionable guidance** if Expo's CLI output shape changes — the coupling is intentional
  and isolated so a break is one file to fix, not a scattered hunt.

This is the one place Launch leans on the tool it otherwise replaces; we accept that to give no-Mac users a
zero-cost path, and we contain the risk rather than spread it.

---

## Cost & lifecycle UX (decision 3, expanded)

- **Before the first allocate:** a typed-consent prompt that states the ~$15.60/24h floor, that stopping the
  instance does **not** stop the bill, and that Savings Plans only help constant usage.
- **During:** every command prints a one-line banner when a host is live — `host i-… up 3h12m, ~$2.08 so
far, releasable after 14:50`. `launch cloud status` shows the same in detail.
- **Reuse:** a build reuses the live paid-window host instead of allocating a new one — batched builds within
  the window are effectively free.
- **Auto-release:** a release is scheduled for ~23.5h after allocation so a forgotten host can never roll into
  a second $16 day. `launch cloud teardown` releases earlier where allowed (and explains the 24h floor when it isn't).

---

## Security — amendments to [`PLAN.md` § Security notes](./PLAN.md)

This feature is the first time Apple private keys leave the local machine, so it adds obligations:

- **Amend the README promise.** "keys that never leave your machine" → "…stay in your local keychain for local
  builds; remote builds upload a transient copy to **your** cloud Mac only with explicit consent, and shred it
  on teardown." Honesty over marketing.
- **Explicit opt-in.** Remote builds never happen implicitly; the wizard/`--remote` and a consent prompt gate them.
- **Ephemeral everything on the host:** a per-session keychain + temp dir, deleted on every exit path.
- **Never upload `.env` or secrets in the archive** (decision 9); `.env` values are injected as process env on
  the host for the build only.
- **Least-privilege AWS.** `cloud doctor` checks for exactly the IAM actions needed
  (`ec2:AllocateHosts` / `RunInstances` / `DescribeHosts` / `ReleaseHosts` / image + key-pair actions) and
  documents a minimal policy — Launch never asks for broad admin.
- **Repo stays private until the security pass** — unchanged, and this feature is part of what that pass must review.

---

## Build order (each phase ships value on its own)

- **Phase 0 — foundations (no AWS):** `SecretStore` + `ComputeHost` interfaces; OS detection; make the
  `openssl` cert-gen path work off-Mac; refactor `core/keychain.ts` behind `SecretStore` (+ `@napi-rs/keyring`).
- **Phase 1 — generic `RemoteMac` BuildEngine (SSH):** archive → sync → upload transient creds → remote
  `gym` + submit (ephemeral keychain + shred) → pull `.ipa`. Testable against **any** Mac; no AWS yet.
- **Phase 2 — AWS `ComputeHost`:** credential chain, `cloud doctor` (quota/IAM), allocate → bootstrap →
  golden-AMI, full cost lifecycle (consent / banner / auto-release / `status` / `teardown`).
- **Phase 3 — wizard front door** + `launch cloud` command group (DRY over existing functions).
- **Phase 4 — EAS orchestration adapter.**
- **Cross-cutting:** README promise amendment, `--dry-run` for the cloud flow, tests for the new seams, and
  folding the final shape back into [`PLAN.md`](./PLAN.md).

---

## Open items to design at build time

- **Dedicated-Host quota** for Mac is often **not instant** (requires an AWS quota increase) — `cloud doctor`
  must detect and guide, and `setup` must handle "quota pending" gracefully.
- **Xcode install needs an Apple ID** (separate from the ASC API key) during the first bootstrap — decide how
  the wizard collects/uses it without persisting it.
- **Default instance type** per region (cheapest available M-series) + region availability checks.
- **`@napi-rs/keyring` packaging** — verify prebuilt binaries cover the target platforms/arches and that
  `optionalDependencies` resolution is clean on CI and on user installs.
- **AWS SDK footprint** — pin to the modular `@aws-sdk/client-ec2` + `@aws-sdk/credential-providers` and keep
  them lazy so local-only installs never import them.

---

See also: [`PLAN.md`](./PLAN.md) (local spine, provider seam, credential model) · [`README.md`](../README.md)
(usage; the "Why Launch?" positioning to amend per [Security](#security--amendments-to-the-plan)).
