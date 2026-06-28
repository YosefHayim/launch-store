/**
 * The curated content behind every cross-agent integration file Launch ships.
 *
 * This is the single source the renderers ({@link import("./render.js")}) turn into Claude Skills,
 * Cursor Rules, and the `AGENTS.md` Launch section — so the same prose can't drift across three agents.
 * Two audiences: {@link CONSUMER_SKILLS} + {@link BASE_CONTEXT} teach an agent to DRIVE Launch in a
 * user's own app (scaffolded by `launch agents init`); {@link CONTRIBUTOR_RULES} (Cursor) and
 * {@link CONTRIBUTOR_SKILLS} (Claude) teach an agent to work ON launch-store (emitted under
 * `.cursor/rules/` and `.claude/skills/` by `npm run docs:gen`, gated by `docs:check`).
 *
 * Every command a skill names is a structured {@link SkillStep} so {@link import("./validate.js")} can
 * assert it still resolves in the live `launch` program — a renamed or removed command fails the build.
 */

import type { BaseContext, ConsumerSkill, ContributorRule, ContributorSkill } from './types.js';

/**
 * The always-on context every agent gets in a Launch repo. Derived from `AGENTS.md`, the README, and
 * `llms.txt` (kept faithful — no inflation). The {@link BaseContext.guardrail} encodes Launch's own
 * plan → confirm → apply ethos so an agent with `--yes` can't publish to production on its own.
 */
export const BASE_CONTEXT: BaseContext = {
  intro:
    'This repo ships with **Launch** — an open-source, self-hosted alternative to Expo EAS that builds, ' +
    "signs, and ships this Expo / React Native app to TestFlight and Google Play from the developer's own " +
    'machine, with their own keys, and no per-build bill. Everything is driven from one typed ' +
    '`launch.config.ts`. The pipeline mirrors EAS: prebuild → resolve credentials → compile & sign → ' +
    'size-check → store → submit to the **testing** track (TestFlight / Play internal). `launch release` ' +
    'is the separate, deliberately confirmed **public** release.',
  commandMap: [
    {
      eas: 'eas build',
      launch: 'launch build',
      note: 'uploads to the testing track (TestFlight / Play internal)',
    },
    {
      eas: 'eas submit',
      launch: 'launch release',
      note: 'the confirmed PUBLIC production release',
    },
    {
      eas: 'eas update',
      launch: 'launch update',
      note: "Expo Updates protocol, on the user's own bucket; `launch updates rollback` reverses it",
    },
    { eas: 'eas metadata', launch: 'launch metadata', note: 'store listing for iOS and Android' },
    {
      eas: 'eas credentials',
      launch: 'launch creds',
      note: 'multi-account, keychain-stored signing material',
    },
  ],
  rails: [
    '**Secrets stay in the OS keychain.** Never write, log, or commit a `.p8`, `.p12`, keystore, or private key, and never put a real secret in a committed `.env` — store build secrets with `npx launch secret set <NAME>` instead.',
    '**`launch.config.ts` is the source of truth** for store config. The reconcilers (`sync`, `metadata`) run a read-only plan → confirm → apply and never clobber a live or in-review version; preview any of them with `--dry-run`.',
    '**Learn as you go.** `npx launch <command> --explain` expands any step into plain English, and `npx launch demo` walks the whole pipeline as a zero-setup simulation.',
    "**iOS signing needs a Mac.** With no local Mac, build on a cloud Mac in the user's own AWS account, over SSH to any Mac, or hand off to EAS (`npx launch build ios --remote`). Android builds anywhere a JDK runs.",
    '**Non-interactive by design.** Pass `--yes` to run the safe, idempotent commands unattended; Launch already degrades to non-interactive when it detects CI, a pipe, or an agent.',
  ],
  guardrail: {
    free: [
      '**Setup & onboarding** — `init`, `adopt`, `migrate eas|fastlane`, and first-time `creds set-key` / `creds setup` (provisioning is idempotent).',
      '**Builds to the testing track** — `build ios|android` uploads to TestFlight / Play internal, not the public store.',
      '**Reads & rehearsals** — `status`, `doctor`, `diagnose`, `demo`, `sync --dry-run`, `metadata pull`, and any command with `--explain`.',
      '**Planning & readiness (read-only)** — `plan`, `drift`, `audit`, `store doctor`, `iap doctor`, `privacy scan`, `snapshot create|diff`, and `insights` only read live state.',
      "**Local-only tooling** — `dashboard` (a read-only local web UI over CLI state) and `mcp install` (expose Launch to local AI clients) run on the developer's machine, never touching the store.",
      '**Over-the-air updates** — `update` and `updates list|view` (and `updates rollback` to reverse a bad one).',
    ],
    confirm: [
      '**`launch release ios|android`** — submits to the PUBLIC production track and is hard to reverse. Run `--dry-run` first, show the plan, and let a human trigger the real submit.',
      '**`launch rollout complete`** and accelerating a phased rollout — it pushes a public release toward 100%.',
      '**Credential changes that switch or delete signing material** — `launch creds use|rename|remove`. (First-time `creds set-key` / `creds setup` during onboarding is fine.)',
      '**Applying a store reconcile to a live or in-review listing** — `launch sync` / `launch metadata push` without `--dry-run`, and especially `sync --allow-destructive`. Show the `--dry-run` plan and get confirmation before applying.',
    ],
  },
  bootstrap: [
    'Install Launch as a dev dependency: `npm install --save-dev launch-store` (or `--global` to put `launch` on the PATH).',
    'Verify the toolchain and config before building: `npx launch doctor` (add `--fix` to install missing iOS tools).',
    'The recipes below call `npx launch …`, which resolves the locally-installed binary; with a global install you can drop the `npx`.',
  ],
};

/**
 * The thirteen task-scoped consumer skills, in pipeline order — the six core ship/release flows first,
 * then the readiness, planning, snapshot, migration, insights, AI-listing, and agent-access surfaces that
 * the wider command set unlocked. Each becomes a Claude Skill, a Cursor Agent-Requested rule, and a
 * section of the `AGENTS.md` Launch block. `launch-store-config` carries a {@link ConsumerSkill.reference}
 * (it spans the widest command surface), so Claude gets a bundled `reference.md`; the rest stay
 * self-contained.
 */
export const CONSUMER_SKILLS: ConsumerSkill[] = [
  {
    id: 'launch-ship',
    title: 'Set up and ship to TestFlight / Play',
    description:
      'Use when the developer wants to build, sign, and ship this Expo / React Native app to TestFlight or Google Play with Launch — first-time setup, provisioning signing credentials, producing a signed build, or uploading to the internal testing track. Covers `launch init`, `launch creds`, `launch doctor`, and `launch build`.',
    triggers: [
      'ship the app to TestFlight or Play internal testing',
      'build and upload a test build',
      'set up code signing / credentials for the app',
      'onboard an existing (already-shipping) app to Launch',
    ],
    steps: [
      {
        path: ['init'],
        note: 'scaffold launch.config.ts (+ .env.example); skip if it already exists',
      },
      {
        path: ['adopt'],
        note: 'OPTIONAL — app already on the store? import its live App Store Connect setup into config',
      },
      {
        path: ['creds'],
        args: ['set-key'],
        note: 'store the App Store Connect API key (.p8) in the OS keychain',
      },
      {
        path: ['creds'],
        args: ['setup'],
        note: 'register the app id and create or reuse the cert + provisioning profile',
      },
      {
        path: ['doctor'],
        note: 'verify the iOS/Android toolchain and config; add --fix to install missing tools',
      },
      {
        path: ['build'],
        args: ['ios'],
        note: "run the full pipeline and upload to TestFlight (use 'android' for Play; --no-submit builds only)",
      },
    ],
    body: [
      'Run the steps in order. `init` writes the config, `creds` puts the signing material in the keychain, `doctor` catches toolchain and store-side blockers, and `build` produces a signed binary and uploads it to the **testing** track.',
      '',
      '- `build` flags worth knowing: `--profile <name>` selects a build profile, `--no-submit` builds without uploading, `--dry-run` rehearses every step, `--explain` teaches as it runs, and `--remote [aws|user@host]` builds iOS without a local Mac.',
      '- Manage testers after the upload with `launch testflight` (groups, add/remove testers, `testflight release` to push a build to a group). `launch builds` lists build history; `launch build:resign` re-signs a stored artifact without rebuilding.',
      '- Android: `build android` signs with the upload keystore and uploads to the Play track (`--track internal|closed|open|production`).',
    ].join('\n'),
    cautions: [
      "`build` uploads to the TESTING track only — that's safe. Putting the app in front of the PUBLIC is `launch release` (see the launch-release skill), which needs human confirmation.",
      'First-time `creds setup` provisions real signing assets in the Apple Developer account — expected during onboarding. Switching or removing an account later (`creds use|remove`) needs human confirmation.',
    ],
  },
  {
    id: 'launch-release',
    title: 'Public release & phased rollout',
    description:
      'Use when the developer wants to submit an already-built version to the PUBLIC App Store or Google Play production track, check review status, or steer a phased rollout (pause / resume / complete). Covers `launch release`, `launch status`, and `launch rollout`. This is the irreversible, outward-facing step — confirm with a human before submitting.',
    triggers: [
      'release the app to the App Store / production / make it public',
      'submit for review or go live',
      'check review or rollout status',
      'pause, resume, or complete a phased rollout',
    ],
    steps: [
      {
        path: ['status'],
        note: "show each app's store version, review state, and phased-rollout state (--json for CI)",
      },
      {
        path: ['release'],
        args: ['ios'],
        note: 'submit the latest build to the PUBLIC production track — preview with --dry-run first',
      },
      {
        path: ['rollout'],
        args: ['pause'],
        note: 'steer an iOS phased release: pause | resume | complete',
      },
      {
        path: ['release-train'],
        args: ['start'],
        note: 'coordinate iOS + Android + OTA as one resumable release record (start | status | release | abort)',
      },
    ],
    body: [
      '`release` is the deliberate public step, distinct from `build` (which only reaches the testing track). Always preview first.',
      '',
      '- `release <platform> --dry-run` prints the release plan and touches nothing — run it, show the plan, then let a human trigger the real submit.',
      "- iOS options: `--phased` opts into Apple's 7-day phased rollout, `--build latest|<n>` promotes an existing build instead of uploading, `--manual` holds the approved build for manual release, `--scheduled <iso>` schedules go-live.",
      '- `status --watch` polls until review reaches a terminal verdict; `rollout pause|resume|complete` steers an in-progress phased release.',
      '- Shipping iOS + Android (and an OTA leg) together? `release-train start` records the whole release as one resumable unit — `--hold` gates every leg until all are approved and releases them together, `--platform`/`--no-ota` scope it, and `status`/`release`/`abort` drive or unwind it.',
    ].join('\n'),
    cautions: [
      '`launch release` makes the app PUBLIC and is hard to reverse. Run `launch release <platform> --dry-run`, show the plan, and get explicit human confirmation before the real submit.',
      '`rollout complete` accelerates a public rollout to 100% — confirm before running it.',
    ],
  },
  {
    id: 'launch-store-config',
    title: 'Store configuration as code',
    description:
      'Use when the developer wants to manage App Store Connect or Google Play configuration as code from launch.config.ts — in-app purchases, subscriptions, pricing, capabilities, listing metadata, promo offers, in-app events, A/B experiments, availability / territories, or custom product pages. Covers `launch sync`, `launch metadata`, `launch offers`, `launch play-products`, `launch play-subscriptions`, and more.',
    triggers: [
      'add or change an in-app purchase or subscription',
      'sync store config / capabilities to App Store Connect',
      'push or pull the store listing metadata',
      'set up Google Play products, subscriptions, or tracks',
      'generate promo offer codes, an in-app event, or an A/B experiment',
    ],
    steps: [
      {
        path: ['sync'],
        note: 'reconcile ASC IAPs, subscriptions, pricing, and capabilities from config — run with --dry-run first',
      },
      {
        path: ['metadata', 'pull'],
        note: 'pull the current listing into store.config.json to edit (--platform android for Play)',
      },
      {
        path: ['metadata', 'push'],
        note: 'push edited listing copy / screenshots back to the store — --dry-run rehearses',
      },
      { path: ['play-products'], note: 'reconcile Google Play in-app products from config' },
      {
        path: ['play-subscriptions'],
        note: 'reconcile Google Play subscriptions (base plans + offers)',
      },
    ],
    body: [
      'Store config lives in `launch.config.ts` (catalog) and `store.config.json` (listing). One catalog drives BOTH stores. Every reconcile runs plan → confirm → apply.',
      '',
      'The safe loop: preview with `--dry-run` (or `metadata pull`), review the plan, then apply. See the bundled command reference for the full surface across both stores.',
      '',
      'Preview the full cross-surface diff with `launch plan` and gate drift in CI with `launch drift` (see the launch-plan skill); draft listing copy with `launch ai listing` before pushing it (see the launch-ai-listing skill).',
    ].join('\n'),
    cautions: [
      'These commands change a LIVE store. Always preview with `--dry-run` (or `metadata pull`), show the plan, and get human confirmation before applying.',
      '`sync --allow-destructive` can remove a capability or product — treat it as requiring explicit human sign-off.',
    ],
    reference: {
      intro:
        'The full store-config surface, both stores. Each runs a read-only plan → confirm → apply; preview with `--dry-run` and never apply to a live or in-review listing without human confirmation.',
      commands: [
        {
          path: ['sync'],
          note: 'App Store Connect: reconcile IAPs, subscriptions, pricing, capabilities (--dry-run, --allow-destructive, --yes)',
        },
        {
          path: ['metadata', 'pull'],
          note: 'pull the store listing (copy, screenshots, previews) into store.config.json',
        },
        { path: ['metadata', 'push'], note: 'push the edited listing back to the store' },
        { path: ['offers', 'list'], note: 'list promotional offers for a subscription product' },
        {
          path: ['offers', 'generate-codes'],
          note: 'generate one-time promo / offer codes for a product',
        },
        { path: ['offers', 'deactivate'], note: 'deactivate an offer' },
        { path: ['play-products'], note: 'Google Play: reconcile in-app products' },
        {
          path: ['play-subscriptions'],
          note: 'Google Play: reconcile subscriptions (base plans + offers)',
        },
        { path: ['play-tracks', 'status'], note: 'show Google Play track state' },
        { path: ['play-tracks', 'promote'], note: 'promote a build between Play tracks' },
        { path: ['availability'], note: 'manage territory / country availability' },
        { path: ['custom-pages'], note: 'manage custom product pages' },
        { path: ['experiments'], note: 'manage product-page A/B experiments' },
        { path: ['events', 'list'], note: 'list in-app events' },
        { path: ['events', 'create'], note: 'create an in-app event' },
        { path: ['app-clips'], note: 'configure App Clips' },
        { path: ['game-center'], note: 'configure Game Center leaderboards / achievements' },
        { path: ['accessibility'], note: 'set the accessibility declarations on the listing' },
      ],
    },
  },
  {
    id: 'launch-ota',
    title: 'Over-the-air updates & rollback',
    description:
      'Use when the developer wants to publish an over-the-air JS / asset update to already-installed builds (Expo Updates protocol), inspect published updates, or roll back a bad update. Covers `launch update` and `launch updates`.',
    triggers: [
      'publish an OTA update / push a JS-only change without a rebuild',
      'ship a hotfix over the air',
      'list or inspect published updates',
      'roll back a bad update',
    ],
    steps: [
      {
        path: ['update'],
        note: 'publish a code-signed OTA update to the channel (--channel, --platform; --dry-run rehearses)',
      },
      { path: ['updates', 'list'], note: 'list published updates for a channel' },
      {
        path: ['updates', 'view'],
        args: ['latest'],
        note: "inspect an update by id (or 'latest')",
      },
      {
        path: ['updates', 'rollback'],
        note: 'reverse a bad update — promote a known-good one or drop clients to the embedded bundle',
      },
    ],
    body: [
      "OTA updates ship only JS and asset changes the installed runtime can accept (same runtime version), code-signed and hosted on the user's own bucket. **Native** changes (new dependencies, config plugins, permissions) need a full `build` + `release`, not an update.",
      '',
      '- `update --channel <name> --platform ios|android|all` publishes; `--dry-run` prints the layout without uploading. Avoid `--no-sign` (it lets anyone who can write the bucket push JS).',
      '- `updates rollback` is the escape hatch — it promotes a known-good update or drops clients back to the embedded bundle.',
    ].join('\n'),
    cautions: [
      'An OTA update reaches real users immediately. Rehearse with `--dry-run`, and confirm the channel and runtime version before publishing to a production channel.',
    ],
  },
  {
    id: 'launch-ci',
    title: 'CI on a hosted runner',
    description:
      'Use when the developer wants to build and ship this app from CI — scaffold a GitHub Actions workflow on a hosted macOS / Linux runner, or run Launch unattended and headless. Covers `launch ci init` and the non-interactive, env-var-driven command flow.',
    triggers: [
      'set up CI / GitHub Actions to build and ship the app',
      'build and ship from a hosted runner without a local Mac',
      'run Launch unattended / headless',
      'wire up the release pipeline secrets',
    ],
    steps: [
      {
        path: ['ci', 'init'],
        note: 'write .github/workflows/launch.yml for a hosted runner (--android adds an Android job)',
      },
      { path: ['doctor'], args: ['--yes'], note: 'non-interactive preflight inside the workflow' },
      {
        path: ['build'],
        args: ['ios', '--yes'],
        note: 'unattended build + upload to the testing track',
      },
    ],
    body: [
      '`ci init` writes a transparent, editable workflow (not a black-box action) wired to the same unattended commands Launch already supports.',
      '',
      '- It installs `launch-store` globally on the runner, triggers on `workflow_dispatch` and pushed `v*` tags, and reads credentials from repository secrets decoded at runtime: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_BASE64` (Android adds `PLAY_SERVICE_ACCOUNT_BASE64`, `ANDROID_KEYSTORE_BASE64`, and the key alias/passwords).',
      '- Pass `--yes` on the safe commands; Launch also auto-detects CI and degrades to non-interactive on its own.',
    ].join('\n'),
    cautions: [
      "Keep `launch release` (public production) OUT of an automatic CI trigger — put it behind a manual approval / protected environment so a push can't publish to the store unattended. CI should target the TESTING track by default.",
      'Supply credentials only via repository secrets decoded at runtime; never commit a `.p8`, keystore, or service-account JSON.',
    ],
  },
  {
    id: 'launch-doctor',
    title: 'Diagnose toolchain & build failures',
    description:
      "Use when a Launch build is failing, the toolchain looks broken, signing or credentials won't resolve, or the developer asks to fix their build environment. Covers `launch doctor --fix` (toolchain) and `launch diagnose` (native build-log analysis).",
    triggers: [
      'the build is failing or broken — fix it',
      'fix the toolchain / install missing build tools',
      'diagnose a native build error',
      "signing or credentials won't resolve",
    ],
    steps: [
      {
        path: ['doctor'],
        note: 'detect the iOS/Android toolchain and store-side blockers; --fix installs missing brew tools (--yes for CI)',
      },
      {
        path: ['diagnose'],
        note: 'analyze the most recent build log (or a given logfile) and explain the native failure',
      },
      {
        path: ['creds'],
        args: ['status'],
        note: 'show which Apple account and signing assets are active when signing fails',
      },
    ],
    body: [
      'Start with `doctor` to separate environment problems from build problems, then `diagnose` to read the actual native failure.',
      '',
      '- `doctor --fix` asks for consent, then installs missing iOS tools via Homebrew (`--yes` skips the prompt for CI/agents). `doctor --platform android` checks the Android toolchain.',
      '- `diagnose` reads the newest log under `~/.launch/logs` (or a path you pass) and explains the failure in plain English. A config footgun check also runs at the head of every `build`.',
      '- When signing is the problem, `creds status` shows the active account; `creds set-key` / `creds setup` fix a missing key or profile.',
    ].join('\n'),
    cautions: [
      "`doctor --fix` installs build tools via Homebrew. It's safe to run, but review what it proposes; pass `--yes` only in CI where unattended installs are intended.",
    ],
  },
  {
    id: 'launch-verify',
    title: 'Pre-submit readiness & verification',
    description:
      'Use when the developer wants to know whether the app would pass review right now — a pre-submit sweep, store-account readiness, in-app-purchase readiness, or a privacy / permissions reconcile. All read-only. Covers `launch audit`, `launch store doctor`, `launch iap doctor`, and `launch privacy scan`.',
    triggers: [
      'is the app ready to submit / would it get rejected?',
      'run a pre-submit readiness check',
      'verify the App Store / Play account and in-app purchases are set up',
      "check the privacy declarations against the app's permissions",
    ],
    steps: [
      {
        path: ['audit'],
        note: 'one-shot pre-submit sweep — would a submission be rejected right now? (read-only)',
      },
      {
        path: ['store', 'doctor'],
        note: 'store-account readiness: the Apple app record, Play onboarding & access (read-only)',
      },
      {
        path: ['iap', 'doctor'],
        note: 'in-app-purchase readiness: products & subscriptions exist and are submittable (read-only)',
      },
      {
        path: ['privacy', 'scan'],
        note: 'reconcile permissions / manifests against the privacy declarations; flags undeclared collection',
      },
    ],
    body: [
      'Run these before a `release` to catch rejections on your machine instead of in App Review. Every command here only reads — none of them changes the store.',
      '',
      '- `audit` is the headline sweep; the focused doctors (`store doctor`, `iap doctor`) and `privacy scan` drill into the specific area that fails.',
      '- Pair this with `launch plan` (see the launch-plan skill) to also diff your config-as-code against live state before submitting.',
    ].join('\n'),
  },
  {
    id: 'launch-plan',
    title: 'Store config as code: plan & drift',
    description:
      'Use when the developer wants to preview how `launch.config.ts` differs from the live App Store Connect / Google Play state, or fail CI when the store has drifted from config — the read-only half of store-config-as-code. Covers `launch plan [surface]` and `launch drift`.',
    triggers: [
      'preview the store config diff before syncing',
      'what would `launch sync` change?',
      'detect or gate configuration drift in CI',
      'check that the live store still matches launch.config.ts',
    ],
    steps: [
      {
        path: ['plan'],
        note: 'diff launch.config against live store state across every config-as-code surface (read-only)',
      },
      {
        path: ['drift'],
        note: 'fail when live state has drifted from config — `plan --check` for CI',
      },
    ],
    body: [
      '`plan` is the read-only preview behind `sync` / `metadata` / the Play reconcilers: it diffs config against live state across capabilities, IAPs, subscriptions, pricing, listing, and the rest of the config-as-code surfaces. `drift` is the same diff as a CI gate (exit non-zero on any difference).',
      '',
      '- `plan [surface]` narrows the diff to one surface; bare `plan` covers them all.',
      '- Use `drift` in CI to keep the store and `launch.config.ts` from silently diverging; apply changes with the launch-store-config skill once the plan looks right.',
    ].join('\n'),
  },
  {
    id: 'launch-snapshot',
    title: 'Snapshot & restore live store state',
    description:
      'Use when the developer wants to capture the live App Store Connect / Google Play state as a named baseline, compare baselines or live state, restore a listing back to a saved snapshot, or prune old snapshots. Covers `launch snapshot create`/`diff`/`restore`/`prune`.',
    triggers: [
      'snapshot the current store state before a risky change',
      'what changed in the store since the last snapshot?',
      'restore / roll back the store listing to a saved snapshot',
      'clean up old snapshots',
    ],
    steps: [
      {
        path: ['snapshot', 'create'],
        note: 'capture live App Store + Play state into a named snapshot',
      },
      {
        path: ['snapshot', 'diff'],
        args: ['<name>'],
        note: 'compare a saved snapshot against another snapshot or live state (default: live)',
      },
      {
        path: ['snapshot', 'restore'],
        args: ['<name>'],
        note: "restore a snapshot's App Store listing back to live — additive; previews unless --yes",
      },
      {
        path: ['snapshot', 'prune'],
        note: 'delete old user snapshots by --keep <n> and/or --older-than <days> (auto baselines untouched)',
      },
    ],
    body: [
      'Take a `snapshot create` before any risky reconcile so you have a labelled baseline, then `snapshot diff` to see exactly what moved. `restore` writes the saved App Store listing back to live (other surfaces are preview-only for now).',
      '',
      '- `snapshot diff <name>` defaults to comparing against live state; pass a second name to compare two saved snapshots.',
      '- `snapshot prune` requires at least one of `--keep`/`--older-than` and never touches the automatic pre-sync baselines.',
    ].join('\n'),
    cautions: [
      '`snapshot restore` changes a LIVE listing (additive, never destructive). It previews the plan by default — show that plan and get human confirmation before re-running with `--yes`.',
    ],
  },
  {
    id: 'launch-migrate',
    title: 'Migrate from EAS / fastlane, or adopt a live app',
    description:
      'Use when the developer is moving an existing project onto Launch — importing an EAS or fastlane setup into a `launch.config.ts`, onboarding an app that already ships, or validating the resulting config. Covers `launch migrate eas`/`fastlane`, `launch adopt`, and `launch config validate`.',
    triggers: [
      'migrate from Expo EAS / eas.json to Launch',
      'import an existing fastlane setup',
      'onboard an app that already ships on the store',
      'validate my launch.config.ts against the schema',
    ],
    steps: [
      {
        path: ['migrate', 'eas'],
        note: 'read eas.json/app.json and emit launch.config.ts, .env.example, store.config.json + a report',
      },
      {
        path: ['migrate', 'fastlane'],
        note: 'read fastlane config (Appfile/Fastfile/Matchfile…) and emit the same Launch config set + a report',
      },
      {
        path: ['adopt'],
        note: 'onboard an already-shipping app: import its live App Store Connect setup into config',
      },
      {
        path: ['config', 'validate'],
        note: 'validate the config against the schema, reporting each problem by field path',
      },
    ],
    body: [
      'Pick the migrator that matches the current setup: `migrate eas` for an Expo EAS project, `migrate fastlane` for a fastlane one, or `adopt` to pull a live App Store Connect setup into config. Each writes a `launch.config.ts` (plus `.env.example` and `store.config.json`) and a report of what it found.',
      '',
      '- Migration only writes local config files — it touches no store and provisions nothing.',
      '- Always finish with `config validate` to confirm the emitted config is schema-clean, then `launch plan` (see the launch-plan skill) to see how it compares to live state.',
    ].join('\n'),
  },
  {
    id: 'launch-insights',
    title: 'Ratings, reviews, sales & analytics insights',
    description:
      'Use when the developer wants to read store performance — aggregated rating & review trends, individual customer reviews, or Sales & Trends / finance / analytics reports. All read-only, over the same API key. Covers `launch insights`, `launch reports`, and `launch reviews list`.',
    triggers: [
      'how is the app rated / how are reviews trending?',
      'read the latest customer reviews',
      'download a sales or finance report',
      'pull App Store analytics',
    ],
    steps: [
      {
        path: ['insights'],
        note: 'aggregate rating & review trends across the App Store and Play (read-only)',
      },
      {
        path: ['reports', 'sales'],
        note: 'download a Sales & Trends report (gzipped TSV, or --json)',
      },
      {
        path: ['reviews', 'list'],
        note: "list an app's customer reviews, newest first (filter by rating/territory)",
      },
    ],
    body: [
      '`insights` is the aggregated cross-store view (ratings and review trends); drop to `reviews list` for the individual reviews and `reports` for the raw Sales & Trends / finance / analytics data.',
      '',
      '- Everything here only reads — safe to run unattended.',
      "- Reply to reviews with `launch reviews reply` (App Store) or `launch play-reviews reply` (Play) once you've read them.",
    ].join('\n'),
  },
  {
    id: 'launch-ai-listing',
    title: 'AI-drafted store listing copy',
    description:
      "Use when the developer wants AI to draft App Store / Google Play listing copy (name, subtitle, description, keywords, what's-new) into `store.config.json`, then review and ship it. Covers `launch ai listing`, previewing with `launch plan`, and `launch metadata push`.",
    triggers: [
      'draft / write the App Store or Play listing copy with AI',
      'generate store description and keywords',
      'improve the listing metadata',
      'fill in store.config.json copy automatically',
    ],
    steps: [
      {
        path: ['ai', 'listing'],
        note: 'draft App Store / Play listing copy with AI into store.config.json',
      },
      {
        path: ['plan'],
        note: 'review the drafted listing as a read-only diff against the live store',
      },
      {
        path: ['metadata', 'push'],
        note: 'upload store.config.json to the live listing (metadata only; no binary)',
      },
    ],
    body: [
      '`ai listing` writes drafted copy into `store.config.json` only — it changes nothing live. Treat the draft as a starting point: read it, edit it, then preview before pushing.',
      '',
      '- Preview with `launch plan` (see the launch-plan skill) so you see exactly what the listing change would do before it goes out.',
      '- `metadata push` is what actually updates the live listing — gate it behind a human review of the AI copy.',
    ].join('\n'),
    cautions: [
      'AI-drafted copy is a draft — review it for accuracy and brand voice before shipping. `metadata push` changes the LIVE store listing, so preview with `launch plan` and get confirmation first.',
    ],
  },
  {
    id: 'launch-agent-access',
    title: 'Expose Launch to AI agents & a local dashboard',
    description:
      'Use when the developer wants to drive Launch from AI tooling — wire the MCP server into an AI client, serve the read-only local dashboard, or scaffold the agent skills/rules into the repo. All local-only. Covers `launch mcp install`, `launch dashboard`, and `launch agents init`.',
    triggers: [
      'let Claude / Cursor drive Launch (set up MCP)',
      'open the local Launch dashboard',
      'scaffold the Launch agent skills / rules into this repo',
      'give an AI agent access to Launch',
    ],
    steps: [
      {
        path: ['mcp', 'install'],
        note: "wire `launch mcp` into an AI client's config (auto-detects Claude Code / Cursor)",
      },
      {
        path: ['dashboard'],
        note: 'serve a local, read-only web UI over apps, builds, accounts, and secrets',
      },
      {
        path: ['agents', 'init'],
        note: 'write Claude skills, Cursor rules, and the AGENTS.md Launch section into this repo',
      },
    ],
    body: [
      "These are the on-ramps for agent-driven and at-a-glance use, all strictly local: `mcp install` exposes Launch's commands to an AI client, `dashboard` opens a read-only web view of your state, and `agents init` drops these very skills into the repo.",
      '',
      '- `dashboard` is read-only and `mcp install` only edits a local client config — neither touches the store.',
      '- `agents check` keeps the scaffolded skills in sync after Launch upgrades.',
    ].join('\n'),
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
    file: 'launch',
    description: 'Always-on contributing context for the launch-store codebase.',
    globs: [],
    alwaysApply: true,
    body: [
      'You are working **on** launch-store (the `launch` CLI), not using it. The canonical working rules live in [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md) — read them first.',
      '',
      '- One Node ESM / TypeScript package. `src/cli` is thin commander wiring (no domain logic), `src/core` is the domain (types, the build→submit pipeline, the provider registry), `src/providers` are the swappable backends, `src/apple` is the App Store Connect integration.',
      '- Before calling a change done, run `npm run typecheck && npm run lint && npm run test && npm run build`, plus `npm run docs:check` (the generated docs + these rules are gated).',
      '- Keep it KISS / YAGNI / DRY: extend the nearest sibling file rather than inventing a new file, util, or abstraction. Add a test (`*.test.ts`) beside any new logic.',
      '- Never log, write, or commit secrets; `~/.launch` holds non-secret paths and ids only.',
    ].join('\n'),
  },
  {
    file: 'core-types',
    description: 'Editing the domain shapes or provider interfaces.',
    globs: ['src/core/types.ts', 'src/core/types/*.ts'],
    alwaysApply: false,
    body: [
      'The types module — the `src/core/types.ts` barrel plus the `src/core/types/*.ts` modules it re-exports (split by concern: `app`, `catalog`, `storeSurface`, `config`, `credentials`, `artifacts`, `providers`, `remote`, `vitals`) — is the single source of truth for every domain shape and the five provider interfaces (`BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` / `ComputeHost`).',
      '',
      '- Add or change a shape in the matching `src/core/types/*.ts` module, never inline in a feature file — a change ripples through every provider and the pipeline, so plan the edit before writing code. The barrel keeps `import type { … } from "../core/types.js"` working unchanged; don\'t add declarations to it.',
      '- One exception: the App Store Connect `*Resource` / `*Query` types live in `src/apple/ascClient.ts`, not here.',
    ].join('\n'),
  },
  {
    file: 'providers',
    description:
      'Adding or changing a provider backend (build / storage / credentials / submit / compute).',
    globs: ['src/providers/**'],
    alwaysApply: false,
    body: [
      'Adding a backend = implement one of the five interfaces from `src/core/types.ts` as a named object and register it in `src/providers/index.ts`.',
      '',
      '- The pipeline resolves a provider by its `name` (the value users put in `launch.config.ts`), so you **never** edit `src/core/pipeline.ts` to add a backend.',
      '- Lazy-load heavy / optional SDKs (AWS, the native keyring) through `requireOptional` in `src/core/optionalDep.ts`, so a missing package becomes an actionable install hint instead of a stack trace.',
    ].join('\n'),
  },
  {
    file: 'exec-secrets',
    description: 'Running child processes or handling credentials / secrets.',
    globs: [
      'src/core/exec.ts',
      'src/core/keychain.ts',
      'src/core/secretStore.ts',
      'src/core/buildSecrets.ts',
    ],
    alwaysApply: false,
    body: [
      'All child processes go through `src/core/exec.ts` — `run` streams output, `capture` collects stdout — both with `shell: false` and an explicit argv array. Never build a shell string or call `spawn` / `exec` directly.',
      '',
      "- Secrets (`.p8` / `.p12` / keystore / private keys) live in the OS keychain via the secret store; `~/.launch` holds non-secret paths and ids only. Don't log, write, or commit key material.",
    ].join('\n'),
  },
];

/**
 * Claude Skills for working ON launch-store — the task-recipe counterpart to {@link CONTRIBUTOR_RULES}
 * (which are Cursor's path-scoped rules). Each is a repeatable contributor workflow that today lives only
 * as `AGENTS.md` prose; rendered to `.claude/skills/<id>/SKILL.md` by `npm run docs:gen` and gated by
 * `docs:check`. The relative links resolve from a skill file's directory (`.claude/skills/<id>/`), so they
 * climb three levels to the repo root. Steps are guidance only — nothing here auto-executes.
 */
export const CONTRIBUTOR_SKILLS: ContributorSkill[] = [
  {
    id: 'run-the-gate',
    title: 'Run the validation gate',
    description:
      'Use when finishing or verifying a change to launch-store — run the full typecheck, lint, test, build, and docs gate that must be green before a change is done or a PR merges.',
    triggers: [
      "you finished a change and need to confirm it's green before calling it done",
      'CI failed and you want to reproduce the gate locally',
      'before opening or squash-merging a PR',
    ],
    steps: [
      '`npm run typecheck && npm run lint && npm run test && npm run build` — the four core gates (`lint` is Biome, which enforces formatting too).',
      '`npm run docs:check` — fails if the generated docs (`docs/commands.md`, `llms.txt`, `.cursor/rules/*`, `.claude/skills/*`, README badges) drifted from the CLI; run `npm run docs:gen` and commit the result if it does.',
    ],
    body: [
      'All gates must be green before a change is done. The husky pre-commit hook runs lint + format + typecheck but **not** the tests and **can** be bypassed, so run the full line yourself. Add a `*.test.ts` beside any new logic.',
      '',
      'See [AGENTS.md](../../../AGENTS.md) → “Before you call a change done”.',
    ].join('\n'),
  },
  {
    id: 'add-a-provider',
    title: 'Add a provider backend',
    description:
      'Use when adding or changing a build, storage, credentials, submit, or compute backend in launch-store — implement one of the five provider interfaces and register it, without touching the pipeline.',
    triggers: [
      'adding a new storage / build / submit / credentials / compute backend',
      "wiring a new SDK behind one of Launch's provider interfaces",
    ],
    steps: [
      'Pick one of the five interfaces in `src/core/types.ts`: `BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` / `ComputeHost`.',
      'Implement it as a named object in `src/providers/<kind>/<name>.ts`, setting `name` to the value users put in `launch.config.ts`.',
      'Register it in `src/providers/index.ts` (`registerBuiltins()`). The pipeline resolves a provider by its `name`, so you never edit `src/core/pipeline.ts` to add one.',
      'Lazy-load any heavy or optional SDK through `requireOptional` in `src/core/optionalDep.ts`, so a missing package becomes an actionable install hint instead of a stack trace.',
      'Add a `*.test.ts` beside the provider, then run the gate (see the `run-the-gate` skill).',
    ],
    body: [
      'Adding a backend never edits the pipeline — that is the whole point of the registry: implement the interface, register the name, done.',
      '',
      'See [AGENTS.md](../../../AGENTS.md) → “Adding a backend = implement an interface + register it” for the worked S3 example.',
    ].join('\n'),
    cautions: [
      'All child processes go through `src/core/exec.ts` (`run` / `capture`, `shell: false`, explicit argv) — never build a shell string or call `spawn` / `exec` directly.',
      "Secrets stay in the OS keychain; `~/.launch` holds non-secret paths and ids only. Don't log, write, or commit key material.",
    ],
  },
  {
    id: 'add-a-command',
    title: 'Add a launch CLI command',
    description:
      'Use when adding a new top-level `launch` command or subcommand — wire it as thin commander code and regenerate the docs the CLI surface drives.',
    triggers: [
      'adding a new `launch <command>` or subcommand',
      'a `docs:check` failure after changing the CLI surface',
    ],
    steps: [
      "Add the command as thin commander wiring in `src/cli/commands/` and register its `register*Command` in `src/cli/program.ts`'s `buildProgram()`. Keep domain logic in `src/core`, not the CLI layer.",
      'Run `npm run docs:gen` — it introspects `buildProgram()` and regenerates `docs/commands.md`, `llms.txt`, the README stats badges, and the committed `.cursor/rules` / `.claude/skills`.',
      'Commit the regenerated files; `npm run docs:check` (CI) fails if they drift.',
      'Add a `*.test.ts` beside the new logic, then run the gate.',
    ],
    body: [
      'The docs are generated from the live `buildProgram()` in `src/cli/program.ts`, so a new command surfaces in the reference automatically once you run `docs:gen` — never hand-edit the generated files.',
      '',
      'See [AGENTS.md](../../../AGENTS.md).',
    ].join('\n'),
  },
  {
    id: 'add-a-glossary-topic',
    title: 'Add a glossary topic',
    description:
      'Use when adding teaching text for a concept or step in launch-store — add it to the single glossary source that feeds both `launch explain` and the `--explain` step expansions.',
    triggers: [
      'adding a `launch explain` topic',
      'adding teaching text for a new concept, step, or store term',
    ],
    steps: [
      'Add the topic to `src/core/glossary.ts` — the single source for teaching text. It feeds both `launch explain` and the `--explain` step expansions; never duplicate the strings elsewhere.',
      'Bump the topic count in `src/core/glossary.test.ts` (`expect(topics.length).toBe(N)`) by the number of topics you added, and add a `toContain(...)` assertion per new topic.',
      'Run the gate.',
    ],
    body: [
      'The `toBe(N)` count is a known merge hotspot: if a concurrent PR also added a topic, the count collides. On rebase, **sum** both additions rather than taking one side, and keep both topics.',
      '',
      'See [AGENTS.md](../../../AGENTS.md).',
    ].join('\n'),
  },
];
