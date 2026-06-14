/**
 * Reconcile an app's **App Clip card metadata** — the default experience's call-to-action and the
 * per-locale card subtitle — from a declarative `appclips.config.json` to match App Store Connect.
 *
 * App Clips are the small, install-free slice of an app that launches from a link, NFC tag, or App Clip
 * Code. The clip *binary* comes from a build target (Apple has no API to create the `appClip` record, so
 * this is read-only — a clip the build hasn't produced yet is skipped with a pointer to fix that). What
 * IS API-automatable, and otherwise hand-clicked in App Store Connect on every release, is the **default
 * experience** backing the App Clip card: its action (`OPEN` / `VIEW` / `PLAY`) and the localized subtitle
 * shown under the app name. EAS automates none of this. (The App Clip card *image* is a separate asset
 * upload, deferred — see the command help.)
 *
 * Design mirrors {@link reconcileRelease `core/releaseAttrs.ts`} and {@link reconcileApp `core/ascSync.ts`}:
 * a read-only PLAN pass builds idempotent {@link PlannedAction}s (each clip re-reads live state and
 * proposes a change only when it differs), the command prints them, then an APPLY pass performs them,
 * each action isolated so one failing clip never aborts the rest. The default experience is scoped to the
 * **editable** App Store version (the one you're preparing), reusing
 * {@link AscAppClipsApi.findEditableAppStoreVersion}; with no editable version the clips are skipped with
 * a reason, exactly as release-attrs does for App Review details.
 */

import { existsSync, readFileSync } from "node:fs";
import type {
  AppClipActionValue,
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
} from "../apple/ascClient.js";
import { act, skip, type ReconcileContext } from "./asc/storeSync.js";
import type { PlannedAction, ReconcileReport } from "./ascSync.js";
import { asRecord } from "./json.js";

/** Platform whose editable App Store version the default experience releases with. */
const DEFAULT_PLATFORM = "IOS";
/** The valid App Clip card actions (Apple's `AppClipAction` enum) — used to validate parsed config. */
const APP_CLIP_ACTIONS: readonly AppClipActionValue[] = ["OPEN", "VIEW", "PLAY"];

/** One locale of an App Clip card: the subtitle shown under the app name in that locale. */
export interface AppClipLocalizationConfig {
  subtitle: string;
}

/**
 * One App Clip's declared card metadata. Both fields are optional and reconciled independently, so a clip
 * may declare just an `action`, just `localizations`, or both.
 */
export interface AppClipConfig {
  /** The card's call-to-action button (`OPEN` / `VIEW` / `PLAY`). */
  action?: AppClipActionValue;
  /** Per-locale card subtitles, keyed by Apple locale (e.g. `en-US`). */
  localizations?: Record<string, AppClipLocalizationConfig>;
}

/**
 * The full `appclips.config.json` document: each App Clip keyed by its **own** bundle id (e.g.
 * `com.acme.app.Clip`, not the parent app's), which is how a config entry is matched to the clip the
 * build produced.
 */
export interface AppClipsConfig {
  clips: Record<string, AppClipConfig>;
}

/**
 * The exact slice of {@link AppStoreConnectClient} the App Clips reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscReleaseApi} in `releaseAttrs.ts`.
 */
export interface AscAppClipsApi {
  getAppId(bundleId: string): Promise<string | null>;
  findEditableAppStoreVersion(appId: string, platform: string): Promise<{ id: string } | null>;
  listAppClips(appId: string): Promise<AppClipResource[]>;
  listAppClipDefaultExperiences(appClipId: string): Promise<AppClipDefaultExperienceResource[]>;
  createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{ id: string }>;
  updateAppClipDefaultExperienceAction(experienceId: string, action: AppClipActionValue): Promise<void>;
  listAppClipDefaultExperienceLocalizations(experienceId: string): Promise<AppClipLocalizationResource[]>;
  createAppClipDefaultExperienceLocalization(experienceId: string, locale: string, subtitle: string): Promise<void>;
  updateAppClipDefaultExperienceLocalization(localizationId: string, subtitle: string): Promise<void>;
}

/** Inputs to reconcile one app's App Clip cards. */
export interface AppClipsReconcileInput {
  /** The parent app's iOS bundle id — resolves the ASC app record and its clips. */
  bundleId: string;
  /** The declared App Clip cards, keyed by clip bundle id. */
  config: AppClipsConfig;
  /** Platform whose editable version owns the default experience (default `IOS`). */
  platform?: string;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** The actionable error when an app has no App Store Connect record (Apple has no API to create one). */
function appRecordMissing(bundleId: string): Error {
  return new Error(
    `No App Store Connect app record for ${bundleId}. Create the app once in App Store Connect ` +
      `(Apple has no API to create the app record), then re-run \`launch app-clips\`.`,
  );
}

/**
 * The outcome of ensuring a clip's default experience exists for the editable version: an `id` (it
 * existed or was created and we can reconcile its localizations now), `planned` (a dry-run create — its
 * localizations are planned but not diffed), or `failed` (an apply-time create error — skip its rest).
 */
type EnsuredExperience = { id: string } | { planned: true } | { failed: true };

/**
 * Reconcile one app's declared App Clip cards. Throws only for a precondition the user must fix (no ASC
 * app record); everything else is captured per-action so a single failure never aborts the run. A clip
 * with no matching `appClip` (build not uploaded yet) or no editable version is skipped with a reason.
 */
export async function reconcileAppClips(api: AscAppClipsApi, input: AppClipsReconcileInput): Promise<ReconcileReport> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };

  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw appRecordMissing(input.bundleId);

  const editable = await api.findEditableAppStoreVersion(appId, input.platform ?? DEFAULT_PLATFORM);
  if (!editable) {
    skip(ctx, "App Clips: no editable App Store version (create/select a version first)");
    return { bundleId: input.bundleId, actions: ctx.actions };
  }

  const clipsByBundleId = new Map(
    (await api.listAppClips(appId)).flatMap((clip) => (clip.bundleId ? [[clip.bundleId, clip] as const] : [])),
  );

  for (const [clipBundleId, declared] of Object.entries(input.config.clips)) {
    const clip = clipsByBundleId.get(clipBundleId);
    if (!clip) {
      skip(ctx, `App Clip ${clipBundleId}: no clip record yet — upload a build with this App Clip target first`);
      continue;
    }
    await reconcileClip(ctx, api, clip, clipBundleId, editable.id, declared);
  }

  return { bundleId: input.bundleId, actions: ctx.actions };
}

/** Reconcile one clip's default experience (action) and its card localizations against the editable version. */
async function reconcileClip(
  ctx: ReconcileContext,
  api: AscAppClipsApi,
  clip: AppClipResource,
  clipBundleId: string,
  versionId: string,
  declared: AppClipConfig,
): Promise<void> {
  const experiences = await api.listAppClipDefaultExperiences(clip.id);
  const existing = experiences.find((experience) => experience.versionId === versionId);
  const ensured = await ensureExperience(ctx, api, clip, clipBundleId, versionId, existing, declared.action);

  const localizations = declared.localizations ?? {};
  if ("id" in ensured) {
    await reconcileLocalizations(ctx, api, ensured.id, clipBundleId, localizations);
  } else if ("planned" in ensured) {
    // The experience is only planned (dry-run), so there's no id to diff against — show each declared
    // subtitle as a planned create so the plan is complete; the apply pass diffs them for real.
    for (const locale of Object.keys(localizations)) {
      ctx.actions.push({
        description: `set ${clipBundleId} card subtitle (${locale})`,
        destructive: false,
        status: "planned",
      });
    }
  } else if (Object.keys(localizations).length > 0) {
    skip(ctx, `App Clip ${clipBundleId}: skipped card subtitles — its default experience could not be created`);
  }
}

/**
 * Ensure a clip has a default experience for the editable version, reconciling its `action`. Returns an
 * {@link EnsuredExperience} so the caller knows whether localizations can be diffed (id), are only planned
 * (dry-run create), or must be skipped (apply-time create failure).
 */
async function ensureExperience(
  ctx: ReconcileContext,
  api: AscAppClipsApi,
  clip: AppClipResource,
  clipBundleId: string,
  versionId: string,
  existing: AppClipDefaultExperienceResource | undefined,
  action: AppClipActionValue | undefined,
): Promise<EnsuredExperience> {
  if (existing) {
    if (action && existing.action !== action) {
      await act(ctx, `set ${clipBundleId} card action = ${action}`, () =>
        api.updateAppClipDefaultExperienceAction(existing.id, action),
      );
    }
    return { id: existing.id };
  }

  const detail = action ? ` (action=${action})` : "";
  const create: PlannedAction = {
    description: `create ${clipBundleId} App Clip default experience${detail}`,
    destructive: false,
    status: "planned",
  };
  ctx.actions.push(create);
  if (ctx.dryRun) return { planned: true };
  try {
    const created = await api.createAppClipDefaultExperience(clip.id, versionId, action);
    create.status = "applied";
    return { id: created.id };
  } catch (error) {
    create.status = "failed";
    create.error = error instanceof Error ? error.message : String(error);
    return { failed: true };
  }
}

/** Create missing card locales and update any whose subtitle differs (no action when already in sync). */
async function reconcileLocalizations(
  ctx: ReconcileContext,
  api: AscAppClipsApi,
  experienceId: string,
  clipBundleId: string,
  declared: Record<string, AppClipLocalizationConfig>,
): Promise<void> {
  const existing = new Map(
    (await api.listAppClipDefaultExperienceLocalizations(experienceId)).map((loc) => [loc.locale, loc]),
  );
  for (const [locale, localization] of Object.entries(declared)) {
    const current = existing.get(locale);
    if (!current) {
      await act(ctx, `set ${clipBundleId} card subtitle (${locale})`, () =>
        api.createAppClipDefaultExperienceLocalization(experienceId, locale, localization.subtitle),
      );
    } else if (current.subtitle !== localization.subtitle) {
      await act(ctx, `update ${clipBundleId} card subtitle (${locale})`, () =>
        api.updateAppClipDefaultExperienceLocalization(current.id, localization.subtitle),
      );
    }
  }
}

/** Type guard: is the string one of Apple's three App Clip card actions? */
function isAppClipAction(value: string): value is AppClipActionValue {
  return (APP_CLIP_ACTIONS as readonly string[]).includes(value);
}

/** Parse one clip's `{ action?, localizations? }` block, validating the action enum and subtitle strings. */
function parseClip(clipBundleId: string, raw: Record<string, unknown>): AppClipConfig {
  const config: AppClipConfig = {};

  const action = raw["action"];
  if (action !== undefined) {
    if (typeof action !== "string" || !isAppClipAction(action)) {
      throw new Error(`appclips.config.json: clips["${clipBundleId}"].action must be one of OPEN / VIEW / PLAY.`);
    }
    config.action = action;
  }

  const localizationsRaw = asRecord(raw["localizations"]);
  if (localizationsRaw) {
    const localizations: Record<string, AppClipLocalizationConfig> = {};
    for (const [locale, value] of Object.entries(localizationsRaw)) {
      const localeRecord = asRecord(value);
      const subtitle = localeRecord?.["subtitle"];
      if (typeof subtitle !== "string") {
        throw new Error(
          `appclips.config.json: clips["${clipBundleId}"].localizations["${locale}"].subtitle must be a string.`,
        );
      }
      localizations[locale] = { subtitle };
    }
    config.localizations = localizations;
  }

  if (config.action === undefined && config.localizations === undefined) {
    throw new Error(
      `appclips.config.json: clips["${clipBundleId}"] declares nothing — set an action and/or localizations.`,
    );
  }
  return config;
}

/**
 * Parse and validate a raw `appclips.config.json` value into a typed {@link AppClipsConfig}. Rejects a
 * non-object document, a missing/empty `clips` map, and malformed clip entries, so a bad file fails
 * loudly instead of silently reconciling nothing.
 */
export function parseAppClipsConfig(raw: unknown): AppClipsConfig {
  const record = asRecord(raw);
  if (!record) throw new Error("appclips.config.json must be a JSON object.");

  const clipsRaw = asRecord(record["clips"]);
  if (!clipsRaw || Object.keys(clipsRaw).length === 0) {
    throw new Error('appclips.config.json must declare at least one App Clip under "clips" (keyed by clip bundle id).');
  }

  const clips: Record<string, AppClipConfig> = {};
  for (const [clipBundleId, value] of Object.entries(clipsRaw)) {
    const clipRecord = asRecord(value);
    if (!clipRecord) throw new Error(`appclips.config.json: clips["${clipBundleId}"] must be an object.`);
    clips[clipBundleId] = parseClip(clipBundleId, clipRecord);
  }
  return { clips };
}

/** Read and parse an `appclips.config.json` from disk. */
export function loadAppClipsConfig(path: string): AppClipsConfig {
  if (!existsSync(path)) {
    throw new Error(`No App Clips config at ${path}. Create one (see \`launch app-clips --help\`) or pass --config.`);
  }
  return parseAppClipsConfig(JSON.parse(readFileSync(path, "utf8")));
}
