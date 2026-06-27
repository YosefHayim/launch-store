/**
 * Reconcile an app's **accessibility declarations** — the per-device-family answers behind Apple's 2025
 * "Accessibility Nutrition Labels" — from a declarative `accessibility.config.json`, using the App Store
 * Connect API key alone. Filling these in is repeatable, click-heavy App Store Connect work, surfaced at
 * submission time, that EAS doesn't touch at all.
 *
 * Per app, for each declared device family:
 * 1. **Create** a draft declaration when the family has none yet, with the declared support flags.
 * 2. **Update** an existing declaration when its flags differ from config. Each omitted flag means "the
 *    app does not support this feature", normalized to `false`, so the diff is deterministic.
 * 3. Optionally **publish** (`publish: true` in config): a freshly-created draft is published in a
 *    follow-up call (Apple's create always yields a draft); an existing one is published in the same
 *    PATCH as its update. With `publish` false (the default) changes are left as a draft to review.
 *
 * Mirrors {@link reconcileGameCenter `core/gameCenter.ts`}: a read-only PLAN pass builds idempotent
 * {@link PlannedAction}s, the command prints them, then an APPLY pass performs them, each action isolated
 * so one failure never aborts the rest. Additive on families — a declaration whose family isn't in config
 * is left untouched (re-run safe), and declarations are never deleted (a destructive App Store Connect
 * action left to the portal). Apple's `REPLACED` history is ignored; the editable `DRAFT` is preferred
 * over the live `PUBLISHED` declaration when both exist for a family.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  ACCESSIBILITY_SUPPORT_KEYS,
  DEVICE_FAMILIES,
  type AccessibilityDeclarationResource,
  type AccessibilitySupport,
  type DeviceFamily,
} from '../apple/ascClient.js';
import {
  appRecordMissing,
  plan,
  type PlannedAction,
  type ReconcileContext,
} from './asc/storeSync.js';
import { errorMessage } from './errorMessage.js';

/** One declared accessibility declaration: a device family plus the nine support flags it claims (all optional). */
export interface AccessibilityDeclarationConfig extends AccessibilitySupport {
  deviceFamily: DeviceFamily;
}

/** The full `accessibility.config.json` document. */
export interface AccessibilityConfig {
  /** Publish each declaration after writing (default false → leave it as a draft to review in App Store Connect). */
  publish?: boolean;
  /** One entry per device family the app declares accessibility support for; at least one required. */
  declarations: AccessibilityDeclarationConfig[];
}

/**
 * The exact slice of {@link AppStoreConnectClient} the accessibility reconciler depends on. Declared here
 * (rather than the concrete client) so the diff logic is unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscGameCenterApi} in `gameCenter.ts`.
 */
export interface AscAccessibilityApi {
  getAppId(bundleId: string): Promise<string | null>;
  listAccessibilityDeclarations(appId: string): Promise<AccessibilityDeclarationResource[]>;
  createAccessibilityDeclaration(
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Promise<AccessibilityDeclarationResource>;
  updateAccessibilityDeclaration(
    declarationId: string,
    changes: AccessibilitySupport & { publish?: boolean },
  ): Promise<void>;
}

/** Inputs to reconcile one app's accessibility declarations. */
export interface AccessibilityReconcileInput {
  /** The app's iOS bundle id — resolves the App Store Connect app record the declarations hang off. */
  bundleId: string;
  config: AccessibilityConfig;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** Whether two support maps agree on all nine flags (an absent flag reads as `false`). */
function supportEquals(a: AccessibilitySupport, b: AccessibilitySupport): boolean {
  return ACCESSIBILITY_SUPPORT_KEYS.every((key) => (a[key] ?? false) === (b[key] ?? false));
}

/** Expand a partial support map to all nine flags (omitted → false) — the deterministic payload Launch writes. */
function normalizeSupport(support: AccessibilitySupport): AccessibilitySupport {
  const full: AccessibilitySupport = {};
  for (const key of ACCESSIBILITY_SUPPORT_KEYS) full[key] = support[key] ?? false;
  return full;
}

/**
 * Index each device family to the declaration Launch should edit: the editable `DRAFT` when one exists,
 * otherwise the live `PUBLISHED` one. `REPLACED` history is dropped so a stale declaration never shadows
 * the current answers.
 */
function indexEditableByFamily(
  declarations: AccessibilityDeclarationResource[],
): Map<DeviceFamily, AccessibilityDeclarationResource> {
  const byFamily = new Map<DeviceFamily, AccessibilityDeclarationResource>();
  for (const declaration of declarations) {
    if (declaration.state === 'REPLACED') continue;
    const existing = byFamily.get(declaration.deviceFamily);
    if (!existing || (existing.state === 'PUBLISHED' && declaration.state === 'DRAFT')) {
      byFamily.set(declaration.deviceFamily, declaration);
    }
  }
  return byFamily;
}

/**
 * Reconcile one app's accessibility declarations. Throws only for a precondition the user must fix (no
 * App Store Connect app record); everything else is captured per-action so a single failure never aborts
 * the run.
 */
export async function reconcileAccessibility(
  api: AscAccessibilityApi,
  input: AccessibilityReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };
  const publish = input.config.publish === true;

  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw appRecordMissing(input.bundleId, 'accessibility');

  const byFamily = indexEditableByFamily(await api.listAccessibilityDeclarations(appId));

  for (const declared of input.config.declarations) {
    const desired = normalizeSupport(declared);
    const current = byFamily.get(declared.deviceFamily);
    if (current) await updateDeclaration(ctx, api, current, desired, publish);
    else await createDeclaration(ctx, api, appId, declared.deviceFamily, desired, publish);
  }
  return { bundleId: input.bundleId, actions: ctx.actions };
}

/** Create a draft declaration for a family with no declaration yet, then publish it when requested. */
async function createDeclaration(
  ctx: ReconcileContext,
  api: AscAccessibilityApi,
  appId: string,
  deviceFamily: DeviceFamily,
  desired: AccessibilitySupport,
  publish: boolean,
): Promise<void> {
  const create = plan(ctx, `create accessibility declaration (${deviceFamily})`);
  const publishAction = publish
    ? plan(ctx, `publish accessibility declaration (${deviceFamily})`)
    : null;
  if (ctx.dryRun) return;

  let created: AccessibilityDeclarationResource;
  try {
    created = await api.createAccessibilityDeclaration(appId, deviceFamily, desired);
    create.status = 'applied';
  } catch (error) {
    create.status = 'failed';
    create.error = errorMessage(error);
    if (publishAction) publishAction.status = 'skipped';
    return;
  }
  if (publishAction) {
    try {
      await api.updateAccessibilityDeclaration(created.id, { publish: true });
      publishAction.status = 'applied';
    } catch (error) {
      publishAction.status = 'failed';
      publishAction.error = errorMessage(error);
    }
  }
}

/** Update an existing declaration when its flags differ and/or it needs publishing; no-op when already in sync. */
async function updateDeclaration(
  ctx: ReconcileContext,
  api: AscAccessibilityApi,
  current: AccessibilityDeclarationResource,
  desired: AccessibilitySupport,
  publish: boolean,
): Promise<void> {
  const changed = !supportEquals(current.support, desired);
  // Publish when asked AND the change isn't already live: an edit must be re-published, and a standing
  // draft must be promoted. An unchanged, already-PUBLISHED declaration needs nothing.
  const shouldPublish = publish && (changed || current.state !== 'PUBLISHED');
  if (!changed && !shouldPublish) return;

  const action = plan(
    ctx,
    changed
      ? `update accessibility declaration (${current.deviceFamily})${shouldPublish ? ' + publish' : ''}`
      : `publish accessibility declaration (${current.deviceFamily})`,
  );
  if (ctx.dryRun) return;

  const changes: AccessibilitySupport & { publish?: boolean } = changed ? { ...desired } : {};
  if (shouldPublish) changes.publish = true;
  try {
    await api.updateAccessibilityDeclaration(current.id, changes);
    action.status = 'applied';
  } catch (error) {
    action.status = 'failed';
    action.error = errorMessage(error);
  }
}

/** Narrow an unknown value to a plain object, or null. Arrays are rejected so a malformed section fails loudly. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read an optional boolean field, throwing a located error when present but not a boolean. */
function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  where: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean')
    throw new Error(`accessibility.config.json: ${where}.${key} must be a boolean.`);
  return value;
}

/** Type guard: is the string one of Apple's device families? */
function isDeviceFamily(value: string): value is DeviceFamily {
  return (DEVICE_FAMILIES as readonly string[]).includes(value);
}

/** Parse one declaration entry, validating its device family and any support flags present. */
function parseDeclaration(raw: unknown, index: number): AccessibilityDeclarationConfig {
  const record = asRecord(raw);
  const where = `declarations[${index}]`;
  if (!record) throw new Error(`accessibility.config.json: ${where} must be an object.`);

  const deviceFamily = record['deviceFamily'];
  if (typeof deviceFamily !== 'string' || !isDeviceFamily(deviceFamily)) {
    throw new Error(
      `accessibility.config.json: ${where}.deviceFamily must be one of ${DEVICE_FAMILIES.join(', ')}.`,
    );
  }

  const config: AccessibilityDeclarationConfig = { deviceFamily };
  for (const key of ACCESSIBILITY_SUPPORT_KEYS) {
    const value = optionalBoolean(record, key, where);
    if (value !== undefined) config[key] = value;
  }
  return config;
}

/**
 * Parse and validate a raw `accessibility.config.json` value into a typed {@link AccessibilityConfig}.
 * Rejects a non-object document, an empty declaration list, and two entries for the same device family,
 * so a bad file fails loudly instead of silently reconciling nothing or racing itself.
 */
export function parseAccessibilityConfig(raw: unknown): AccessibilityConfig {
  const record = asRecord(raw);
  if (!record) throw new Error('accessibility.config.json must be a JSON object.');

  const rawDeclarations = record['declarations'];
  if (!Array.isArray(rawDeclarations)) {
    throw new Error('accessibility.config.json: "declarations" must be an array.');
  }
  if (rawDeclarations.length === 0) {
    throw new Error(
      'accessibility.config.json must declare at least one entry under "declarations".',
    );
  }
  const declarations = rawDeclarations.map(parseDeclaration);

  const seen = new Set<DeviceFamily>();
  for (const declaration of declarations) {
    if (seen.has(declaration.deviceFamily)) {
      throw new Error(
        `accessibility.config.json: duplicate declaration for device family ${declaration.deviceFamily}.`,
      );
    }
    seen.add(declaration.deviceFamily);
  }

  const config: AccessibilityConfig = { declarations };
  const publish = record['publish'];
  if (publish !== undefined) {
    if (typeof publish !== 'boolean')
      throw new Error('accessibility.config.json: "publish" must be a boolean.');
    config.publish = publish;
  }
  return config;
}

/** Read and parse an `accessibility.config.json` from disk. */
export function loadAccessibilityConfig(path: string): AccessibilityConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No accessibility config at ${path}. Create one (see \`launch accessibility --help\`) or pass --config.`,
    );
  }
  return parseAccessibilityConfig(JSON.parse(readFileSync(path, 'utf8')));
}

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export function summarizeAccessibility(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
}
