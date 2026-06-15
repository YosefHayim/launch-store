/**
 * The curated content behind every cross-agent integration file Launch ships.
 *
 * This is the single source the renderers ({@link import("./render.js")}) turn into Claude Skills,
 * Cursor Rules, and the `AGENTS.md` Launch section — so the same prose can't drift across three agents.
 * Two audiences: {@link CONSUMER_SKILLS} + {@link BASE_CONTEXT} teach an agent to DRIVE Launch in a
 * user's own app (scaffolded by `launch agents init`); {@link CONTRIBUTOR_RULES} teach an agent to work
 * ON launch-store (emitted under `.cursor/rules/` by `npm run docs:gen`, gated by `docs:check`).
 *
 * Every command a skill names is a structured {@link SkillStep} so {@link import("./validate.js")} can
 * assert it still resolves in the live `launch` program — a renamed or removed command fails the build.
 */

import type { BaseContext, ConsumerSkill, ContributorRule } from "./types.js";

/**
 * The always-on context every agent gets in a Launch repo. Derived from `AGENTS.md`, the README, and
 * `llms.txt` (kept faithful — no inflation). The {@link BaseContext.guardrail} encodes Launch's own
 * plan → confirm → apply ethos so an agent with `--yes` can't publish to production on its own.
 */
export const BASE_CONTEXT: BaseContext = {
  intro:
    "This repo ships with **Launch** — an open-source, self-hosted alternative to Expo EAS that builds, " +
    "signs, and ships this Expo / React Native app to TestFlight and Google Play from the developer's own " +
    "machine, with their own keys, and no per-build bill. Everything is driven from one typed " +
    "`launch.config.ts`. The pipeline mirrors EAS: prebuild → resolve credentials → compile & sign → " +
    "size-check → store → submit to the **testing** track (TestFlight / Play internal). `launch release` " +
    "is the separate, deliberately confirmed **public** release.",
  commandMap: [
    { eas: "eas build", launch: "launch build", note: "uploads to the testing track (TestFlight / Play internal)" },
    { eas: "eas submit", launch: "launch release", note: "the confirmed PUBLIC production release" },
    {
      eas: "eas update",
      launch: "launch update",
      note: "Expo Updates protocol, on the user's own bucket; `launch updates rollback` reverses it",
    },
    { eas: "eas metadata", launch: "launch metadata", note: "store listing for iOS and Android" },
    { eas: "eas credentials", launch: "launch creds", note: "multi-account, keychain-stored signing material" },
  ],
  rails: [
    "**Secrets stay in the OS keychain.** Never write, log, or commit a `.p8`, `.p12`, keystore, or private key, and never put a real secret in a committed `.env` — store build secrets with `npx launch secret set <NAME>` instead.",
    "**`launch.config.ts` is the source of truth** for store config. The reconcilers (`sync`, `metadata`) run a read-only plan → confirm → apply and never clobber a live or in-review version; preview any of them with `--dry-run`.",
    "**Learn as you go.** `npx launch <command> --explain` expands any step into plain English, and `npx launch demo` walks the whole pipeline as a zero-setup simulation.",
    "**iOS signing needs a Mac.** With no local Mac, build on a cloud Mac in the user's own AWS account, over SSH to any Mac, or hand off to EAS (`npx launch build ios --remote`). Android builds anywhere a JDK runs.",
    "**Non-interactive by design.** Pass `--yes` to run the safe, idempotent commands unattended; Launch already degrades to non-interactive when it detects CI, a pipe, or an agent.",
  ],
  guardrail: {
    free: [
      "**Setup & onboarding** — `init`, `adopt`, and first-time `creds set-key` / `creds setup` (provisioning is idempotent).",
      "**Builds to the testing track** — `build ios|android` uploads to TestFlight / Play internal, not the public store.",
      "**Reads & rehearsals** — `status`, `doctor`, `diagnose`, `demo`, `sync --dry-run`, `metadata pull`, and any command with `--explain`.",
      "**Over-the-air updates** — `update` and `updates list|view` (and `updates rollback` to reverse a bad one).",
    ],
    confirm: [
      "**`launch release ios|android`** — submits to the PUBLIC production track and is hard to reverse. Run `--dry-run` first, show the plan, and let a human trigger the real submit.",
      "**`launch rollout complete`** and accelerating a phased rollout — it pushes a public release toward 100%.",
      "**Credential changes that switch or delete signing material** — `launch creds use|rename|remove`. (First-time `creds set-key` / `creds setup` during onboarding is fine.)",
      "**Applying a store reconcile to a live or in-review listing** — `launch sync` / `launch metadata push` without `--dry-run`, and especially `sync --allow-destructive`. Show the `--dry-run` plan and get confirmation before applying.",
    ],
  },
  bootstrap: [
    "Install Launch as a dev dependency: `npm install --save-dev launch-store` (or `--global` to put `launch` on the PATH).",
    "Verify the toolchain and config before building: `npx launch doctor` (add `--fix` to install missing iOS tools).",
    "The recipes below call `npx launch …`, which resolves the locally-installed binary; with a global install you can drop the `npx`.",
  ],
};

/**
 * The six task-scoped consumer skills, in pipeline order. Each becomes a Claude Skill, a Cursor
 * Agent-Requested rule, and a section of the `AGENTS.md` Launch block. `launch-store-config` carries a
 * {@link ConsumerSkill.reference} (it spans the widest command surface), so Claude gets a bundled
 * `reference.md`; the rest stay self-contained.
 */
export const CONSUMER_SKILLS: ConsumerSkill[] = [
  {
    id: "launch-ship",
    title: "Set up and ship to TestFlight / Play",
    description:
      "Use when the developer wants to build, sign, and ship this Expo / React Native app to TestFlight or Google Play with Launch — first-time setup, provisioning signing credentials, producing a signed build, or uploading to the internal testing track. Covers `launch init`, `launch creds`, `launch doctor`, and `launch build`.",
    triggers: [
      "ship the app to TestFlight or Play internal testing",
      "build and upload a test build",
      "set up code signing / credentials for the app",
      "onboard an existing (already-shipping) app to Launch",
    ],
    steps: [
      { path: ["init"], note: "scaffold launch.config.ts (+ .env.example); skip if it already exists" },
      {
        path: ["adopt"],
        note: "OPTIONAL — app already on the store? import its live App Store Connect setup into config",
      },
      { path: ["creds"], args: ["set-key"], note: "store the App Store Connect API key (.p8) in the OS keychain" },
      {
        path: ["creds"],
        args: ["setup"],
        note: "register the app id and create or reuse the cert + provisioning profile",
      },
      { path: ["doctor"], note: "verify the iOS/Android toolchain and config; add --fix to install missing tools" },
      {
        path: ["build"],
        args: ["ios"],
        note: "run the full pipeline and upload to TestFlight (use 'android' for Play; --no-submit builds only)",
      },
    ],
    body: [
      "Run the steps in order. `init` writes the config, `creds` puts the signing material in the keychain, `doctor` catches toolchain and store-side blockers, and `build` produces a signed binary and uploads it to the **testing** track.",
      "",
      "- `build` flags worth knowing: `--profile <name>` selects a build profile, `--no-submit` builds without uploading, `--dry-run` rehearses every step, `--explain` teaches as it runs, and `--remote [aws|user@host]` builds iOS without a local Mac.",
      "- Manage testers after the upload with `launch testflight` (groups, add/remove testers, `testflight release` to push a build to a group). `launch builds` lists build history; `launch build:resign` re-signs a stored artifact without rebuilding.",
      "- Android: `build android` signs with the upload keystore and uploads to the Play track (`--track internal|closed|open|production`).",
    ].join("\n"),
    cautions: [
      "`build` uploads to the TESTING track only — that's safe. Putting the app in front of the PUBLIC is `launch release` (see the launch-release skill), which needs human confirmation.",
      "First-time `creds setup` provisions real signing assets in the Apple Developer account — expected during onboarding. Switching or removing an account later (`creds use|remove`) needs human confirmation.",
    ],
  },
  {
    id: "launch-release",
    title: "Public release & phased rollout",
    description:
      "Use when the developer wants to submit an already-built version to the PUBLIC App Store or Google Play production track, check review status, or steer a phased rollout (pause / resume / complete). Covers `launch release`, `launch status`, and `launch rollout`. This is the irreversible, outward-facing step — confirm with a human before submitting.",
    triggers: [
      "release the app to the App Store / production / make it public",
      "submit for review or go live",
      "check review or rollout status",
      "pause, resume, or complete a phased rollout",
    ],
    steps: [
      {
        path: ["status"],
        note: "show each app's store version, review state, and phased-rollout state (--json for CI)",
      },
      {
        path: ["release"],
        args: ["ios"],
        note: "submit the latest build to the PUBLIC production track — preview with --dry-run first",
      },
      { path: ["rollout"], args: ["pause"], note: "steer an iOS phased release: pause | resume | complete" },
    ],
    body: [
      "`release` is the deliberate public step, distinct from `build` (which only reaches the testing track). Always preview first.",
      "",
      "- `release <platform> --dry-run` prints the release plan and touches nothing — run it, show the plan, then let a human trigger the real submit.",
      "- iOS options: `--phased` opts into Apple's 7-day phased rollout, `--build latest|<n>` promotes an existing build instead of uploading, `--manual` holds the approved build for manual release, `--scheduled <iso>` schedules go-live.",
      "- `status --watch` polls until review reaches a terminal verdict; `rollout pause|resume|complete` steers an in-progress phased release.",
    ].join("\n"),
    cautions: [
      "`launch release` makes the app PUBLIC and is hard to reverse. Run `launch release <platform> --dry-run`, show the plan, and get explicit human confirmation before the real submit.",
      "`rollout complete` accelerates a public rollout to 100% — confirm before running it.",
    ],
  },
  {
    id: "launch-store-config",
    title: "Store configuration as code",
    description:
      "Use when the developer wants to manage App Store Connect or Google Play configuration as code from launch.config.ts — in-app purchases, subscriptions, pricing, capabilities, listing metadata, promo offers, in-app events, A/B experiments, availability / territories, or custom product pages. Covers `launch sync`, `launch metadata`, `launch offers`, `launch play-products`, `launch play-subscriptions`, and more.",
    triggers: [
      "add or change an in-app purchase or subscription",
      "sync store config / capabilities to App Store Connect",
      "push or pull the store listing metadata",
      "set up Google Play products, subscriptions, or tracks",
      "generate promo offer codes, an in-app event, or an A/B experiment",
    ],
    steps: [
      {
        path: ["sync"],
        note: "reconcile ASC IAPs, subscriptions, pricing, and capabilities from config — run with --dry-run first",
      },
      {
        path: ["metadata", "pull"],
        note: "pull the current listing into store.config.json to edit (--platform android for Play)",
      },
      {
        path: ["metadata", "push"],
        note: "push edited listing copy / screenshots back to the store — --dry-run rehearses",
      },
      { path: ["play-products"], note: "reconcile Google Play in-app products from config" },
      { path: ["play-subscriptions"], note: "reconcile Google Play subscriptions (base plans + offers)" },
    ],
    body: [
      "Store config lives in `launch.config.ts` (catalog) and `store.config.json` (listing). One catalog drives BOTH stores. Every reconcile runs plan → confirm → apply.",
      "",
      "The safe loop: preview with `--dry-run` (or `metadata pull`), review the plan, then apply. See the bundled command reference for the full surface across both stores.",
    ].join("\n"),
    cautions: [
      "These commands change a LIVE store. Always preview with `--dry-run` (or `metadata pull`), show the plan, and get human confirmation before applying.",
      "`sync --allow-destructive` can remove a capability or product — treat it as requiring explicit human sign-off.",
    ],
    reference: {
      intro:
        "The full store-config surface, both stores. Each runs a read-only plan → confirm → apply; preview with `--dry-run` and never apply to a live or in-review listing without human confirmation.",
      commands: [
        {
          path: ["sync"],
          note: "App Store Connect: reconcile IAPs, subscriptions, pricing, capabilities (--dry-run, --allow-destructive, --yes)",
        },
        {
          path: ["metadata", "pull"],
          note: "pull the store listing (copy, screenshots, previews) into store.config.json",
        },
        { path: ["metadata", "push"], note: "push the edited listing back to the store" },
        { path: ["offers", "list"], note: "list promotional offers for a subscription product" },
        { path: ["offers", "generate-codes"], note: "generate one-time promo / offer codes for a product" },
        { path: ["offers", "deactivate"], note: "deactivate an offer" },
        { path: ["play-products"], note: "Google Play: reconcile in-app products" },
        { path: ["play-subscriptions"], note: "Google Play: reconcile subscriptions (base plans + offers)" },
        { path: ["play-tracks", "status"], note: "show Google Play track state" },
        { path: ["play-tracks", "promote"], note: "promote a build between Play tracks" },
        { path: ["availability"], note: "manage territory / country availability" },
        { path: ["custom-pages"], note: "manage custom product pages" },
        { path: ["experiments"], note: "manage product-page A/B experiments" },
        { path: ["events", "list"], note: "list in-app events" },
        { path: ["events", "create"], note: "create an in-app event" },
        { path: ["app-clips"], note: "configure App Clips" },
        { path: ["game-center"], note: "configure Game Center leaderboards / achievements" },
        { path: ["accessibility"], note: "set the accessibility declarations on the listing" },
      ],
    },
  },
  {
    id: "launch-ota",
    title: "Over-the-air updates & rollback",
    description:
      "Use when the developer wants to publish an over-the-air JS / asset update to already-installed builds (Expo Updates protocol), inspect published updates, or roll back a bad update. Covers `launch update` and `launch updates`.",
    triggers: [
      "publish an OTA update / push a JS-only change without a rebuild",
      "ship a hotfix over the air",
      "list or inspect published updates",
      "roll back a bad update",
    ],
    steps: [
      {
        path: ["update"],
        note: "publish a code-signed OTA update to the channel (--channel, --platform; --dry-run rehearses)",
      },
      { path: ["updates", "list"], note: "list published updates for a channel" },
      { path: ["updates", "view"], args: ["latest"], note: "inspect an update by id (or 'latest')" },
      {
        path: ["updates", "rollback"],
        note: "reverse a bad update — promote a known-good one or drop clients to the embedded bundle",
      },
    ],
    body: [
      "OTA updates ship only JS and asset changes the installed runtime can accept (same runtime version), code-signed and hosted on the user's own bucket. **Native** changes (new dependencies, config plugins, permissions) need a full `build` + `release`, not an update.",
      "",
      "- `update --channel <name> --platform ios|android|all` publishes; `--dry-run` prints the layout without uploading. Avoid `--no-sign` (it lets anyone who can write the bucket push JS).",
      "- `updates rollback` is the escape hatch — it promotes a known-good update or drops clients back to the embedded bundle.",
    ].join("\n"),
    cautions: [
      "An OTA update reaches real users immediately. Rehearse with `--dry-run`, and confirm the channel and runtime version before publishing to a production channel.",
    ],
  },
  {
    id: "launch-ci",
    title: "CI on a hosted runner",
    description:
      "Use when the developer wants to build and ship this app from CI — scaffold a GitHub Actions workflow on a hosted macOS / Linux runner, or run Launch unattended and headless. Covers `launch ci init` and the non-interactive, env-var-driven command flow.",
    triggers: [
      "set up CI / GitHub Actions to build and ship the app",
      "build and ship from a hosted runner without a local Mac",
      "run Launch unattended / headless",
      "wire up the release pipeline secrets",
    ],
    steps: [
      {
        path: ["ci", "init"],
        note: "write .github/workflows/launch.yml for a hosted runner (--android adds an Android job)",
      },
      { path: ["doctor"], args: ["--yes"], note: "non-interactive preflight inside the workflow" },
      { path: ["build"], args: ["ios", "--yes"], note: "unattended build + upload to the testing track" },
    ],
    body: [
      "`ci init` writes a transparent, editable workflow (not a black-box action) wired to the same unattended commands Launch already supports.",
      "",
      "- It installs `launch-store` globally on the runner, triggers on `workflow_dispatch` and pushed `v*` tags, and reads credentials from repository secrets decoded at runtime: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_BASE64` (Android adds `PLAY_SERVICE_ACCOUNT_BASE64`, `ANDROID_KEYSTORE_BASE64`, and the key alias/passwords).",
      "- Pass `--yes` on the safe commands; Launch also auto-detects CI and degrades to non-interactive on its own.",
    ].join("\n"),
    cautions: [
      "Keep `launch release` (public production) OUT of an automatic CI trigger — put it behind a manual approval / protected environment so a push can't publish to the store unattended. CI should target the TESTING track by default.",
      "Supply credentials only via repository secrets decoded at runtime; never commit a `.p8`, keystore, or service-account JSON.",
    ],
  },
  {
    id: "launch-doctor",
    title: "Diagnose toolchain & build failures",
    description:
      "Use when a Launch build is failing, the toolchain looks broken, signing or credentials won't resolve, or the developer asks to fix their build environment. Covers `launch doctor --fix` (toolchain) and `launch diagnose` (native build-log analysis).",
    triggers: [
      "the build is failing or broken — fix it",
      "fix the toolchain / install missing build tools",
      "diagnose a native build error",
      "signing or credentials won't resolve",
    ],
    steps: [
      {
        path: ["doctor"],
        note: "detect the iOS/Android toolchain and store-side blockers; --fix installs missing brew tools (--yes for CI)",
      },
      {
        path: ["diagnose"],
        note: "analyze the most recent build log (or a given logfile) and explain the native failure",
      },
      {
        path: ["creds"],
        args: ["status"],
        note: "show which Apple account and signing assets are active when signing fails",
      },
    ],
    body: [
      "Start with `doctor` to separate environment problems from build problems, then `diagnose` to read the actual native failure.",
      "",
      "- `doctor --fix` asks for consent, then installs missing iOS tools via Homebrew (`--yes` skips the prompt for CI/agents). `doctor --platform android` checks the Android toolchain.",
      "- `diagnose` reads the newest log under `~/.launch/logs` (or a path you pass) and explains the failure in plain English. A config footgun check also runs at the head of every `build`.",
      "- When signing is the problem, `creds status` shows the active account; `creds set-key` / `creds setup` fix a missing key or profile.",
    ].join("\n"),
    cautions: [
      "`doctor --fix` installs build tools via Homebrew. It's safe to run, but review what it proposes; pass `--yes` only in CI where unattended installs are intended.",
    ],
  },
];

/**
 * Contributor-facing Cursor rules for working ON the launch-store codebase. `AGENTS.md` stays the
 * canonical prose — these add PATH-triggered guidance Cursor attaches only when the relevant files are
 * open. The first entry is the always-on base rule that simply points Cursor at `AGENTS.md`; the rest
 * are glob-scoped. Emitted under `.cursor/rules/` by `npm run docs:gen` and gated by `docs:check`.
 */
export const CONTRIBUTOR_RULES: ContributorRule[] = [
  {
    file: "launch",
    description: "Always-on contributing context for the launch-store codebase.",
    globs: [],
    alwaysApply: true,
    body: [
      "You are working **on** launch-store (the `launch` CLI), not using it. The canonical working rules live in [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md) — read them first.",
      "",
      "- One Node ESM / TypeScript package. `src/cli` is thin commander wiring (no domain logic), `src/core` is the domain (types, the build→submit pipeline, the provider registry), `src/providers` are the swappable backends, `src/apple` is the App Store Connect integration.",
      "- Before calling a change done, run `npm run typecheck && npm run lint && npm run test && npm run build`, plus `npm run docs:check` (the generated docs + these rules are gated).",
      "- Keep it KISS / YAGNI / DRY: extend the nearest sibling file rather than inventing a new file, util, or abstraction. Add a test (`*.test.ts`) beside any new logic.",
      "- Never log, write, or commit secrets; `~/.launch` holds non-secret paths and ids only.",
    ].join("\n"),
  },
  {
    file: "core-types",
    description: "Editing the domain shapes or provider interfaces.",
    globs: ["src/core/types.ts"],
    alwaysApply: false,
    body: [
      "`src/core/types.ts` is the single source of truth for every domain shape and the five provider interfaces (`BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` / `ComputeHost`).",
      "",
      "- Add or change a shape **here**, never inline in a feature file — a change ripples through every provider and the pipeline, so plan the edit before writing code.",
      "- One exception: the App Store Connect `*Resource` / `*Query` types live in `src/apple/ascClient.ts`, not here.",
    ].join("\n"),
  },
  {
    file: "providers",
    description: "Adding or changing a provider backend (build / storage / credentials / submit / compute).",
    globs: ["src/providers/**"],
    alwaysApply: false,
    body: [
      "Adding a backend = implement one of the five interfaces from `src/core/types.ts` as a named object and register it in `src/providers/index.ts`.",
      "",
      "- The pipeline resolves a provider by its `name` (the value users put in `launch.config.ts`), so you **never** edit `src/core/pipeline.ts` to add a backend.",
      "- Lazy-load heavy / optional SDKs (AWS, the native keyring) through `requireOptional` in `src/core/optionalDep.ts`, so a missing package becomes an actionable install hint instead of a stack trace.",
    ].join("\n"),
  },
  {
    file: "exec-secrets",
    description: "Running child processes or handling credentials / secrets.",
    globs: ["src/core/exec.ts", "src/core/keychain.ts", "src/core/secretStore.ts", "src/core/buildSecrets.ts"],
    alwaysApply: false,
    body: [
      "All child processes go through `src/core/exec.ts` — `run` streams output, `capture` collects stdout — both with `shell: false` and an explicit argv array. Never build a shell string or call `spawn` / `exec` directly.",
      "",
      "- Secrets (`.p8` / `.p12` / keystore / private keys) live in the OS keychain via the secret store; `~/.launch` holds non-secret paths and ids only. Don't log, write, or commit key material.",
    ].join("\n"),
  },
];
