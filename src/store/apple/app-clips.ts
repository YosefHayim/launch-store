import {
  APP_CLIP_ACTIONS,
  type AppClipActionValue,
  type AppClipDefaultExperienceResource,
  type AppClipLocalizationResource,
  type AppClipResource,
} from '../../types/apple-catalog.ts';
import type { PlannedAction, ReconcileReport } from '../../types/reconcile.ts';
import { appRecordMissing, plan, skip, type ReconcileContext } from '../shared/reconcile.ts';
import { errorMessage } from '../../services/platform/error-message.ts';
import type {
  AppClipConfig,
  AppClipLocalizationConfig,
  AppClipsConfig,
} from '../../types/store-surface.ts';
import { decodeStoreSurfaceConfig, loadStoreSurfaceConfig } from '../shared/surface-config.ts';
import { readPlainObject } from '../../services/platform/plain-object.ts';

const APP_CLIPS_DOCUMENT_NAME = 'appclips.config.json';

/**
 * The exact slice of App Store Connect the App Clips reconciler depends on. Declaring it here
 * keeps the diff logic unit-testable with a hand-rolled fake.
 */
export type AscAppClipsApi = {
  getAppId(bundleId: string): Promise<string | null>;
  findEditableAppStoreVersion(appId: string, platform: string): Promise<{ id: string } | null>;
  listAppClips(appId: string): Promise<AppClipResource[]>;
  listAppClipDefaultExperiences(appClipId: string): Promise<AppClipDefaultExperienceResource[]>;
  createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{ id: string }>;
  updateAppClipDefaultExperienceAction(
    experienceId: string,
    action: AppClipActionValue,
  ): Promise<void>;
  listAppClipDefaultExperienceLocalizations(
    experienceId: string,
  ): Promise<AppClipLocalizationResource[]>;
  createAppClipDefaultExperienceLocalization(
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Promise<void>;
  updateAppClipDefaultExperienceLocalization(
    localizationId: string,
    subtitle: string,
  ): Promise<void>;
};

/** Inputs to reconcile one app's App Clip cards. */
type AppClipsReconcileInput = {
  bundleId: string;
  config: AppClipsConfig;
  platform?: string;
  dryRun: boolean;
};

type EnsuredExperience = { id: string } | { planned: true } | { failed: true };

function isListedText<Literal extends string>(
  candidate: unknown,
  allowed: readonly Literal[],
): candidate is Literal {
  if (typeof candidate != 'string') {
    return false;
  }

  for (const allowedText of allowed) {
    const isMatch = allowedText == candidate;

    if (isMatch) {
      return true;
    }
  }

  return false;
}

function readSubtitle(entry: unknown): string {
  const entryObject = readPlainObject(entry);

  if (entryObject == null) {
    throw new Error(`${APP_CLIPS_DOCUMENT_NAME}: subtitle must be a string.`);
  }

  const subtitle = entryObject['subtitle'];
  const isText = typeof subtitle == 'string';

  if (isText == false) {
    throw new Error(`${APP_CLIPS_DOCUMENT_NAME}: subtitle must be a string.`);
  }

  return subtitle;
}

function readLocalizations(
  record: Record<string, unknown>,
): Record<string, AppClipLocalizationConfig> | null {
  const hasLocalizations = Object.hasOwn(record, 'localizations');

  if (hasLocalizations == false) {
    return null;
  }

  const localizationsField = record['localizations'];
  const localizationsFieldObject = readPlainObject(localizationsField);

  if (localizationsFieldObject == null) {
    throw new Error(`${APP_CLIPS_DOCUMENT_NAME}: localizations must be an object.`);
  }

  const localizations: Record<string, AppClipLocalizationConfig> = {};

  for (const locale of Object.keys(localizationsFieldObject)) {
    localizations[locale] = { subtitle: readSubtitle(localizationsFieldObject[locale]) };
  }

  return localizations;
}

function readClip(entry: unknown): AppClipConfig {
  const entryObject = readPlainObject(entry);

  if (entryObject == null) {
    throw new Error(`${APP_CLIPS_DOCUMENT_NAME}: clip entries must be JSON objects.`);
  }

  const clip: {
    action?: AppClipActionValue;
    localizations?: Record<string, AppClipLocalizationConfig>;
  } = {};
  const hasAction = Object.hasOwn(entryObject, 'action');

  if (hasAction) {
    const action = entryObject['action'];
    const isAction = isListedText(action, APP_CLIP_ACTIONS);

    if (isAction == false) {
      throw new Error(`${APP_CLIPS_DOCUMENT_NAME}: action must be one of OPEN / VIEW / PLAY.`);
    }

    clip.action = action;
  }

  const localizations = readLocalizations(entryObject);
  const hasLocalizations = localizations != null;

  if (hasLocalizations) {
    clip.localizations = localizations;
  }

  const declaresAction = clip.action != null;

  if (declaresAction) {
    return clip;
  }

  const declaresLocalizations = clip.localizations != null;

  if (declaresLocalizations) {
    return clip;
  }

  throw new Error(
    `${APP_CLIPS_DOCUMENT_NAME}: a clip declares nothing - set an action and/or localizations.`,
  );
}

function decodeAppClipsDocument(rawDocument: unknown): AppClipsConfig {
  const documentRecord = rawDocument as Record<string, unknown>;
  const clipsField = documentRecord['clips'];
  const clipsFieldObject = readPlainObject(clipsField);

  if (clipsFieldObject == null) {
    throw new Error(
      `${APP_CLIPS_DOCUMENT_NAME} must declare at least one App Clip under "clips" (keyed by clip bundle id).`,
    );
  }

  const clipBundleIds = Object.keys(clipsFieldObject);
  const hasClips = clipBundleIds.length > 0;

  if (hasClips == false) {
    throw new Error(
      `${APP_CLIPS_DOCUMENT_NAME} must declare at least one App Clip under "clips" (keyed by clip bundle id).`,
    );
  }

  const clips: Record<string, AppClipConfig> = {};

  for (const clipBundleId of clipBundleIds) {
    clips[clipBundleId] = readClip(clipsFieldObject[clipBundleId]);
  }

  return { clips };
}

function missingAppClipsMessage(configPath: string): string {
  return `No App Clips config at ${configPath}. Create one (see \`launch app-clips --help\`) or pass --config.`;
}

const appClipsConfigSpec = {
  documentName: APP_CLIPS_DOCUMENT_NAME,
  displayName: 'App Clips config',
  missingMessage: missingAppClipsMessage,
  decodeDocument: decodeAppClipsDocument,
};

function isReadyExperience(ensured: EnsuredExperience): ensured is { id: string } {
  return 'id' in ensured;
}

function isPlannedExperience(ensured: EnsuredExperience): ensured is { planned: true } {
  return 'planned' in ensured;
}

function matchesVersion(versionId: string, experience: AppClipDefaultExperienceResource): boolean {
  return experience.versionId == versionId;
}

function localizationByLocale(
  localization: AppClipLocalizationResource,
): [string, AppClipLocalizationResource] {
  return [localization.locale, localization];
}

function needsActionUpdate(
  existingAction: AppClipActionValue | undefined,
  declaredAction: AppClipActionValue | undefined,
): boolean {
  if (declaredAction == null) {
    return false;
  }

  return existingAction != declaredAction;
}

async function applyWrite(plannedAction: PlannedAction, write: () => Promise<void>): Promise<void> {
  try {
    await write();
    plannedAction.status = 'applied';
  } catch (writeFailure) {
    plannedAction.status = 'failed';
    plannedAction.error = errorMessage(writeFailure);
  }
}

/**
 * Ensure a clip has a default experience for the editable version, reconciling its action.
 */
async function ensureExperience(
  reconcileContext: ReconcileContext,
  api: AscAppClipsApi,
  clip: AppClipResource,
  clipBundleId: string,
  versionId: string,
  existing: AppClipDefaultExperienceResource | undefined,
  action: AppClipActionValue | undefined,
): Promise<EnsuredExperience> {
  const hasExperience = existing != null;

  if (hasExperience) {
    const currentActionText = existing.action;
    const isKnownAction = isListedText(currentActionText, APP_CLIP_ACTIONS);
    const currentAction = isKnownAction ? currentActionText : undefined;
    const shouldUpdateAction = needsActionUpdate(currentAction, action);

    if (shouldUpdateAction) {
      const declaredAction = action;
      const updateAction = plan(
        reconcileContext,
        `set ${clipBundleId} card action = ${declaredAction}`,
      );
      const isDryRun = reconcileContext.dryRun == true;

      if (isDryRun == false) {
        await applyWrite(updateAction, function updateCardAction() {
          return api.updateAppClipDefaultExperienceAction(
            existing.id,
            declaredAction as AppClipActionValue,
          );
        });
      }
    }

    return { id: existing.id };
  }

  let actionDetail = '';
  const hasAction = action != null;

  if (hasAction) {
    actionDetail = ` (action=${action})`;
  }

  const create: PlannedAction = {
    description: `create ${clipBundleId} App Clip default experience${actionDetail}`,
    destructive: false,
    status: 'planned',
  };
  reconcileContext.actions.push(create);
  const isDryRun = reconcileContext.dryRun == true;

  if (isDryRun) {
    return { planned: true };
  }

  try {
    const created = await api.createAppClipDefaultExperience(clip.id, versionId, action);
    create.status = 'applied';
    return { id: created.id };
  } catch (writeFailure) {
    create.status = 'failed';
    create.error = errorMessage(writeFailure);
    return { failed: true };
  }
}

/** Create missing card locales and update any whose subtitle differs. */
async function reconcileLocalizations(
  reconcileContext: ReconcileContext,
  api: AscAppClipsApi,
  experienceId: string,
  clipBundleId: string,
  declared: Record<string, AppClipLocalizationConfig>,
): Promise<void> {
  const localizations = await api.listAppClipDefaultExperienceLocalizations(experienceId);
  const existing = new Map(localizations.map(localizationByLocale));

  for (const [locale, localization] of Object.entries(declared)) {
    const current = existing.get(locale);
    const isMissing = current == null;

    if (isMissing) {
      const createAction = plan(reconcileContext, `set ${clipBundleId} card subtitle (${locale})`);
      const isDryRun = reconcileContext.dryRun == true;

      if (isDryRun == false) {
        await applyWrite(createAction, function createSubtitle() {
          return api.createAppClipDefaultExperienceLocalization(
            experienceId,
            locale,
            localization.subtitle,
          );
        });
      }

      continue;
    }

    const subtitleDiffers = current.subtitle != localization.subtitle;

    if (subtitleDiffers == false) {
      continue;
    }

    const updateAction = plan(reconcileContext, `update ${clipBundleId} card subtitle (${locale})`);
    const isDryRun = reconcileContext.dryRun == true;

    if (isDryRun) {
      continue;
    }

    await applyWrite(updateAction, function updateSubtitle() {
      return api.updateAppClipDefaultExperienceLocalization(current.id, localization.subtitle);
    });
  }
}

/** Reconcile one clip's default experience and its card localizations against the editable version. */
async function reconcileClip(
  reconcileContext: ReconcileContext,
  api: AscAppClipsApi,
  clip: AppClipResource,
  clipBundleId: string,
  versionId: string,
  declared: AppClipConfig,
): Promise<void> {
  const experiences = await api.listAppClipDefaultExperiences(clip.id);
  const existing = experiences.find(function matchesEditableVersion(experience) {
    return matchesVersion(versionId, experience);
  });
  const ensured = await ensureExperience(
    reconcileContext,
    api,
    clip,
    clipBundleId,
    versionId,
    existing,
    declared.action,
  );
  let declaredLocalizations: Record<string, AppClipLocalizationConfig> = {};
  const hasDeclaredLocalizations = declared.localizations != null;

  if (hasDeclaredLocalizations) {
    declaredLocalizations = declared.localizations;
  }

  if (isReadyExperience(ensured)) {
    await reconcileLocalizations(
      reconcileContext,
      api,
      ensured.id,
      clipBundleId,
      declaredLocalizations,
    );
    return;
  }

  if (isPlannedExperience(ensured)) {
    for (const locale of Object.keys(declaredLocalizations)) {
      reconcileContext.actions.push({
        description: `set ${clipBundleId} card subtitle (${locale})`,
        destructive: false,
        status: 'planned',
      });
    }

    return;
  }

  const hasLocalizations = Object.keys(declaredLocalizations).length > 0;

  if (hasLocalizations) {
    skip(
      reconcileContext,
      `App Clip ${clipBundleId}: skipped card subtitles - its default experience could not be created`,
    );
  }
}

/**
 * Reconcile one app's declared App Clip cards. Throws only for a precondition the user must fix (no ASC
 * app record); everything else is captured per-action so a single failure never aborts the run.
 */
export async function reconcileAppClips(
  api: AscAppClipsApi,
  reconcileInput: AppClipsReconcileInput,
): Promise<ReconcileReport> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun: reconcileInput.dryRun };
  const appId = await api.getAppId(reconcileInput.bundleId);
  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw appRecordMissing(reconcileInput.bundleId, 'app-clips');
  }

  const requestedPlatform = reconcileInput.platform;
  const hasPlatform = requestedPlatform != null;
  let platform = 'IOS';

  if (hasPlatform) {
    platform = requestedPlatform;
  }

  const editable = await api.findEditableAppStoreVersion(appId, platform);
  const hasEditableVersion = editable != null;

  if (hasEditableVersion == false) {
    skip(
      reconcileContext,
      'App Clips: no editable App Store version (create/select a version first)',
    );
    return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
  }

  const clips = await api.listAppClips(appId);
  const clipsByBundleId = new Map<string, AppClipResource>();

  for (const clip of clips) {
    const clipBundleId = clip.bundleId;
    const hasBundleId = clipBundleId != null;

    if (hasBundleId == false) {
      continue;
    }

    clipsByBundleId.set(clipBundleId, clip);
  }

  for (const [clipBundleId, declared] of Object.entries(reconcileInput.config.clips)) {
    const clip = clipsByBundleId.get(clipBundleId);
    const isClipMissing = clip == null;

    if (isClipMissing) {
      skip(
        reconcileContext,
        `App Clip ${clipBundleId}: no clip record yet - upload a build with this App Clip target first`,
      );
      continue;
    }

    await reconcileClip(reconcileContext, api, clip, clipBundleId, editable.id, declared);
  }

  return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
}

/** Decode an untrusted App Clips config document. */
export function parseAppClipsConfig(rawDocument: unknown): AppClipsConfig {
  return decodeStoreSurfaceConfig(rawDocument, appClipsConfigSpec);
}

/** Read and decode appclips.config.json. */
export function loadAppClipsConfig(configPath: string): Promise<AppClipsConfig> {
  return loadStoreSurfaceConfig(configPath, appClipsConfigSpec);
}
