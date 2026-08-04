import { Effect, Schema } from 'effect';
import {
  APP_CLIP_ACTIONS,
  type AppClipActionValue,
  type AppClipDefaultExperienceResource,
  type AppClipLocalizationResource,
  type AppClipResource,
} from '../types/appleCatalog.js';
import type { PlannedAction, ReconcileReport } from '../types/reconcile.js';
import { appRecordMissing, plan, skip, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type {
  AppClipConfig,
  AppClipLocalizationConfig,
  AppClipsConfig,
} from '../types/storeSurface.js';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigFailure,
} from './surfaceConfig.js';

const AppClipLocalizationSchema = Schema.mutable(
  Schema.Struct({
    subtitle: Schema.String.annotations({
      message: () => 'appclips.config.json: subtitle must be a string.',
    }),
  }),
);

const AppClipConfigSchema = Schema.mutable(
  Schema.Struct({
    action: Schema.optionalWith(
      Schema.Literal(...APP_CLIP_ACTIONS).annotations({
        message: () => 'appclips.config.json: action must be one of OPEN / VIEW / PLAY.',
      }),
      { exact: true },
    ),
    localizations: Schema.optionalWith(
      Schema.mutable(Schema.Record({ key: Schema.String, value: AppClipLocalizationSchema })),
      { exact: true },
    ),
  }),
).pipe(
  Schema.filter((appClipConfig) => {
    if (appClipConfig.action !== undefined) return true;
    if (appClipConfig.localizations !== undefined) return true;
    return 'appclips.config.json: a clip declares nothing - set an action and/or localizations.';
  }),
);

export const AppClipsConfigSchema = Schema.mutable(
  Schema.Struct({
    clips: Schema.mutable(Schema.Record({ key: Schema.String, value: AppClipConfigSchema })).pipe(
      Schema.filter((declaredClips) => {
        if (Object.keys(declaredClips).length > 0) return true;
        return 'appclips.config.json must declare at least one App Clip under "clips" (keyed by clip bundle id).';
      }),
    ),
  }),
);

const AppClipsConfigSpec = {
  documentName: 'appclips.config.json',
  displayName: 'App Clips config',
  missingMessage: (configPath: string) =>
    `No App Clips config at ${configPath}. Create one (see \`launch app-clips --help\`) or pass --config.`,
  schema: AppClipsConfigSchema,
};
/** Platform whose editable App Store version the default experience releases with. */
const DEFAULT_PLATFORM = 'IOS';
/**
 * The exact slice of {@link AppStoreConnectClient} the App Clips reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscReleaseApi} in `releaseAttrs.ts`.
 */
export type AscAppClipsApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  findEditableAppStoreVersion(
    appId: string,
    platform: string,
  ): Effect.Effect<
    {
      id: string;
    } | null,
    unknown
  >;
  listAppClips(appId: string): Effect.Effect<AppClipResource[], unknown>;
  listAppClipDefaultExperiences(
    appClipId: string,
  ): Effect.Effect<AppClipDefaultExperienceResource[], unknown>;
  createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Effect.Effect<
    {
      id: string;
    },
    unknown
  >;
  updateAppClipDefaultExperienceAction(
    experienceId: string,
    action: AppClipActionValue,
  ): Effect.Effect<void, unknown>;
  listAppClipDefaultExperienceLocalizations(
    experienceId: string,
  ): Effect.Effect<AppClipLocalizationResource[], unknown>;
  createAppClipDefaultExperienceLocalization(
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Effect.Effect<void, unknown>;
  updateAppClipDefaultExperienceLocalization(
    localizationId: string,
    subtitle: string,
  ): Effect.Effect<void, unknown>;
};
/** Inputs to reconcile one app's App Clip cards. */
export type AppClipsReconcileInput = {
  bundleId: string;
  config: AppClipsConfig;
  platform?: string;
  dryRun: boolean;
};
/**
 * The outcome of ensuring a clip's default experience exists for the editable version: an `id` (it
 * existed or was created and we can reconcile its localizations now), `planned` (a dry-run create - its
 * localizations are planned but not diffed), or `failed` (an apply-time create error - skip its rest).
 */
type EnsuredExperience =
  | {
      id: string;
    }
  | {
      planned: true;
    }
  | {
      failed: true;
    };
/**
 * Reconcile one app's declared App Clip cards. Throws only for a precondition the user must fix (no ASC
 * app record); everything else is captured per-action so a single failure never aborts the run. A clip
 * with no matching `appClip` (build not uploaded yet) or no editable version is skipped with a reason.
 */
export const reconcileAppClips = (
  api: AscAppClipsApi,
  input: AppClipsReconcileInput,
): Effect.Effect<ReconcileReport, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: input.dryRun };
    const appId = yield* api.getAppId(input.bundleId);
    if (!appId) return yield* Effect.fail(appRecordMissing(input.bundleId, 'app-clips'));
    let platform = DEFAULT_PLATFORM;
    if (input.platform !== undefined) platform = input.platform;
    const editable = yield* api.findEditableAppStoreVersion(appId, platform);
    if (!editable) {
      skip(
        reconcileContext,
        'App Clips: no editable App Store version (create/select a version first)',
      );
      return { bundleId: input.bundleId, actions: reconcileContext.actions };
    }
    const clips = yield* api.listAppClips(appId);
    const clipsByBundleId = new Map<string, AppClipResource>();
    for (const clip of clips) {
      if (clip.bundleId !== undefined) clipsByBundleId.set(clip.bundleId, clip);
    }
    for (const [clipBundleId, declared] of Object.entries(input.config.clips)) {
      const clip = clipsByBundleId.get(clipBundleId);
      if (!clip) {
        skip(
          reconcileContext,
          `App Clip ${clipBundleId}: no clip record yet - upload a build with this App Clip target first`,
        );
        continue;
      }
      yield* reconcileClip(reconcileContext, api, clip, clipBundleId, editable.id, declared);
    }
    return { bundleId: input.bundleId, actions: reconcileContext.actions };
  });
/** Reconcile one clip's default experience (action) and its card localizations against the editable version. */
const reconcileClip = (
  reconcileContext: ReconcileContext,
  api: AscAppClipsApi,
  clip: AppClipResource,
  clipBundleId: string,
  versionId: string,
  declared: AppClipConfig,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const experiences = yield* api.listAppClipDefaultExperiences(clip.id);
    const existing = experiences.find((experience) => experience.versionId === versionId);
    const ensured = yield* ensureExperience(
      reconcileContext,
      api,
      clip,
      clipBundleId,
      versionId,
      existing,
      declared.action,
    );
    let declaredLocalizations: Record<string, AppClipLocalizationConfig> = {};
    if (declared.localizations !== undefined) declaredLocalizations = declared.localizations;
    if ('id' in ensured) {
      yield* reconcileLocalizations(
        reconcileContext,
        api,
        ensured.id,
        clipBundleId,
        declaredLocalizations,
      );
    } else if ('planned' in ensured) {
      for (const locale of Object.keys(declaredLocalizations)) {
        reconcileContext.actions.push({
          description: `set ${clipBundleId} card subtitle (${locale})`,
          destructive: false,
          status: 'planned',
        });
      }
    } else if (Object.keys(declaredLocalizations).length > 0) {
      skip(
        reconcileContext,
        `App Clip ${clipBundleId}: skipped card subtitles - its default experience could not be created`,
      );
    }
  });
/**
 * Ensure a clip has a default experience for the editable version, reconciling its `action`. Returns an
 * {@link EnsuredExperience} so the caller knows whether localizations can be diffed (id), are only planned
 * (dry-run create), or must be skipped (apply-time create failure).
 */
const ensureExperience = (
  reconcileContext: ReconcileContext,
  api: AscAppClipsApi,
  clip: AppClipResource,
  clipBundleId: string,
  versionId: string,
  existing: AppClipDefaultExperienceResource | undefined,
  action: AppClipActionValue | undefined,
): Effect.Effect<EnsuredExperience, unknown> =>
  Effect.gen(function* () {
    if (existing) {
      if (action !== undefined && existing.action !== action) {
        const updateAction = plan(reconcileContext, `set ${clipBundleId} card action = ${action}`);
        if (!reconcileContext.dryRun) {
          yield* api.updateAppClipDefaultExperienceAction(existing.id, action).pipe(
            Effect.match({
              onFailure: (writeFailure) => {
                updateAction.status = 'failed';
                updateAction.error = errorMessage(writeFailure);
              },
              onSuccess: () => {
                updateAction.status = 'applied';
              },
            }),
          );
        }
      }
      return { id: existing.id };
    }
    let actionDetail = '';
    if (action !== undefined) actionDetail = ` (action=${action})`;
    const create: PlannedAction = {
      description: `create ${clipBundleId} App Clip default experience${actionDetail}`,
      destructive: false,
      status: 'planned',
    };
    reconcileContext.actions.push(create);
    if (reconcileContext.dryRun) return { planned: true };
    return yield* api.createAppClipDefaultExperience(clip.id, versionId, action).pipe(
      Effect.match({
        onFailure: (writeFailure): EnsuredExperience => {
          create.status = 'failed';
          create.error = errorMessage(writeFailure);
          return { failed: true };
        },
        onSuccess: (created): EnsuredExperience => {
          create.status = 'applied';
          return { id: created.id };
        },
      }),
    );
  });
/** Create missing card locales and update any whose subtitle differs (no action when already in sync). */
const reconcileLocalizations = (
  reconcileContext: ReconcileContext,
  api: AscAppClipsApi,
  experienceId: string,
  clipBundleId: string,
  declared: Record<string, AppClipLocalizationConfig>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const localizations = yield* api.listAppClipDefaultExperienceLocalizations(experienceId);
    const existing = new Map(localizations.map((loc) => [loc.locale, loc]));
    for (const [locale, localization] of Object.entries(declared)) {
      const current = existing.get(locale);
      if (!current) {
        const createAction = plan(
          reconcileContext,
          `set ${clipBundleId} card subtitle (${locale})`,
        );
        if (!reconcileContext.dryRun)
          yield* api
            .createAppClipDefaultExperienceLocalization(experienceId, locale, localization.subtitle)
            .pipe(
              Effect.match({
                onFailure: (writeFailure) => {
                  createAction.status = 'failed';
                  createAction.error = errorMessage(writeFailure);
                },
                onSuccess: () => {
                  createAction.status = 'applied';
                },
              }),
            );
      } else if (current.subtitle !== localization.subtitle) {
        const updateAction = plan(
          reconcileContext,
          `update ${clipBundleId} card subtitle (${locale})`,
        );
        if (!reconcileContext.dryRun)
          yield* api
            .updateAppClipDefaultExperienceLocalization(current.id, localization.subtitle)
            .pipe(
              Effect.match({
                onFailure: (writeFailure) => {
                  updateAction.status = 'failed';
                  updateAction.error = errorMessage(writeFailure);
                },
                onSuccess: () => {
                  updateAction.status = 'applied';
                },
              }),
            );
      }
    }
  });
/** Decode an untrusted App Clips config document. */
export const parseAppClipsConfig = (
  rawDocument: unknown,
): Effect.Effect<AppClipsConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, AppClipsConfigSpec);

/** Read and decode appclips.config.json through Effect Platform. */
export const loadAppClipsConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, AppClipsConfigSpec);
