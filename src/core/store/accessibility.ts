import { Effect, Schema } from 'effect';
import {
  ACCESSIBILITY_SUPPORT_KEYS,
  DEVICE_FAMILIES,
  type AccessibilityDeclarationResource,
  type AccessibilitySupport,
  type DeviceFamily,
} from '../types/appleCatalog.js';
import { appRecordMissing, plan, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { PlannedAction } from '../types/reconcile.js';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigFailure,
} from './surfaceConfig.js';

const AccessibilitySupportSchema = Schema.mutable(
  Schema.Struct({
    supportsAudioDescriptions: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsCaptions: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsDarkInterface: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsDifferentiateWithoutColorAlone: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsLargerText: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsReducedMotion: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsSufficientContrast: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsVoiceControl: Schema.optionalWith(Schema.Boolean, { exact: true }),
    supportsVoiceover: Schema.optionalWith(Schema.Boolean, { exact: true }),
  }),
);

const AccessibilityDeclarationConfigSchema = Schema.extend(
  AccessibilitySupportSchema,
  Schema.mutable(
    Schema.Struct({
      deviceFamily: Schema.Literal(...DEVICE_FAMILIES).annotations({
        message: () =>
          `accessibility.config.json: deviceFamily must be one of ${DEVICE_FAMILIES.join(', ')}.`,
      }),
    }),
  ),
);

export const AccessibilityConfigSchema = Schema.mutable(
  Schema.Struct({
    publish: Schema.optionalWith(
      Schema.Boolean.annotations({
        message: () => 'accessibility.config.json: "publish" must be a boolean.',
      }),
      { exact: true },
    ),
    declarations: Schema.mutable(Schema.Array(AccessibilityDeclarationConfigSchema)).pipe(
      Schema.minItems(1, {
        message: () =>
          'accessibility.config.json must declare at least one entry under "declarations".',
      }),
      Schema.filter((declaredAccessibility) => {
        const declaredFamilies = new Set<DeviceFamily>();
        for (const accessibilityDeclaration of declaredAccessibility) {
          if (declaredFamilies.has(accessibilityDeclaration.deviceFamily)) {
            return `accessibility.config.json: duplicate declaration for device family ${accessibilityDeclaration.deviceFamily}.`;
          }
          declaredFamilies.add(accessibilityDeclaration.deviceFamily);
        }
        return true;
      }),
    ),
  }),
);

const AccessibilityConfigSpec = {
  documentName: 'accessibility.config.json',
  displayName: 'accessibility config',
  missingMessage: (configPath: string) =>
    `No accessibility config at ${configPath}. Create one (see \`launch accessibility --help\`) or pass --config.`,
  schema: AccessibilityConfigSchema,
};

/** One device family's declared accessibility support. */
export type AccessibilityDeclarationConfig = AccessibilitySupport & {
  deviceFamily: DeviceFamily;
};
/** Accessibility declarations for one app. */
export type AccessibilityConfig = {
  publish?: boolean;
  declarations: AccessibilityDeclarationConfig[];
};
/**
 * The exact slice of {@link AppStoreConnectClient} the accessibility reconciler depends on. Declared here
 * (rather than the concrete client) so the diff logic is unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscGameCenterApi} in `gameCenter.ts`.
 */
export type AscAccessibilityApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  listAccessibilityDeclarations(
    appId: string,
  ): Effect.Effect<AccessibilityDeclarationResource[], unknown>;
  createAccessibilityDeclaration(
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Effect.Effect<AccessibilityDeclarationResource, unknown>;
  updateAccessibilityDeclaration(
    declarationId: string,
    changes: AccessibilitySupport & {
      publish?: boolean;
    },
  ): Effect.Effect<void, unknown>;
};
/** Inputs to reconcile one app's accessibility declarations. */
export type AccessibilityReconcileInput = {
  bundleId: string;
  config: AccessibilityConfig;
  dryRun: boolean;
};
/** Whether two support maps agree on all nine flags (an absent flag reads as `false`). */
const supportEquals = (
  declaredSupport: AccessibilitySupport,
  currentSupport: AccessibilitySupport,
): boolean => {
  return ACCESSIBILITY_SUPPORT_KEYS.every((key) => {
    const declaredFlag = declaredSupport[key] === true;
    const currentFlag = currentSupport[key] === true;
    return declaredFlag === currentFlag;
  });
};
/** Expand omitted accessibility flags to `false`. */
const normalizeSupport = (support: AccessibilitySupport): AccessibilitySupport => {
  const normalizedSupport: AccessibilitySupport = {};
  for (const key of ACCESSIBILITY_SUPPORT_KEYS) normalizedSupport[key] = support[key] === true;
  return normalizedSupport;
};
/**
 * Index each device family to the declaration Launch should edit: the editable `DRAFT` when one exists,
 * otherwise the live `PUBLISHED` one. `REPLACED` history is dropped so a stale declaration never shadows
 * the current answers.
 */
const indexEditableByFamily = (
  declarations: AccessibilityDeclarationResource[],
): Map<DeviceFamily, AccessibilityDeclarationResource> => {
  const byFamily = new Map<DeviceFamily, AccessibilityDeclarationResource>();
  for (const declaration of declarations) {
    if (declaration.state === 'REPLACED') continue;
    const existing = byFamily.get(declaration.deviceFamily);
    if (!existing) {
      byFamily.set(declaration.deviceFamily, declaration);
    } else if (existing.state === 'PUBLISHED' && declaration.state === 'DRAFT') {
      byFamily.set(declaration.deviceFamily, declaration);
    }
  }
  return byFamily;
};
/**
 * Reconcile one app's accessibility declarations. Throws only for a precondition the user must fix (no
 * App Store Connect app record); everything else is captured per-action so a single failure never aborts
 * the run.
 */
export const reconcileAccessibility = (
  api: AscAccessibilityApi,
  input: AccessibilityReconcileInput,
): Effect.Effect<{ bundleId: string; actions: PlannedAction[] }, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: input.dryRun };
    const publish = input.config.publish === true;
    const appId = yield* api.getAppId(input.bundleId);
    if (!appId) return yield* Effect.fail(appRecordMissing(input.bundleId, 'accessibility'));
    const declarations = yield* api.listAccessibilityDeclarations(appId);
    const byFamily = indexEditableByFamily(declarations);
    for (const declared of input.config.declarations) {
      const desired = normalizeSupport(declared);
      const current = byFamily.get(declared.deviceFamily);
      if (current) yield* updateDeclaration(reconcileContext, api, current, desired, publish);
      else
        yield* createDeclaration(
          reconcileContext,
          api,
          appId,
          declared.deviceFamily,
          desired,
          publish,
        );
    }
    return { bundleId: input.bundleId, actions: reconcileContext.actions };
  });
/** Create a draft declaration for a family with no declaration yet, then publish it when requested. */
const createDeclaration = (
  reconcileContext: ReconcileContext,
  api: AscAccessibilityApi,
  appId: string,
  deviceFamily: DeviceFamily,
  desired: AccessibilitySupport,
  publish: boolean,
): Effect.Effect<void> => {
  const create = plan(reconcileContext, `create accessibility declaration (${deviceFamily})`);
  let publishAction: PlannedAction | null = null;
  if (publish) {
    publishAction = plan(reconcileContext, `publish accessibility declaration (${deviceFamily})`);
  }
  if (reconcileContext.dryRun) return Effect.void;
  return Effect.gen(function* () {
    const created = yield* api.createAccessibilityDeclaration(appId, deviceFamily, desired).pipe(
      Effect.match({
        onFailure: (writeFailure) => {
          create.status = 'failed';
          create.error = errorMessage(writeFailure);
          if (publishAction) publishAction.status = 'skipped';
          return null;
        },
        onSuccess: (declaration) => {
          create.status = 'applied';
          return declaration;
        },
      }),
    );
    if (!created) return;
    if (publishAction) {
      yield* api.updateAccessibilityDeclaration(created.id, { publish: true }).pipe(
        Effect.match({
          onFailure: (writeFailure) => {
            publishAction.status = 'failed';
            publishAction.error = errorMessage(writeFailure);
          },
          onSuccess: () => {
            publishAction.status = 'applied';
          },
        }),
      );
    }
  });
};
/** Update an existing declaration when its flags differ and/or it needs publishing; no-op when already in sync. */
const updateDeclaration = (
  reconcileContext: ReconcileContext,
  api: AscAccessibilityApi,
  current: AccessibilityDeclarationResource,
  desired: AccessibilitySupport,
  publish: boolean,
): Effect.Effect<void> => {
  const changed = !supportEquals(current.support, desired);
  let shouldPublish = false;
  if (publish && changed) shouldPublish = true;
  if (publish && current.state !== 'PUBLISHED') shouldPublish = true;
  if (!changed && !shouldPublish) return Effect.void;
  let actionDescription = `publish accessibility declaration (${current.deviceFamily})`;
  if (changed) {
    actionDescription = `update accessibility declaration (${current.deviceFamily})`;
    if (shouldPublish) actionDescription = `${actionDescription} + publish`;
  }
  const action = plan(reconcileContext, actionDescription);
  if (reconcileContext.dryRun) return Effect.void;
  const changes: AccessibilitySupport & {
    publish?: boolean;
  } = {};
  if (changed) Object.assign(changes, desired);
  if (shouldPublish) changes.publish = true;
  return api.updateAccessibilityDeclaration(current.id, changes).pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        action.status = 'failed';
        action.error = errorMessage(writeFailure);
      },
      onSuccess: () => {
        action.status = 'applied';
      },
    }),
  );
};
/** Decode an untrusted accessibility config document. */
export const parseAccessibilityConfig = (
  rawDocument: unknown,
): Effect.Effect<AccessibilityConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, AccessibilityConfigSpec);

/** Read and decode accessibility.config.json through Effect Platform. */
export const loadAccessibilityConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, AccessibilityConfigSpec);
/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export const summarizeAccessibility = (
  actions: PlannedAction[],
): {
  applied: number;
  failed: number;
  skipped: number;
} => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
};
