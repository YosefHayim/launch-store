import type {
  BaseContext,
  ConsumerSkill,
  ContributorRule,
  ContributorSkill,
  SkillStep,
} from '../types/agents.js';

/** Join markdown paragraphs used as skill / rule bodies. */
const markdownBody = (sections: readonly string[]): string => sections.join('\n');

/** One validated recipe step: command path + note, optional positional args. */
const recipeStep = (path: string[], note: string, args?: string[]): SkillStep => {
  if (args === undefined) return { path, note };
  return { path, args, note };
};

/**
 * The always-on context every agent gets in a Launch repo. Derived from `AGENTS.md`, the README, and
 * `llms.txt` (kept faithful - no inflation). The {@link BaseContext.guardrail} encodes Launch's own
 * plan -> confirm -> apply ethos so an agent with `--yes` can't publish to production on its own.
 */
export const BASE_CONTEXT: BaseContext = {
  intro:
    'This repo ships with **Launch** - an open-source, self-hosted alternative to Expo EAS that builds, ' +
    "signs, and ships this Expo / React Native app to TestFlight and Google Play from the developer's own " +
    'machine, with their own keys, and no per-build bill. Everything is driven from one typed ' +
    '`launch.config.ts`. The pipeline mirrors EAS: prebuild -> resolve credentials -> compile & sign -> ' +
    'size-check -> store -> submit to the **testing** track (TestFlight / Play internal). `launch release` ' +
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
    '**Secrets stay in the OS keychain.** Never write, log, or commit a `.p8`, `.p12`, keystore, or private key, and never put a real secret in a committed `.env` - store build secrets with `npx launch secret set <NAME>` instead.',
    '**`launch.config.ts` is the source of truth** for store config. The reconcilers (`sync`, `metadata`) run a read-only plan -> confirm -> apply and never clobber a live or in-review version; preview any of them with `--dry-run`.',
    '**Learn as you go.** `npx launch <command> --explain` expands any step into plain English, and `npx launch demo` walks the whole pipeline as a zero-setup simulation.',
    "**iOS signing needs a Mac.** With no local Mac, build on a cloud Mac in the user's own AWS account, over SSH to any Mac, or hand off to EAS (`npx launch build ios --remote`). Android builds anywhere a JDK runs.",
    '**Non-interactive by design.** Pass `--yes` to run the safe, idempotent commands unattended; Launch already degrades to non-interactive when it detects CI, a pipe, or an agent.',
  ],
  guardrail: {
    free: [
      '**Setup & onboarding** - `init`, `adopt`, `migrate eas|fastlane`, and first-time `creds set-key` / `creds setup` (provisioning is idempotent).',
      '**Builds to the testing track** - `build ios|android` uploads to TestFlight / Play internal, not the public store.',
      '**Reads & rehearsals** - `status`, `doctor`, `diagnose`, `demo`, `sync --dry-run`, `metadata pull`, and any command with `--explain`.',
      '**Planning & readiness (read-only)** - `plan`, `drift`, `audit`, `store doctor`, `iap doctor`, `privacy scan`, `snapshot create|diff`, and `insights` only read live state.',
      "**Local-only tooling** - `dashboard` (a read-only local web UI over CLI state) and `mcp install` (expose Launch to local AI clients) run on the developer's machine, never touching the store.",
      '**Over-the-air updates** - `update` and `updates list|view` (and `updates rollback` to reverse a bad one).',
    ],
    confirm: [
      '**`launch release ios|android`** - submits to the PUBLIC production track and is hard to reverse. Run `--dry-run` first, show the plan, and let a human trigger the real submit.',
      '**`launch rollout complete`** and accelerating a phased rollout - it pushes a public release toward 100%.',
      '**Credential changes that switch or delete signing material** - `launch creds use|rename|remove`. (First-time `creds set-key` / `creds setup` during onboarding is fine.)',
      '**Applying a store reconcile to a live or in-review listing** - `launch sync` / `launch metadata push` without `--dry-run`, and especially `sync --allow-destructive`. Show the `--dry-run` plan and get confirmation before applying.',
    ],
  },
  bootstrap: [
    'Install Launch as a dev dependency: `npm install --save-dev launch-store` (or `--global` to put `launch` on the PATH).',
    'Verify the toolchain and config before building: `npx launch doctor` (add `--fix` to install missing iOS tools).',
    'The recipes below call `npx launch ...`, which resolves the locally-installed binary; with a global install you can drop the `npx`.',
  ],
};
/**
 * The fourteen task-scoped consumer skills, in pipeline order - the six core ship/release flows first,
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
      'Use when the developer wants to build, sign, and ship this Expo / React Native app to TestFlight or Google Play with Launch - first-time setup, provisioning signing credentials, producing a signed build, or uploading to the internal testing track. Covers `launch init`, `launch creds`, `launch doctor`, and `launch build`.',
    triggers: [
      'ship the app to TestFlight or Play internal testing',
      'build and upload a test build',
      'set up code signing / credentials for the app',
      'onboard an existing (already-shipping) app to Launch',
    ],
    steps: [
      recipeStep(['init'], 'scaffold launch.config.ts (+ .env.example); skip if it already exists'),
      recipeStep(
        ['adopt'],
        'OPTIONAL - app already on the store? import its live App Store Connect setup into config',
      ),
      recipeStep(['creds'], 'store the App Store Connect API key (.p8) in the OS keychain', [
        'set-key',
      ]),
      recipeStep(
        ['creds'],
        'register the app id and create or reuse the cert + provisioning profile',
        ['setup'],
      ),
      recipeStep(
        ['doctor'],
        'verify the iOS/Android toolchain and config; add --fix to install missing tools',
      ),
      recipeStep(
        ['build'],
        "run the full pipeline and upload to TestFlight (use 'android' for Play; --no-submit builds only)",
        ['ios'],
      ),
    ],
    body: markdownBody([
      'Run the steps in order. `init` writes the config, `creds` puts the signing material in the keychain, `doctor` catches toolchain and store-side blockers, and `build` produces a signed binary and uploads it to the **testing** track.',
      '',
      '- `build` flags worth knowing: `--profile <name>` selects a build profile, `--no-submit` builds without uploading, `--dry-run` rehearses every step, `--explain` teaches as it runs, and `--remote [aws|user@host]` builds iOS without a local Mac.',
      '- Manage testers after the upload with `launch testflight` (groups, add/remove testers, `testflight release` to push a build to a group). `launch builds` lists build history; `launch build:resign` re-signs a stored artifact without rebuilding.',
      '- Android: `build android` signs with the upload keystore and uploads to the Play track (`--track internal|closed|open|production`).',
    ]),
    cautions: [
      "`build` uploads to the TESTING track only - that's safe. Putting the app in front of the PUBLIC is `launch release` (see the launch-release skill), which needs human confirmation.",
      'First-time `creds setup` provisions real signing assets in the Apple Developer account - expected during onboarding. Switching or removing an account later (`creds use|remove`) needs human confirmation.',
    ],
  },
  {
    id: 'launch-release',
    title: 'Public release & phased rollout',
    description:
      'Use when the developer wants to submit an already-built version to the PUBLIC App Store or Google Play production track, check review status, or steer a phased rollout (pause / resume / complete). Covers `launch release`, `launch status`, and `launch rollout`. This is the irreversible, outward-facing step - confirm with a human before submitting.',
    triggers: [
      'release the app to the App Store / production / make it public',
      'submit for review or go live',
      'check review or rollout status',
      'pause, resume, or complete a phased rollout',
    ],
    steps: [
      recipeStep(
        ['status'],
        "show each app's store version, review state, and phased-rollout state (--json for CI)",
      ),
      recipeStep(
        ['release'],
        'submit the latest build to the PUBLIC production track - preview with --dry-run first',
        ['ios'],
      ),
      recipeStep(['rollout'], 'steer an iOS phased release: pause | resume | complete', ['pause']),
      recipeStep(
        ['release-train'],
        'coordinate iOS + Android + OTA as one resumable release record (start | status | release | abort)',
        ['start'],
      ),
    ],
    body: markdownBody([
      '`release` is the deliberate public step, distinct from `build` (which only reaches the testing track). Always preview first.',
      '',
      '- `release <platform> --dry-run` prints the release plan and touches nothing - run it, show the plan, then let a human trigger the real submit.',
      "- iOS options: `--phased` opts into Apple's 7-day phased rollout, `--build latest|<n>` promotes an existing build instead of uploading, `--manual` holds the approved build for manual release, `--scheduled <iso>` schedules go-live.",
      '- `status --watch` polls until review reaches a terminal verdict; `rollout pause|resume|complete` steers an in-progress phased release.',
      '- Shipping iOS + Android (and an OTA leg) together? `release-train start` records the whole release as one resumable unit - `--hold` gates every leg until all are approved and releases them together, `--platform`/`--no-ota` scope it, and `status`/`release`/`abort` drive or unwind it.',
    ]),
    cautions: [
      '`launch release` makes the app PUBLIC and is hard to reverse. Run `launch release <platform> --dry-run`, show the plan, and get explicit human confirmation before the real submit.',
      '`rollout complete` accelerates a public rollout to 100% - confirm before running it.',
    ],
  },
  {
    id: 'launch-store-config',
    title: 'Store configuration as code',
    description:
      'Use when the developer wants to manage App Store Connect or Google Play configuration as code from launch.config.ts - in-app purchases, subscriptions, pricing, capabilities, listing metadata, promo offers, in-app events, A/B experiments, availability / territories, or custom product pages. Covers `launch sync`, `launch metadata`, `launch offers`, `launch play-products`, `launch play-subscriptions`, and more.',
    triggers: [
      'add or change an in-app purchase or subscription',
      'sync store config / capabilities to App Store Connect',
      'push or pull the store listing metadata',
      'set up Google Play products, subscriptions, or tracks',
      'generate promo offer codes, an in-app event, or an A/B experiment',
    ],
    steps: [
      recipeStep(
        ['sync'],
        'reconcile ASC IAPs, subscriptions, pricing, and capabilities from config - run with --dry-run first',
      ),
      recipeStep(
        ['metadata', 'pull'],
        'pull the current listing into store.config.json to edit (--platform android for Play)',
      ),
      recipeStep(
        ['metadata', 'push'],
        'push edited listing copy / screenshots back to the store - --dry-run rehearses',
      ),
      recipeStep(['play-products'], 'reconcile Google Play in-app products from config'),
      recipeStep(
        ['play-subscriptions'],
        'reconcile Google Play subscriptions (base plans + offers)',
      ),
    ],
    body: markdownBody([
      'Store config lives in `launch.config.ts` (catalog) and `store.config.json` (listing). One catalog drives BOTH stores. Every reconcile runs plan -> confirm -> apply.',
      '',
      'The safe loop: preview with `--dry-run` (or `metadata pull`), review the plan, then apply. See the bundled command reference for the full surface across both stores.',
      '',
      'Preview the full cross-surface diff with `launch plan` and gate drift in CI with `launch drift` (see the launch-plan skill); draft listing copy with `launch ai listing` before pushing it (see the launch-ai-listing skill).',
    ]),
    cautions: [
      'These commands change a LIVE store. Always preview with `--dry-run` (or `metadata pull`), show the plan, and get human confirmation before applying.',
      '`sync --allow-destructive` can remove a capability or product - treat it as requiring explicit human sign-off.',
    ],
    reference: {
      intro:
        'The full store-config surface, both stores. Each runs a read-only plan -> confirm -> apply; preview with `--dry-run` and never apply to a live or in-review listing without human confirmation.',
      commands: [
        recipeStep(
          ['sync'],
          'App Store Connect: reconcile IAPs, subscriptions, pricing, capabilities (--dry-run, --allow-destructive, --yes)',
        ),
        recipeStep(
          ['metadata', 'pull'],
          'pull the store listing (copy, screenshots, previews) into store.config.json',
        ),
        recipeStep(['metadata', 'push'], 'push the edited listing back to the store'),
        recipeStep(['offers', 'list'], 'list promotional offers for a subscription product'),
        recipeStep(
          ['offers', 'generate-codes'],
          'generate one-time promo / offer codes for a product',
        ),
        recipeStep(['offers', 'deactivate'], 'deactivate an offer'),
        recipeStep(['play-products'], 'Google Play: reconcile in-app products'),
        recipeStep(
          ['play-subscriptions'],
          'Google Play: reconcile subscriptions (base plans + offers)',
        ),
        recipeStep(['play-tracks', 'status'], 'show Google Play track state'),
        recipeStep(['play-tracks', 'promote'], 'promote a build between Play tracks'),
        recipeStep(['availability'], 'manage territory / country availability'),
        recipeStep(['custom-pages'], 'manage custom product pages'),
        recipeStep(['experiments'], 'manage product-page A/B experiments'),
        recipeStep(['events', 'list'], 'list in-app events'),
        recipeStep(['events', 'create'], 'create an in-app event'),
        recipeStep(['app-clips'], 'configure App Clips'),
        recipeStep(['game-center'], 'configure Game Center leaderboards / achievements'),
        recipeStep(['accessibility'], 'set the accessibility declarations on the listing'),
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
      recipeStep(
        ['update'],
        'publish a code-signed OTA update to the channel (--channel, --platform; --dry-run rehearses)',
      ),
      recipeStep(['updates', 'list'], 'list published updates for a channel'),
      recipeStep(['updates', 'view'], "inspect an update by id (or 'latest')", ['latest']),
      recipeStep(
        ['updates', 'rollback'],
        'reverse a bad update - promote a known-good one or drop clients to the embedded bundle',
      ),
    ],
    body: markdownBody([
      "OTA updates ship only JS and asset changes the installed runtime can accept (same runtime version), code-signed and hosted on the user's own bucket. **Native** changes (new dependencies, config plugins, permissions) need a full `build` + `release`, not an update.",
      '',
      '- `update --channel <name> --platform ios|android|all` publishes; `--dry-run` prints the layout without uploading. Avoid `--no-sign` (it lets anyone who can write the bucket push JS).',
      '- `updates rollback` is the escape hatch - it promotes a known-good update or drops clients back to the embedded bundle.',
    ]),
    cautions: [
      'An OTA update reaches real users immediately. Rehearse with `--dry-run`, and confirm the channel and runtime version before publishing to a production channel.',
    ],
  },
  {
    id: 'launch-ci',
    title: 'CI on a hosted runner',
    description:
      'Use when the developer wants to build and ship this app from CI - scaffold a GitHub Actions workflow on a hosted macOS / Linux runner, or run Launch unattended and headless. Covers `launch ci init` and the non-interactive, env-var-driven command flow.',
    triggers: [
      'set up CI / GitHub Actions to build and ship the app',
      'build and ship from a hosted runner without a local Mac',
      'run Launch unattended / headless',
      'wire up the release pipeline secrets',
    ],
    steps: [
      recipeStep(
        ['ci', 'init'],
        'write .github/workflows/launch.yml for a hosted runner (--android adds an Android job)',
      ),
      recipeStep(['doctor'], 'non-interactive preflight inside the workflow', ['--yes']),
      recipeStep(['build'], 'unattended build + upload to the testing track', ['ios', '--yes']),
    ],
    body: markdownBody([
      '`ci init` writes a transparent, editable workflow (not a black-box action) wired to the same unattended commands Launch already supports.',
      '',
      '- It installs `launch-store` globally on the runner, triggers on `workflow_dispatch` and pushed `v*` tags, and reads credentials from repository secrets decoded at runtime: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY_BASE64` (Android adds `PLAY_SERVICE_ACCOUNT_BASE64`, `ANDROID_KEYSTORE_BASE64`, and the key alias/passwords).',
      '- Pass `--yes` on the safe commands; Launch also auto-detects CI and degrades to non-interactive on its own.',
    ]),
    cautions: [
      "Keep `launch release` (public production) OUT of an automatic CI trigger - put it behind a manual approval / protected environment so a push can't publish to the store unattended. CI should target the TESTING track by default.",
      'Supply credentials only via repository secrets decoded at runtime; never commit a `.p8`, keystore, or service-account JSON.',
    ],
  },
  {
    id: 'launch-doctor',
    title: 'Diagnose toolchain & build failures',
    description:
      "Use when a Launch build is failing, the toolchain looks broken, signing or credentials won't resolve, or the developer asks to fix their build environment. Covers `launch doctor --fix` (toolchain) and `launch diagnose` (native build-log analysis).",
    triggers: [
      'the build is failing or broken - fix it',
      'fix the toolchain / install missing build tools',
      'diagnose a native build error',
      "signing or credentials won't resolve",
    ],
    steps: [
      recipeStep(
        ['doctor'],
        'detect the iOS/Android toolchain and store-side blockers; --fix installs missing brew tools (--yes for CI)',
      ),
      recipeStep(
        ['diagnose'],
        'analyze the most recent build log (or a given logfile) and explain the native failure',
      ),
      recipeStep(
        ['creds'],
        'show which Apple account and signing assets are active when signing fails',
        ['status'],
      ),
    ],
    body: markdownBody([
      'Start with `doctor` to separate environment problems from build problems, then `diagnose` to read the actual native failure.',
      '',
      '- `doctor --fix` asks for consent, then installs missing iOS tools via Homebrew (`--yes` skips the prompt for CI/agents). `doctor --platform android` checks the Android toolchain.',
      '- `diagnose` reads the newest log under `~/.launch/logs` (or a path you pass) and explains the failure in plain English. A config footgun check also runs at the head of every `build`.',
      '- When signing is the problem, `creds status` shows the active account; `creds set-key` / `creds setup` fix a missing key or profile.',
    ]),
    cautions: [
      "`doctor --fix` installs build tools via Homebrew. It's safe to run, but review what it proposes; pass `--yes` only in CI where unattended installs are intended.",
    ],
  },
  {
    id: 'launch-verify',
    title: 'Pre-submit readiness & verification',
    description:
      'Use when the developer wants to know whether the app would pass review right now - a pre-submit sweep, store-account readiness, in-app-purchase readiness, or a privacy / permissions reconcile. All read-only. Covers `launch audit`, `launch store doctor`, `launch iap doctor`, and `launch privacy scan`.',
    triggers: [
      'is the app ready to submit / would it get rejected?',
      'run a pre-submit readiness check',
      'verify the App Store / Play account and in-app purchases are set up',
      "check the privacy declarations against the app's permissions",
    ],
    steps: [
      recipeStep(
        ['audit'],
        'one-shot pre-submit sweep - would a submission be rejected right now? (read-only)',
      ),
      recipeStep(
        ['store', 'doctor'],
        'store-account readiness: the Apple app record, Play onboarding & access (read-only)',
      ),
      recipeStep(
        ['iap', 'doctor'],
        'in-app-purchase readiness: products & subscriptions exist and are submittable (read-only)',
      ),
      recipeStep(
        ['privacy', 'scan'],
        'reconcile permissions / manifests against the privacy declarations; flags undeclared collection',
      ),
    ],
    body: markdownBody([
      'Run these before a `release` to catch rejections on your machine instead of in App Review. Every command here only reads - none of them changes the store.',
      '',
      '- `audit` is the headline sweep; the focused doctors (`store doctor`, `iap doctor`) and `privacy scan` drill into the specific area that fails.',
      '- Pair this with `launch plan` (see the launch-plan skill) to also diff your config-as-code against live state before submitting.',
    ]),
  },
  {
    id: 'launch-plan',
    title: 'Store config as code: plan & drift',
    description:
      'Use when the developer wants to preview how `launch.config.ts` differs from the live App Store Connect / Google Play state, or fail CI when the store has drifted from config - the read-only half of store-config-as-code. Covers `launch plan [surface]` and `launch drift`.',
    triggers: [
      'preview the store config diff before syncing',
      'what would `launch sync` change?',
      'detect or gate configuration drift in CI',
      'check that the live store still matches launch.config.ts',
    ],
    steps: [
      recipeStep(
        ['plan'],
        'diff launch.config against live store state across every config-as-code surface (read-only)',
      ),
      recipeStep(['drift'], 'fail when live state has drifted from config - `plan --check` for CI'),
    ],
    body: markdownBody([
      '`plan` is the read-only preview behind `sync` / `metadata` / the Play reconcilers: it diffs config against live state across capabilities, IAPs, subscriptions, pricing, listing, and the rest of the config-as-code surfaces. `drift` is the same diff as a CI gate (exit non-zero on any difference).',
      '',
      '- `plan [surface]` narrows the diff to one surface; bare `plan` covers them all.',
      '- Use `drift` in CI to keep the store and `launch.config.ts` from silently diverging; apply changes with the launch-store-config skill once the plan looks right.',
    ]),
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
      recipeStep(
        ['snapshot', 'create'],
        'capture live App Store + Play state into a named snapshot',
      ),
      recipeStep(
        ['snapshot', 'diff'],
        'compare a saved snapshot against another snapshot or live state (default: live)',
        ['<name>'],
      ),
      recipeStep(
        ['snapshot', 'restore'],
        "restore a snapshot's App Store listing back to live - additive; previews unless --yes",
        ['<name>'],
      ),
      recipeStep(
        ['snapshot', 'prune'],
        'delete old user snapshots by --keep <n> and/or --older-than <days> (auto baselines untouched)',
      ),
    ],
    body: markdownBody([
      'Take a `snapshot create` before any risky reconcile so you have a labelled baseline, then `snapshot diff` to see exactly what moved. `restore` writes the saved App Store listing back to live (other surfaces are preview-only for now).',
      '',
      '- `snapshot diff <name>` defaults to comparing against live state; pass a second name to compare two saved snapshots.',
      '- `snapshot prune` requires at least one of `--keep`/`--older-than` and never touches the automatic pre-sync baselines.',
    ]),
    cautions: [
      '`snapshot restore` changes a LIVE listing (additive, never destructive). It previews the plan by default - show that plan and get human confirmation before re-running with `--yes`.',
    ],
  },
  {
    id: 'launch-migrate',
    title: 'Migrate from EAS / fastlane, or adopt a live app',
    description:
      'Use when the developer is moving an existing project onto Launch - importing an EAS or fastlane setup into a `launch.config.ts`, onboarding an app that already ships, or validating the resulting config. Covers `launch migrate eas`/`fastlane`, `launch adopt`, and `launch config validate`.',
    triggers: [
      'migrate from Expo EAS / eas.json to Launch',
      'import an existing fastlane setup',
      'onboard an app that already ships on the store',
      'validate my launch.config.ts against the schema',
    ],
    steps: [
      recipeStep(
        ['migrate', 'eas'],
        'read eas.json/app.json and emit launch.config.ts, .env.example, store.config.json + a report',
      ),
      recipeStep(
        ['migrate', 'fastlane'],
        'read fastlane config (Appfile/Fastfile/Matchfile...) and emit the same Launch config set + a report',
      ),
      recipeStep(
        ['adopt'],
        'onboard an already-shipping app: import its live App Store Connect setup into config',
      ),
      recipeStep(
        ['config', 'validate'],
        'validate the config against the schema, reporting each problem by field path',
      ),
    ],
    body: markdownBody([
      'Pick the migrator that matches the current setup: `migrate eas` for an Expo EAS project, `migrate fastlane` for a fastlane one, or `adopt` to pull a live App Store Connect setup into config. Each writes a `launch.config.ts` (plus `.env.example` and `store.config.json`) and a report of what it found.',
      '',
      '- Migration only writes local config files - it touches no store and provisions nothing.',
      '- Always finish with `config validate` to confirm the emitted config is schema-clean, then `launch plan` (see the launch-plan skill) to see how it compares to live state.',
    ]),
  },
  {
    id: 'launch-insights',
    title: 'Ratings, reviews, sales & analytics insights',
    description:
      'Use when the developer wants to read store performance - aggregated rating & review trends, individual customer reviews, or Sales & Trends / finance / analytics reports. All read-only, over the same API key. Covers `launch insights`, `launch reports`, and `launch reviews list`.',
    triggers: [
      'how is the app rated / how are reviews trending?',
      'read the latest customer reviews',
      'download a sales or finance report',
      'pull App Store analytics',
    ],
    steps: [
      recipeStep(
        ['insights'],
        'aggregate rating & review trends across the App Store and Play (read-only)',
      ),
      recipeStep(['reports', 'sales'], 'download a Sales & Trends report (gzipped TSV, or --json)'),
      recipeStep(
        ['reviews', 'list'],
        "list an app's customer reviews, newest first (filter by rating/territory)",
      ),
    ],
    body: markdownBody([
      '`insights` is the aggregated cross-store view (ratings and review trends); drop to `reviews list` for the individual reviews and `reports` for the raw Sales & Trends / finance / analytics data.',
      '',
      '- Everything here only reads - safe to run unattended.',
      "- Reply to reviews with `launch reviews reply` (App Store) or `launch play-reviews reply` (Play) once you've read them.",
    ]),
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
      recipeStep(
        ['ai', 'listing'],
        'draft App Store / Play listing copy with AI into store.config.json',
      ),
      recipeStep(['plan'], 'review the drafted listing as a read-only diff against the live store'),
      recipeStep(
        ['metadata', 'push'],
        'upload store.config.json to the live listing (metadata only; no binary)',
      ),
    ],
    body: markdownBody([
      '`ai listing` writes drafted copy into `store.config.json` only - it changes nothing live. Treat the draft as a starting point: read it, edit it, then preview before pushing.',
      '',
      '- Preview with `launch plan` (see the launch-plan skill) so you see exactly what the listing change would do before it goes out.',
      '- `metadata push` is what actually updates the live listing - gate it behind a human review of the AI copy.',
    ]),
    cautions: [
      'AI-drafted copy is a draft - review it for accuracy and brand voice before shipping. `metadata push` changes the LIVE store listing, so preview with `launch plan` and get confirmation first.',
    ],
  },
  {
    id: 'launch-ai-screenshots',
    title: 'AI-generated store screenshots with Genshot',
    description:
      'Use when the developer wants polished App Store or Google Play screenshots generated from real app screens. Covers installing and authenticating the Genshot companion, `launch ai screenshots`, store-dimension validation, `launch plan screenshots`, and the guarded upload through `launch sync`.',
    triggers: [
      'generate polished App Store or Google Play screenshots',
      'turn real app screens into store marketing creatives',
      'create localized screenshots with captions',
      'prepare screenshots before syncing a store listing',
    ],
    steps: [
      recipeStep(
        ['ai', 'screenshots'],
        'generate and validate store-ready screenshots from real screens; use --platform ios|android and --brief to steer the design',
      ),
      recipeStep(
        ['plan'],
        'review the generated screenshot diff against the live store without writing',
        ['screenshots'],
      ),
      recipeStep(['sync'], 'upload the reviewed screenshots with the rest of the declared listing'),
    ],
    body: markdownBody([
      'Before generation, make sure the companion is available: `npm install --save-dev @genshot/cli`, then `npx genshot login`. Browser OAuth stores the Genshot credential in the user account config; never put an API key in `launch.config.ts`.',
      '',
      '- Put real source images under `<app>/screenshots/<locale>/<DISPLAY_TYPE>/`. Launch enhances those screens; it does not fabricate product UI.',
      '- `launch ai screenshots` delegates to Genshot, identifies Launch as the client source, validates every returned image against the selected store, and promotes approved files into the listing tree.',
      '- Use `--captions` for ordered marketing captions, `--locale` for localization, and `--device-types` only when overriding the supported default (`APP_IPHONE_67` for iOS or `phone` for Android).',
      '- Review with `launch plan screenshots`. Uploading remains the separate `launch sync` action and requires human confirmation.',
    ]),
    cautions: [
      'Genshot generation spends Credits. If the developer did not directly request generation, show the selected sources, platform, count, and brief and get approval before running it.',
      '`launch sync` changes the LIVE store listing. Show the read-only screenshot plan and get explicit human confirmation before uploading.',
    ],
  },
  {
    id: 'launch-agent-access',
    title: 'Expose Launch to AI agents & a local dashboard',
    description:
      'Use when the developer wants to drive Launch from AI tooling - wire the MCP server into an AI client, serve the read-only local dashboard, or scaffold the agent skills/rules into the repo. All local-only. Covers `launch mcp install`, `launch dashboard`, and `launch agents init`.',
    triggers: [
      'let Claude / Cursor drive Launch (set up MCP)',
      'open the local Launch dashboard',
      'scaffold the Launch agent skills / rules into this repo',
      'give an AI agent access to Launch',
    ],
    steps: [
      recipeStep(
        ['mcp', 'install'],
        "wire `launch mcp` into an AI client's config (auto-detects Claude Code / Cursor)",
      ),
      recipeStep(
        ['dashboard'],
        'serve a local, read-only web UI over apps, builds, accounts, and secrets',
      ),
      recipeStep(
        ['agents', 'init'],
        'write Claude skills, Cursor rules, and the AGENTS.md Launch section into this repo',
      ),
    ],
    body: markdownBody([
      "These are the on-ramps for agent-driven and at-a-glance use, all strictly local: `mcp install` exposes Launch's commands to an AI client, `dashboard` opens a read-only web view of your state, and `agents init` drops these very skills into the repo.",
      '',
      '- `dashboard` is read-only and `mcp install` only edits a local client config - neither touches the store.',
      '- `agents check` keeps the scaffolded skills in sync after Launch upgrades.',
    ]),
  },
];
/**
 * Contributor-facing Cursor rules for working ON the launch-store codebase. `AGENTS.md` stays the
 * canonical prose - these add PATH-triggered guidance Cursor attaches only when the relevant files are
 * open. The first entry is the always-on base rule that simply points Cursor at `AGENTS.md`; the rest
 * are glob-scoped. Emitted under `.cursor/rules/` by `pnpm docs:gen` and gated by `docs:check`.
 */
export const CONTRIBUTOR_RULES: ContributorRule[] = [
  {
    file: 'launch',
    description: 'Always-on contributing context for the launch-store codebase.',
    globs: [],
    alwaysApply: true,
    body: markdownBody([
      'You are working **on** launch-store (the `launch` CLI), not using it. The canonical working rules live in [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md) - read them first.',
      '',
      '- One Node ESM / TypeScript package. `src/cli` is thin Commander wiring, `src/core` is purpose-grouped domain code, `src/providers` are swappable backends, `src/apple` and `src/google` are store API mirrors, and `src/testkit` holds shared fakes/layers.',
      '- Do not create flat `src/core/*.ts` files. Put new core work under the owning purpose folder such as `build/`, `config/`, `credentials/`, `release/`, `store/`, `services/`, `terminal/`, or `types/`.',
      '- Before calling a change done, run `pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build` (the generated docs + these rules are gated).',
      '- Keep it KISS / YAGNI / DRY: extend the nearest sibling file rather than inventing a new file, util, or abstraction. Add a test (`*.test.ts`) beside any new logic.',
      '- Never log, write, or commit secrets; `~/.launch` holds non-secret paths and ids only.',
    ]),
  },
  {
    file: 'core-types',
    description: 'Editing the domain shapes or provider interfaces.',
    globs: ['src/core/types/*.ts'],
    alwaysApply: false,
    body: markdownBody([
      'The purpose-named modules under `src/core/types/` are the source of truth for domain shapes and the five provider interfaces (`BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` / `ComputeHost`).',
      '',
      '- Add or change a shape in its matching purpose-named module and import it directly. Do not create an internal barrel.',
      '- Normalized App Store resource/query shapes live in `src/core/types/appleCatalog.ts`; generated Apple wire types stay in `src/apple/generated/schema.ts`.',
      '- Google Play wire/resource DTOs currently live beside the transport in `src/google/playClient.ts` and `src/google/playReporting.ts`; move them into a resource module only as part of that API mirror cleanup.',
    ]),
  },
  {
    file: 'providers',
    description:
      'Adding or changing a provider backend (build / storage / credentials / submit / compute).',
    globs: ['src/providers/**'],
    alwaysApply: false,
    body: markdownBody([
      'Adding a backend = implement one of the five interfaces from `src/core/types/providers.ts` as a named object and register it in `src/providers/index.ts`, which wires into `src/core/services/registry.ts`.',
      '',
      '- The pipeline resolves a provider by its `name` (the value users put in `launch.config.ts`), so you **never** edit `src/core/build/pipeline.ts` to add a backend.',
      '- Lazy-load heavy / optional SDKs (AWS, the native keyring) through `requireOptional` in `src/core/services/optionalDep.ts`, so a missing package becomes an actionable install hint instead of a stack trace.',
    ]),
  },
  {
    file: 'exec-secrets',
    description: 'Running child processes or handling credentials / secrets.',
    globs: [
      'src/core/services/exec.ts',
      'src/core/credentials/keychain.ts',
      'src/core/credentials/secretStore.ts',
      'src/core/build/buildSecrets.ts',
    ],
    alwaysApply: false,
    body: markdownBody([
      'All child processes go through `src/core/services/exec.ts` - `run` streams output, `capture` collects stdout - both with `shell: false` and an explicit argv array. Never build a shell string or call `spawn` / `exec` directly.',
      '',
      "- Secrets (`.p8` / `.p12` / keystore / private keys) live in the OS keychain via the secret store; `~/.launch` holds non-secret paths and ids only. Don't log, write, or commit key material.",
    ]),
  },
];
/**
 * Claude Skills for working ON launch-store - the task-recipe counterpart to {@link CONTRIBUTOR_RULES}
 * (which are Cursor's path-scoped rules). Each is a repeatable contributor workflow that today lives only
 * as `AGENTS.md` prose; rendered to `.claude/skills/<id>/SKILL.md` by `pnpm docs:gen` and gated by
 * `docs:check`. The relative links resolve from a skill file's directory (`.claude/skills/<id>/`), so they
 * climb three levels to the repo root. Steps are guidance only - nothing here auto-executes.
 */
export const CONTRIBUTOR_SKILLS: ContributorSkill[] = [
  {
    id: 'run-the-gate',
    title: 'Run the validation gate',
    description:
      'Use when finishing or verifying a change to launch-store - run the full typecheck, lint, test, build, and docs gate that must be green before a change is done or a PR merges.',
    triggers: [
      "you finished a change and need to confirm it's green before calling it done",
      'CI failed and you want to reproduce the gate locally',
      'before opening or squash-merging a PR',
    ],
    steps: [
      '`pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build` - the six-part gate from `AGENTS.md` (`lint` is Biome, `lint:style` is Launch-specific, and `docs:check` guards generated docs).',
      'If `docs:check` fails, run `pnpm docs:gen` and commit the generated docs (`docs/commands.md`, `llms.txt`, `.cursor/rules/*`, `.claude/skills/*`, README badges, and config docs).',
    ],
    body: markdownBody([
      'All gates must be green before a change is done. The husky pre-commit hook runs lint + format + typecheck but **not** the tests and **can** be bypassed, so run the full line yourself. Add a `*.test.ts` beside any new logic.',
      '',
      'See [AGENTS.md](../../../AGENTS.md) -> “Before you call a change done”.',
    ]),
  },
  {
    id: 'add-a-provider',
    title: 'Add a provider backend',
    description:
      'Use when adding or changing a build, storage, credentials, submit, or compute backend in launch-store - implement one of the five provider interfaces and register it, without touching the pipeline.',
    triggers: [
      'adding a new storage / build / submit / credentials / compute backend',
      "wiring a new SDK behind one of Launch's provider interfaces",
    ],
    steps: [
      'Pick one of the five types in `src/core/types/providers.ts`: `BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` / `ComputeHost`.',
      'Implement it as a named object in `src/providers/<kind>/<name>.ts`, setting `name` to the value users put in `launch.config.ts`.',
      'Register it in `src/providers/index.ts` (`registerBuiltins()`), which wires into `src/core/services/registry.ts`. The pipeline resolves a provider by its `name`, so you never edit `src/core/build/pipeline.ts` to add one.',
      'Lazy-load any heavy or optional SDK through `requireOptional` in `src/core/services/optionalDep.ts`, so a missing package becomes an actionable install hint instead of a stack trace.',
      'Add a `*.test.ts` beside the provider, then run the gate (see the `run-the-gate` skill).',
    ],
    body: markdownBody([
      'Adding a backend never edits the pipeline - that is the whole point of the registry: implement the interface, register the name, done.',
      '',
      'See [AGENTS.md](../../../AGENTS.md) -> “Adding a backend = implement an interface + register it” for the worked S3 example.',
    ]),
    cautions: [
      'All child processes go through `src/core/services/exec.ts` (`run` / `capture`, `shell: false`, explicit argv) - never build a shell string or call `spawn` / `exec` directly.',
      "Secrets stay in the OS keychain; `~/.launch` holds non-secret paths and ids only. Don't log, write, or commit key material.",
    ],
  },
  {
    id: 'add-a-command',
    title: 'Add a launch CLI command',
    description:
      'Use when adding a new top-level `launch` command or subcommand - wire it as thin commander code and regenerate the docs the CLI surface drives.',
    triggers: [
      'adding a new `launch <command>` or subcommand',
      'a `docs:check` failure after changing the CLI surface',
    ],
    steps: [
      "Add the command as thin commander wiring in `src/cli/commands/` and register its `register*Command` in `src/cli/program.ts`'s `buildProgram()`. Keep domain logic in `src/core`, not the CLI layer.",
      'Run `pnpm docs:gen` - it introspects `buildProgram()` and regenerates `docs/commands.md`, `llms.txt`, the README stats badges, and the committed `.cursor/rules` / `.claude/skills`.',
      'Commit the regenerated files; `pnpm docs:check` (CI) fails if they drift.',
      'Add a `*.test.ts` beside the new logic, then run the gate.',
    ],
    body: markdownBody([
      'The docs are generated from the live `buildProgram()` in `src/cli/program.ts`, so a new command surfaces in the reference automatically once you run `docs:gen` - never hand-edit the generated files.',
      '',
      'See [AGENTS.md](../../../AGENTS.md).',
    ]),
  },
  {
    id: 'add-a-glossary-topic',
    title: 'Add a glossary topic',
    description:
      'Use when adding teaching text for a concept or step in launch-store - add it to the single glossary source that feeds both `launch explain` and the `--explain` step expansions.',
    triggers: [
      'adding a `launch explain` topic',
      'adding teaching text for a new concept, step, or store term',
    ],
    steps: [
      'Add the topic to `src/core/terminal/glossary.ts` - the single source for teaching text. It feeds both `launch explain` and the `--explain` step expansions; never duplicate the strings elsewhere.',
      'Bump the topic count in `src/core/terminal/glossary.test.ts` (`expect(topics.length).toBe(N)`) by the number of topics you added, and add a `toContain(...)` assertion per new topic.',
      'Run the gate.',
    ],
    body: markdownBody([
      'The `toBe(N)` count is a known merge hotspot: if a concurrent PR also added a topic, the count collides. On rebase, **sum** both additions rather than taking one side, and keep both topics.',
      '',
      'See [AGENTS.md](../../../AGENTS.md).',
    ]),
  },
];
