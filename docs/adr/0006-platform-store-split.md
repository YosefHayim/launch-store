# ADR 0006 — Decouple the build **platform** from the submit **store**

- **Status:** Accepted — foundation shipped (`refactor/platform-store-split`); the alt-store / Apple-platform
  worktrees ride on it. — 2026-06-27
- **Context:** converged in a `/grill-with-docs` session on expanding Launch beyond the App Store + Google
  Play. This ADR is the decision record for the **foundation** the per-store / per-platform work depends on.

## Context

Launch fuses two concepts that an expansion to more stores forces apart:

- **`Platform`** — what you _build_: `"ios" | "android"` (`src/core/types/app.ts`), the build-engine + artifact axis.
- **The store** — where you _submit_: a single `LaunchConfig.submit` string, mapped 1:1 to a `Submitter`
  (`resolveSubmitterName` in `pipeline.ts`: the iOS default `app-store-connect` swaps to `google-play` on Android).

That 1:1 weld blocks both expansion directions the grill surfaced:

- **Alternative Android stores** (Amazon Appstore, Samsung Galaxy Store, Huawei AppGallery) break it _one_
  way — the **same** `.aab` must reach **several** stores. One platform → many stores.
- **More Apple platforms** (tvOS, macOS, visionOS) break it the _other_ way — one Apple identity → several
  build targets → the **same** store (App Store Connect). Many platforms → one store.

The `Submitter` interface is already store-shaped (`name`, `submit(...)`), so the seam is in the right
place. What's missing is a config + resolution that lets one build fan out to N stores, and a `Platform`
that's free to grow. Doing this once, centrally, is what keeps every later store a drop-in.

**Goal (locked):** make platform↔store many-to-one/one-to-many _possible_ without changing any of the five
provider interfaces, and **without changing behavior for any existing config** (string `submit` stays
byte-identical). Ship the harder **store-decoupling** half; Apple-platform build targets widen `Platform`
in their own follow-ups.

## Decision

`LaunchConfig.submit` grows from `string` to `string | SubmitByPlatform`:

```ts
/** Per-platform list of registered Submitter names a build for that Platform uploads to, in order. */
export type SubmitByPlatform = Partial<Record<Platform, string[]>>;

submit: string | SubmitByPlatform;
// "app-store-connect"                                   // unchanged: one store, mapped per platform
// { ios: ["app-store-connect"], android: ["google-play", "amazon-appstore"] }   // fan-out
```

Resolution moves from "the submitter name" to "the store **list** for this platform":

```ts
resolveSubmitters(config, platform): string[]   // string form → [one]; map form → its list (defaults when omitted)
submitToStores(config, platform, artifact, target, creds, ctx): Promise<string[]>  // loops, submits to each
```

`resolveSubmitterName` is kept as `resolveSubmitters(...)[0]` (the **primary** store) for the one caller
that wants a single name (the build preview). Every real submit site — both pipeline tails, `launch
release` (iOS + Android), and the release train's Android car — routes through `submitToStores`. For a
single-store config the list has one element, so the loop runs once and behavior is identical; the only
visible change is an extra "…and N more store(s)" suffix on the Android submit log when more than one store
is configured.

### Why per-platform arrays (not a flat list, not per-store objects)

The grill weighed three config shapes. **Per-platform store arrays** won because:

- it reads exactly like the model ("android → these stores"), no routing inference;
- it leaves the **`Submitter` interface untouched** — the flat-list alternative needed an `accepts:
  Platform[]` field on every submitter (a provider-interface change → the broadest ripple, plan-mode-first);
- per-store option objects are YAGNI today (no alt store needs extra options yet) and still need a routing key.

The committed JSON Schema (`schema/launch.config.schema.json`) regenerates from the type as an `anyOf`
(string | object), which the hand-rolled validator already supports, so `launch config validate` and the
generated `docs/config.md` stay correct with no generator change.

## Consequences

- **+** Adding an Android store is the documented `add-a-provider` path — implement a `Submitter`, register
  it, list its name under `submit.android`. The submit loop is never touched.
- **+** Adding an Apple platform (tvOS/macOS/visionOS) is a `Platform`-union widening + build-target plumbing;
  `SubmitByPlatform` grows with the union for free, and each lists just `app-store-connect`.
- **+** Zero behavior change for every existing config (string `submit`), guarded by the pipeline tests.
- **−** "Platform" and "store" are now distinct terms that were synonyms; `language.md`/`CONTEXT.md` are
  updated so the glossary doesn't drift. The build preview shows only the **primary** store per platform
  (the first of the list) — a deliberate v1 simplification; a full multi-store preview is a follow-up.
- **−** Live submission to a third-party store can only be end-to-end verified with that vendor's developer
  account; the Submitters ship production-shaped (auth, lazy SDK load, `doctor` messaging, unit tests) with
  the live hop validated by the operator.

## Out of scope (follow-ups that ride this foundation)

- The three alternative-Android-store Submitters (`amazon-appstore`, `galaxy-store`, `app-gallery`).
- The Apple-platform build targets (tvOS / macOS / visionOS) that widen `Platform`.
- A multi-store **build preview** and per-store `notify` events (v1 keeps the primary-store preview + the
  existing single submit notification).
