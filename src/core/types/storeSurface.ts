/**
 * Store-surface config sections folded in from their JSON sidecars (issue #101): release attributes,
 * Game Center, App Clips, EU distribution, Wallet, and the MCP capability set. Authored config surface,
 * so every shape is a zod schema (the SSOT — see
 * [ADR 0008](../../../docs/adr/0008-adopt-zod-config-ssot.md)) with its type inferred.
 *
 * Apple's closed enums (leaderboard formatter/sort/submission, App Clip action) are reused from their
 * runtime arrays in `apple/ascResources.ts` — a **value** import of that module, which is a runtime leaf
 * (its only core import is `import type`, erased at build), so there's no cycle and Apple's lists aren't
 * duplicated here. The age-rating value stays the open `string | boolean` Apple models.
 */

import { z } from 'zod';
import {
  APP_CLIP_ACTIONS,
  LEADERBOARD_FORMATTERS,
  LEADERBOARD_SORT_TYPES,
  LEADERBOARD_SUBMISSION_TYPES,
} from '../../apple/ascResources.js';

/**
 * How an approved iOS build reaches the public App Store — the App Store version's `releaseType`,
 * mirroring Apple's enum on the `appStoreVersions` resource. Read by `launch release`, overridable
 * per-run with `--manual` / `--scheduled`.
 * - `AFTER_APPROVAL`: go live automatically the moment Apple approves. Launch's default.
 * - `MANUAL`: hold after approval until you press release (`launch status` shows it's pending).
 * - `SCHEDULED`: go live at a fixed future instant, set via {@link ReleaseConfig.earliestReleaseDate}.
 */
const ReleaseTypeSchema = z.enum(['AFTER_APPROVAL', 'MANUAL', 'SCHEDULED']);
export type ReleaseType = z.infer<typeof ReleaseTypeSchema>;

/**
 * iOS public-release policy, declared under {@link LaunchConfig.release} — see {@link ReleaseConfigSchema}.
 * Every field is optional; an absent `release` block means "go live after approval, all at once".
 */
export const ReleaseConfigSchema = z
  .strictObject({
    releaseType: ReleaseTypeSchema.describe(
      'How an approved build reaches the store. Defaults to `AFTER_APPROVAL`. Overridable with `--manual`/`--scheduled`.',
    ).optional(),
    earliestReleaseDate: z
      .string()
      .describe(
        'ISO-8601 instant to go live at — only meaningful with `releaseType: "SCHEDULED"` (ignored otherwise). A `--scheduled <iso>` flag sets both this and the release type for one run.',
      )
      .optional(),
    phasedRelease: z
      .boolean()
      .describe(
        "Opt into Apple's 7-day phased release (a gradual percentage rollout) for an approved update. Defaults to `false` — an immediate 100% release. Overridable per-run with `--phased`, and steerable afterward with `launch rollout <pause|resume|complete>`. Ignored for a first version (Apple only phases updates).",
      )
      .optional(),
    usesNonExemptEncryption: z
      .boolean()
      .describe(
        "Whether the binary contains non-exempt encryption (Apple's export-compliance question). `false` — the common case for apps using only standard HTTPS/system crypto — lets Launch declare compliance over the API so the build clears `WAITING_FOR_EXPORT_COMPLIANCE` without a portal trip. Set `true` only if you ship proprietary/non-exempt encryption; Launch then stops and points you to the portal, since genuine non-exempt encryption requires documentation Apple's API can't accept. Defaults to `false`.",
      )
      .optional(),
    releaseNotes: z
      .union([z.string(), z.record(z.string(), z.string())])
      .describe(
        'Release notes ("What\'s New in This Version"), per App Store locale (e.g. `{ "en-US": "Bug fixes." }`) or a single string applied to {@link ReleaseConfig.primaryLocale}. When absent, Launch reuses the previous version\'s notes so a release never ships an empty "What\'s New". Apple stores these on the version\'s localization, not the version itself.',
      )
      .optional(),
    primaryLocale: z
      .string()
      .describe(
        'Primary App Store locale for a bare-string {@link ReleaseConfig.releaseNotes}. Defaults to `en-US`.',
      )
      .optional(),
  })
  .meta({
    id: 'ReleaseConfig',
    description:
      'iOS public-release policy, declared under {@link LaunchConfig.release}. These are the defaults `launch release` applies to the App Store version it submits; every field is optional, so an absent `release` block means "go live after approval, all at once" — the safe, common case. Android release policy is unaffected (it rides on the Play track + `--rollout`, see {@link AndroidReleaseOptions}). Scope: this drives an UPDATE to an already-configured app. A brand-new app\'s first submission still needs portal-only steps (screenshots, age rating, signed agreements) and the app record itself — which Apple has no API to create — so `launch release` detects that and prints a one-time checklist.',
  });
export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>;

/**
 * Transition notifications — the EAS-`webhook` parity hook, declared under {@link LaunchConfig.notify} —
 * see {@link NotifyConfigSchema}. Fires on build/submit finishing, review verdicts, and rollout state.
 */
export const NotifyConfigSchema = z
  .strictObject({
    webhookUrl: z
      .string()
      .describe(
        'Incoming-webhook URL posted a JSON body on each transition. The payload carries both `text` (Slack) and `content` (Discord) set to a human summary, plus the structured event fields, so a Slack or Discord webhook renders it directly and a custom endpoint can read the typed data.',
      )
      .optional(),
    command: z
      .string()
      .describe(
        'Shell command run on each transition with the event in its environment as `LAUNCH_*` vars (`LAUNCH_EVENT`, `LAUNCH_STATUS`, `LAUNCH_APP`, `LAUNCH_VERSION`; plus `LAUNCH_BUILD_NUMBER`, `LAUNCH_DESTINATION`, `LAUNCH_ERROR` on build/submit, or `LAUNCH_DETAIL` on review/rollout). Runs under `/bin/sh -c`, like a git hook.',
      )
      .optional(),
    events: z
      .array(z.enum(['build', 'submit', 'review', 'rollout']))
      .describe('Which transitions fire a notification. Absent = all.')
      .optional(),
  })
  .meta({
    id: 'NotifyConfig',
    description:
      "Transition notifications — the EAS-`webhook` parity hook, declared under {@link LaunchConfig.notify}. Fires on the milestones a dev waits on: a build/submit finishing, an App Store review reaching a verdict, and a phased rollout changing state. A local Mac build can run many minutes and Apple's verdict lands hours later; this pings on each transition. All fields are optional and independent: set a `webhookUrl`, a `command`, both, or (absent) get the silent default; restrict which transitions fire with `events`. Fired on success AND failure; never blocks or fails the run (best-effort).",
  });
export type NotifyConfig = z.infer<typeof NotifyConfigSchema>;

/** One declared Game Center achievement: Apple's create attributes plus its default-locale localization. */
const AchievementConfigSchema = z
  .strictObject({
    vendorIdentifier: z
      .string()
      .describe(
        "Developer-chosen stable id used to match config to Apple's record (never shown to players).",
      ),
    referenceName: z.string().describe('Internal name shown in App Store Connect.'),
    points: z
      .number()
      .describe('Points awarded (Apple caps the total across achievements at 1000).'),
    showBeforeEarned: z
      .boolean()
      .describe("Whether the achievement is visible to players before it's earned (default false).")
      .optional(),
    repeatable: z
      .boolean()
      .describe('Whether it can be earned more than once (default false).')
      .optional(),
    name: z.string().describe('Player-facing title in the localization.'),
    beforeEarnedDescription: z
      .string()
      .describe('Player-facing description shown before the achievement is earned.'),
    afterEarnedDescription: z
      .string()
      .describe("Player-facing description shown after it's earned."),
    locale: z.string().describe('Locale for the localization above (default `en-US`).').optional(),
  })
  .meta({
    id: 'AchievementConfig',
    description:
      "One declared Game Center achievement: Apple's create attributes plus its default-locale localization.",
  });
export type AchievementConfig = z.infer<typeof AchievementConfigSchema>;

/** One declared Game Center leaderboard: Apple's create attributes plus its default-locale localization name. */
const LeaderboardConfigSchema = z
  .strictObject({
    vendorIdentifier: z.string(),
    referenceName: z.string(),
    defaultFormatter: z
      .enum(LEADERBOARD_FORMATTERS)
      .describe('How scores are formatted (e.g. `INTEGER`, `ELAPSED_TIME_SECOND`).'),
    submissionType: z
      .enum(LEADERBOARD_SUBMISSION_TYPES)
      .describe("Whether the board keeps each player's best or most recent score."),
    scoreSortType: z
      .enum(LEADERBOARD_SORT_TYPES)
      .describe('Whether higher (`DESC`) or lower (`ASC`) scores rank first.'),
    name: z.string().describe('Player-facing title in the localization.'),
    locale: z.string().describe('Locale for the localization above (default `en-US`).').optional(),
  })
  .meta({
    id: 'LeaderboardConfig',
    description:
      "One declared Game Center leaderboard: Apple's create attributes plus its default-locale localization name.",
  });
export type LeaderboardConfig = z.infer<typeof LeaderboardConfigSchema>;

/**
 * An app's declared Game Center achievements and leaderboards — see {@link GameCenterConfigSchema}. The
 * `gamecenter.config.json` document, or one entry of {@link LaunchConfig.gameCenter}.
 */
export const GameCenterConfigSchema = z
  .strictObject({
    achievements: z.array(AchievementConfigSchema).optional(),
    leaderboards: z.array(LeaderboardConfigSchema).optional(),
  })
  .meta({
    id: 'GameCenterConfig',
    description:
      "An app's declared Game Center achievements and leaderboards — the `gamecenter.config.json` document, or one entry of {@link LaunchConfig.gameCenter} (keyed by iOS bundle id). Either list may be omitted. Reconciled additively by `launch game-center`.",
  });
export type GameCenterConfig = z.infer<typeof GameCenterConfigSchema>;

/** One locale of an App Clip card: the subtitle shown under the app name in that locale. */
const AppClipLocalizationConfigSchema = z.strictObject({ subtitle: z.string() }).meta({
  id: 'AppClipLocalizationConfig',
  description:
    'One locale of an App Clip card: the subtitle shown under the app name in that locale.',
});
export type AppClipLocalizationConfig = z.infer<typeof AppClipLocalizationConfigSchema>;

/**
 * One App Clip's declared card metadata — see {@link AppClipConfigSchema}. Both fields are optional and
 * reconciled independently.
 */
const AppClipConfigSchema = z
  .strictObject({
    action: z
      .enum(APP_CLIP_ACTIONS)
      .describe("The card's call-to-action button (`OPEN` / `VIEW` / `PLAY`).")
      .optional(),
    localizations: z
      .record(z.string(), AppClipLocalizationConfigSchema)
      .describe('Per-locale card subtitles, keyed by Apple locale (e.g. `en-US`).')
      .optional(),
  })
  .meta({
    id: 'AppClipConfig',
    description:
      "One App Clip's declared card metadata. Both fields are optional and reconciled independently, so a clip may declare just an `action`, just `localizations`, or both.",
  });
export type AppClipConfig = z.infer<typeof AppClipConfigSchema>;

/**
 * An app's declared App Clips — see {@link AppClipsConfigSchema}. The `appclips.config.json` document, or
 * one entry of {@link LaunchConfig.appClips}. Each clip is keyed by its own bundle id.
 */
export const AppClipsConfigSchema = z
  .strictObject({
    clips: z.record(z.string(), AppClipConfigSchema),
  })
  .meta({
    id: 'AppClipsConfig',
    description:
      "An app's declared App Clips — the `appclips.config.json` document, or one entry of {@link LaunchConfig.appClips} (keyed by the parent app's iOS bundle id). Each App Clip is keyed by its own bundle id (e.g. `com.acme.app.Clip`), which is how a config entry is matched to the clip the build produced. Reconciled by `launch app-clips`.",
  });
export type AppClipsConfig = z.infer<typeof AppClipsConfigSchema>;

/** One authorized EU distribution domain: the host plus a human-readable reference name. */
const EuDistributionDomainConfigSchema = z
  .strictObject({
    domain: z
      .string()
      .describe('The domain authorized to host distribution packages (e.g. `downloads.acme.com`).'),
    referenceName: z
      .string()
      .describe('A label shown in App Store Connect to identify the domain.'),
  })
  .meta({
    id: 'EuDistributionDomainConfig',
    description:
      'One authorized EU distribution domain: the host plus a human-readable reference name.',
  });
export type EuDistributionDomainConfig = z.infer<typeof EuDistributionDomainConfigSchema>;

/**
 * The team's EU alternative-distribution domains — see {@link EuDistributionConfigSchema}. The
 * `eu-distribution.config.json` document, or {@link LaunchConfig.euDistribution}.
 */
export const EuDistributionConfigSchema = z
  .strictObject({
    domains: z
      .array(EuDistributionDomainConfigSchema)
      .describe('Domains to authorize for EU alternative distribution.'),
  })
  .meta({
    id: 'EuDistributionConfig',
    description:
      "The team's EU alternative-distribution domains — the `eu-distribution.config.json` document, or {@link LaunchConfig.euDistribution}. Team-level (not per-app); reconciled by `launch eu-distribution`.",
  });
export type EuDistributionConfig = z.infer<typeof EuDistributionConfigSchema>;

/** One declared Apple identifier: the reverse-DNS id plus a human-readable name shown in the portal. */
const WalletIdConfigSchema = z
  .strictObject({
    identifier: z
      .string()
      .describe(
        'The identifier to register (e.g. `merchant.com.acme.app` or `pass.com.acme.coupon`).',
      ),
    name: z.string().describe('A label shown in App Store Connect / the developer portal.'),
  })
  .meta({
    id: 'WalletIdConfig',
    description:
      'One declared Apple identifier: the reverse-DNS id plus a human-readable name shown in the portal.',
  });
export type WalletIdConfig = z.infer<typeof WalletIdConfigSchema>;

/**
 * The team's Apple Pay merchant ids and Wallet pass type ids — see {@link WalletConfigSchema}. The
 * `wallet.config.json` document, or {@link LaunchConfig.wallet}.
 */
export const WalletConfigSchema = z
  .strictObject({
    merchantIds: z
      .array(WalletIdConfigSchema)
      .describe('Apple Pay merchant ids to register.')
      .optional(),
    passTypeIds: z
      .array(WalletIdConfigSchema)
      .describe('Wallet pass type ids to register.')
      .optional(),
  })
  .meta({
    id: 'WalletConfig',
    description:
      "The team's Apple Pay merchant ids and Wallet pass type ids — the `wallet.config.json` document, or {@link LaunchConfig.wallet}. Team-level; either family may be omitted. Registered by `launch wallet`.",
  });
export type WalletConfig = z.infer<typeof WalletConfigSchema>;

/** Declared primary/secondary App Store categories (`appCategories` ids such as `PRODUCTIVITY`). */
const ReleaseCategoriesSchema = z
  .strictObject({
    primary: z.string().optional(),
    secondary: z.string().optional(),
  })
  .meta({
    id: 'ReleaseCategories',
    description:
      'Declared primary/secondary App Store categories (`appCategories` ids such as `PRODUCTIVITY`).',
  });
export type ReleaseCategories = z.infer<typeof ReleaseCategoriesSchema>;

/** Declared base price: a customer price (e.g. `9.99`) in a base territory Apple equalizes from. */
const ReleasePricingSchema = z
  .strictObject({
    baseTerritory: z
      .string()
      .describe('Base territory to anchor the price on (default `USA`).')
      .optional(),
    customerPrice: z
      .number()
      .describe(
        "The customer-facing price in the base territory; must match one of Apple's price-ladder rungs.",
      ),
  })
  .meta({
    id: 'ReleasePricing',
    description:
      'Declared base price: a customer price (e.g. `9.99`) in a base territory Apple equalizes from.',
  });
export type ReleasePricing = z.infer<typeof ReleasePricingSchema>;

/**
 * Declared App Review details — see {@link ReviewDetailsConfigSchema}. Field names match Apple's
 * `appStoreReviewDetails` attributes verbatim; `demoAccountPassword` is never read back or logged.
 */
const ReviewDetailsConfigSchema = z
  .strictObject({
    contactFirstName: z.string().optional(),
    contactLastName: z.string().optional(),
    contactPhone: z.string().optional(),
    contactEmail: z.string().optional(),
    demoAccountRequired: z.boolean().optional(),
    demoAccountName: z.string().optional(),
    demoAccountPassword: z
      .string()
      .describe(
        'The reviewer demo-account password. Prefer an indirection over a plaintext literal so the secret needn\'t sit in a repo-committed config (per "secrets never touch the repo"): `env:VAR_NAME` reads it from the environment, `keychain:ACCOUNT` from the OS keychain — both resolved only at submit time, so a plan never reads or holds it. Any other value is used as a literal (backward compatible).',
      )
      .optional(),
    notes: z.string().optional(),
  })
  .meta({
    id: 'ReviewDetailsConfig',
    description:
      "Declared App Review details: the contact Apple reaches and the demo account its reviewer signs in with. Field names match Apple's `appStoreReviewDetails` attributes verbatim. `demoAccountPassword` is never read back from Apple or logged.",
  });
export type ReviewDetailsConfig = z.infer<typeof ReviewDetailsConfigSchema>;

/**
 * An app's declared App Store *release attributes* — see {@link ReleaseAttributesConfigSchema}. Age
 * rating, categories, base price, and App Review details. Every section is optional and reconciled
 * independently by `launch release-config`.
 */
export const ReleaseAttributesConfigSchema = z
  .strictObject({
    ageRating: z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .describe(
        "Age-rating answers as Apple's `name → value` map (enum strings or booleans); only changed keys are sent.",
      )
      .optional(),
    categories: ReleaseCategoriesSchema.optional(),
    pricing: ReleasePricingSchema.optional(),
    reviewDetails: ReviewDetailsConfigSchema.optional(),
  })
  .meta({
    id: 'ReleaseAttributesConfig',
    description:
      "An app's declared App Store *release attributes* — age rating, App Store categories, base price, and App Review details — the `release.config.json` document, or one entry of {@link LaunchConfig.releaseAttributes} (keyed by iOS bundle id). Every section is optional and reconciled independently by `launch release-config`, so a file may declare only the attribute(s) you manage as code (e.g. just `pricing`). Named to avoid colliding with {@link ReleaseConfig}, which is the distinct iOS *release policy* (when/how a version goes live).",
  });
export type ReleaseAttributesConfig = z.infer<typeof ReleaseAttributesConfigSchema>;

/**
 * Where the **sidecar-only** surfaces keep their `*.config.json` files when not at the default filename —
 * see {@link SurfaceConfigFilesSchema}. Lets `launch plan` / `launch drift` find a non-default sidecar.
 */
export const SurfaceConfigFilesSchema = z
  .strictObject({
    availability: z.string().optional(),
    accessibility: z.string().optional(),
    experiments: z.string().optional(),
    customPages: z.string().optional(),
  })
  .meta({
    id: 'SurfaceConfigFiles',
    description:
      'Where the sidecar-only surfaces keep their `*.config.json` desired-state files when not at the default filename. These surfaces have no typed field on {@link LaunchConfig}, so without this map a non-interactive caller — chiefly `launch plan` / `launch drift`, which has no per-surface `--config` flag — can only find a sidecar at its default name. Declaring a path here makes `plan` read the same file the command would (the existing `resolveSidecarConfig` consumes it). Each entry is optional; omit the whole map to use defaults (`availability.config.json`, `accessibility.config.json`, `experiments.config.json`, `custom-pages.config.json`).',
  });
export type SurfaceConfigFiles = z.infer<typeof SurfaceConfigFilesSchema>;

/**
 * The capability tiers a tool can require, in ascending order of blast radius — the gate behind
 * `launch mcp`. A tool is tagged with exactly one tier; the MCP server registers only the tools whose
 * tier the user enabled in {@link McpConfig.capabilities}.
 * - `read` — pure introspection (plan, audit, doctor): no store or filesystem writes. The safe default.
 * - `dryRun` — rehearses a mutation and reports what it *would* do, still writing nothing.
 * - `write` — reconciles live store state (e.g. `launch sync`): visible, reversible-with-effort changes.
 * - `dangerous` — destructive or hard-to-reverse (deletions, irreversible submissions); opt-in only.
 */
const McpCapabilitySchema = z.enum(['read', 'dryRun', 'write', 'dangerous']);
export type McpCapability = z.infer<typeof McpCapabilitySchema>;

/**
 * The `mcp` block of `launch.config.ts` — see {@link McpConfigSchema}. Absent means least privilege
 * (`read`-tier tools only).
 */
export const McpConfigSchema = z
  .strictObject({
    capabilities: z
      .array(McpCapabilitySchema)
      .describe(
        'Which capability tiers the MCP server may expose. Each enabled tier unlocks the tools tagged at that tier; omit (or `[]`) for `["read"]` — read-only. Listing a higher tier does not imply the lower ones, so `["read", "write"]` is the usual "let agents read everything and run reconciles" posture.',
      )
      .optional(),
  })
  .meta({
    id: 'McpConfig',
    description:
      "The `mcp` block of `launch.config.ts` — how `launch mcp` exposes Launch to AI agents. Absent means least privilege: the server offers only `read`-tier tools, so wiring up an agent can never mutate a store until the operator widens {@link McpConfig.capabilities} on purpose. Declared here (not inline in the command) so #173's generator emits it into the config schema and `launch config validate/docs` cover it for free.",
  });
export type McpConfig = z.infer<typeof McpConfigSchema>;
