// Reconciles declared accessibility support with App Store Connect.

import {
  ACCESSIBILITY_SUPPORT_KEYS,
  type AccessibilityDeclarationResource,
  type AccessibilitySupport,
  type DeviceFamily,
} from '../types/apple/app-info.ts';
import { appRecordMissing, plan, type ReconcileContext } from '../store/shared/reconcile.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { decodeStoreSurfaceConfig } from '../store/shared/surface-config.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

/** The ordered list of DeviceFamily values, for validating config and iterating. */
const DEVICE_FAMILIES: readonly DeviceFamily[] = [
  'IPHONE',
  'IPAD',
  'APPLE_TV',
  'APPLE_WATCH',
  'MAC',
  'VISION',
];

const ACCESSIBILITY_DOCUMENT_NAME = 'launch.config.ts accessibility';

/** One device family's declared accessibility support. */
type AccessibilityDeclarationConfig = AccessibilitySupport & {
  deviceFamily: DeviceFamily;
};

/** Accessibility declarations for one app. */
export type AccessibilityConfig = {
  publish?: boolean;
  declarations: AccessibilityDeclarationConfig[];
};

/** The exact slice of App Store Connect the accessibility reconciler depends on. */
export type AscAccessibilityApi = {
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
};

/** Inputs to reconcile one app's accessibility declarations. */
type AccessibilityReconcileInput = {
  bundleId: string;
  config: AccessibilityConfig;
  dryRun: boolean;
};

function isDeviceFamily(candidate: unknown): candidate is DeviceFamily {
  if (typeof candidate != 'string') {
    return false;
  }

  for (const deviceFamily of DEVICE_FAMILIES) {
    const isMatch = deviceFamily == candidate;

    if (isMatch) {
      return true;
    }
  }

  return false;
}

function readSupportFlag(
  record: Record<string, unknown>,
  fieldName: keyof AccessibilitySupport,
): boolean | null {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return null;
  }

  const field = record[fieldName];
  const isFlag = typeof field == 'boolean';

  if (isFlag == false) {
    throw new Error(`${ACCESSIBILITY_DOCUMENT_NAME}: ${fieldName} must be a boolean.`);
  }

  return field;
}

function readDeclaration(entry: unknown): AccessibilityDeclarationConfig {
  const entryObject = readPlainObject(entry);

  if (entryObject == null) {
    throw new Error(`${ACCESSIBILITY_DOCUMENT_NAME}: declarations entries must be JSON objects.`);
  }

  const deviceFamily = entryObject['deviceFamily'];
  const isFamily = isDeviceFamily(deviceFamily);

  if (isFamily == false) {
    throw new Error(
      `${ACCESSIBILITY_DOCUMENT_NAME}: deviceFamily must be one of ${DEVICE_FAMILIES.join(', ')}.`,
    );
  }

  const declaration: MutableDeep<AccessibilityDeclarationConfig> = { deviceFamily };

  for (const supportKey of ACCESSIBILITY_SUPPORT_KEYS) {
    const supportFlag = readSupportFlag(entryObject, supportKey);

    const hasFlag = supportFlag != null;

    if (hasFlag) {
      declaration[supportKey] = supportFlag;
    }
  }

  return declaration;
}

function decodeAccessibilityDocument(rawDocument: unknown): AccessibilityConfig {
  const documentRecord = rawDocument as Record<string, unknown>;
  const hasDeclarations = Object.hasOwn(documentRecord, 'declarations');

  if (hasDeclarations == false) {
    throw new Error(
      `${ACCESSIBILITY_DOCUMENT_NAME} must declare at least one entry under "declarations".`,
    );
  }

  const declarationsField = documentRecord['declarations'];
  const isDeclarationList = Array.isArray(declarationsField);

  if (isDeclarationList == false) {
    throw new Error(`${ACCESSIBILITY_DOCUMENT_NAME}: declarations must be an array.`);
  }

  const isEmpty = declarationsField.length == 0;

  if (isEmpty) {
    throw new Error(
      `${ACCESSIBILITY_DOCUMENT_NAME} must declare at least one entry under "declarations".`,
    );
  }

  const declarations: AccessibilityDeclarationConfig[] = [];
  const declaredFamilies = new Set<DeviceFamily>();

  for (const entry of declarationsField) {
    const declaration = readDeclaration(entry);

    const isDuplicate = declaredFamilies.has(declaration.deviceFamily);

    if (isDuplicate) {
      throw new Error(
        `${ACCESSIBILITY_DOCUMENT_NAME}: duplicate declaration for device family ${declaration.deviceFamily}.`,
      );
    }

    declaredFamilies.add(declaration.deviceFamily);
    declarations.push(declaration);
  }

  const accessibilityConfig: AccessibilityConfig = { declarations };
  const hasPublish = Object.hasOwn(documentRecord, 'publish');

  if (hasPublish == false) {
    return accessibilityConfig;
  }

  const publish = documentRecord['publish'];
  const isPublishFlag = typeof publish == 'boolean';

  if (isPublishFlag == false) {
    throw new Error(`${ACCESSIBILITY_DOCUMENT_NAME}: "publish" must be a boolean.`);
  }

  accessibilityConfig.publish = publish;

  return accessibilityConfig;
}

const accessibilityConfigSpec = {
  documentName: ACCESSIBILITY_DOCUMENT_NAME,
  displayName: 'accessibility config',
  decodeDocument: decodeAccessibilityDocument,
};

function supportFlag(support: AccessibilitySupport, key: keyof AccessibilitySupport): boolean {
  return support[key] == true;
}

/** Whether two support maps agree on all nine flags (an absent flag reads as false). */
function supportEquals(
  declaredSupport: AccessibilitySupport,
  currentSupport: AccessibilitySupport,
): boolean {
  for (const key of ACCESSIBILITY_SUPPORT_KEYS) {
    const flagsMatch = supportFlag(declaredSupport, key) == supportFlag(currentSupport, key);

    if (flagsMatch == false) {
      return false;
    }
  }

  return true;
}

/** Expand omitted accessibility flags to false. */
function normalizeSupport(support: AccessibilitySupport): AccessibilitySupport {
  const normalizedSupport: MutableDeep<AccessibilitySupport> = {};

  for (const key of ACCESSIBILITY_SUPPORT_KEYS) {
    normalizedSupport[key] = support[key] == true;
  }

  return normalizedSupport;
}

/** Index each device family to the declaration Launch should edit */
function indexEditableByFamily(
  declarations: AccessibilityDeclarationResource[],
): Map<DeviceFamily, AccessibilityDeclarationResource> {
  const byFamily = new Map<DeviceFamily, AccessibilityDeclarationResource>();

  for (const declaration of declarations) {
    const isReplaced = declaration.state == 'REPLACED';

    if (isReplaced) {
      continue;
    }

    const existing = byFamily.get(declaration.deviceFamily);

    const isFirst = existing == null;

    if (isFirst) {
      byFamily.set(declaration.deviceFamily, declaration);
      continue;
    }

    const publishedCanBeReplaced = existing.state == 'PUBLISHED';

    if (publishedCanBeReplaced == false) {
      continue;
    }

    const incomingIsDraft = declaration.state == 'DRAFT';

    if (incomingIsDraft) {
      byFamily.set(declaration.deviceFamily, declaration);
    }
  }

  return byFamily;
}

function shouldPublishDeclaration(publish: boolean, changed: boolean, state: string): boolean {
  if (publish == false) {
    return false;
  }

  if (changed) {
    return true;
  }

  return state != 'PUBLISHED';
}

async function applyWrite(
  plannedAction: PlannedAction,
  write: () => Promise<void>,
): Promise<boolean> {
  try {
    await write();
    plannedAction.status = 'applied';
    return true;
  } catch (writeFailure) {
    plannedAction.status = 'failed';
    plannedAction.error = errorMessage(writeFailure);
    return false;
  }
}

/** Create a draft declaration for a family with no declaration yet, then publish it when requested. */
async function createDeclaration(
  reconcileContext: ReconcileContext,
  api: AscAccessibilityApi,
  appId: string,
  deviceFamily: DeviceFamily,
  desired: AccessibilitySupport,
  publish: boolean,
): Promise<void> {
  const create = plan(reconcileContext, `create accessibility declaration (${deviceFamily})`);
  let publishAction: PlannedAction | null = null;

  if (publish) {
    publishAction = plan(reconcileContext, `publish accessibility declaration (${deviceFamily})`);
  }

  const isDryRun = reconcileContext.dryRun == true;

  if (isDryRun) {
    return;
  }

  let createdId: string | null = null;

  try {
    const created = await api.createAccessibilityDeclaration(appId, deviceFamily, desired);
    create.status = 'applied';
    createdId = created.id;
  } catch (writeFailure) {
    create.status = 'failed';
    create.error = errorMessage(writeFailure);

    const plannedPublish = publishAction;

    const hasPublishAction = plannedPublish != null;

    if (hasPublishAction) {
      plannedPublish.status = 'skipped';
    }

    return;
  }

  const plannedPublish = publishAction;
  const hasPublishAction = plannedPublish != null;

  if (hasPublishAction == false) {
    return;
  }

  const isCreated = createdId != null;

  if (isCreated == false) {
    return;
  }

  const declarationId = createdId;

  await applyWrite(plannedPublish, function publishDeclaration() {
    return api.updateAccessibilityDeclaration(declarationId, { publish: true });
  });
}

/** Update an existing declaration when its flags differ and/or it needs publishing. */
async function updateDeclaration(
  reconcileContext: ReconcileContext,
  api: AscAccessibilityApi,
  current: AccessibilityDeclarationResource,
  desired: AccessibilitySupport,
  publish: boolean,
): Promise<void> {
  const changed = supportEquals(current.support, desired) == false;
  const shouldPublish = shouldPublishDeclaration(publish, changed, current.state);

  const isCurrent = changed == false;

  if (isCurrent) {
    const staysUnpublished = shouldPublish == false;

    if (staysUnpublished) {
      return;
    }
  }

  let actionDescription = `publish accessibility declaration (${current.deviceFamily})`;

  if (changed) {
    actionDescription = `update accessibility declaration (${current.deviceFamily})`;

    if (shouldPublish) {
      actionDescription = `${actionDescription} + publish`;
    }
  }

  const action = plan(reconcileContext, actionDescription);

  const isDryRun = reconcileContext.dryRun == true;

  if (isDryRun) {
    return;
  }

  const changes: AccessibilitySupport & { publish?: boolean } = {};

  if (changed) {
    Object.assign(changes, desired);
  }

  if (shouldPublish) {
    changes.publish = true;
  }

  await applyWrite(action, function updateAccessibility() {
    return api.updateAccessibilityDeclaration(current.id, changes);
  });
}

/** Reconcile one app's accessibility declarations. */
export async function reconcileAccessibility(
  api: AscAccessibilityApi,
  reconcileInput: AccessibilityReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun: reconcileInput.dryRun };
  const publish = reconcileInput.config.publish == true;
  const appId = await api.getAppId(reconcileInput.bundleId);

  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw appRecordMissing(reconcileInput.bundleId, 'accessibility');
  }

  const declarations = await api.listAccessibilityDeclarations(appId);
  const byFamily = indexEditableByFamily(declarations);

  for (const declared of reconcileInput.config.declarations) {
    const desired = normalizeSupport(declared);
    const current = byFamily.get(declared.deviceFamily);

    const hasCurrent = current != null;

    if (hasCurrent) {
      await updateDeclaration(reconcileContext, api, current, desired, publish);
      continue;
    }

    await createDeclaration(reconcileContext, api, appId, declared.deviceFamily, desired, publish);
  }

  return { bundleId: reconcileInput.bundleId, actions: reconcileContext.actions };
}

/** Decode an accessibility section from launch.config.ts. */
export function parseAccessibilityConfig(rawDocument: unknown): AccessibilityConfig {
  return decodeStoreSurfaceConfig(rawDocument, accessibilityConfigSpec);
}

/** Tally a report's action statuses for the run summary. */
export function summarizeAccessibility(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of actions) {
    if (action.status == 'applied') {
      applied += 1;
      continue;
    }

    if (action.status == 'failed') {
      failed += 1;
      continue;
    }

    if (action.status == 'skipped') {
      skipped += 1;
    }
  }

  return { applied, failed, skipped };
}
