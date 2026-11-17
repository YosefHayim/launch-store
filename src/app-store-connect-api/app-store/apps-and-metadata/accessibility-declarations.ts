// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-metadata
import type {
  AccessibilityDeclarationResource,
  AccessibilitySupport,
  DeviceFamily,
} from '@core/types/appleCatalog.js';
import { ACCESSIBILITY_SUPPORT_KEYS } from '@core/types/appleCatalog.js';
import type { MutableDeep } from '@core/types/mutable.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';

/** Apple's raw `accessibilityDeclarations` attribute bag - the support flags plus the family/state metadata. Internal to the read path. */
type AccessibilityDeclarationAttributes = AccessibilitySupport & {
  deviceFamily?: DeviceFamily;
  state?: AccessibilityDeclarationResource['state'];
};

/** Keep only the nine `supports*` booleans from a raw accessibility-declaration attribute bag (dropping `deviceFamily` / `state`). */
const pickAccessibilitySupport = (
  attributes: Partial<AccessibilitySupport>,
): AccessibilitySupport => {
  const support: MutableDeep<AccessibilitySupport> = {};
  for (const key of ACCESSIBILITY_SUPPORT_KEYS) {
    const fieldValue = attributes[key];
    if (typeof fieldValue === 'boolean') support[key] = fieldValue;
  }
  return support;
};

export const makeAccessibilityDeclarationsApi = (api: AppStoreConnectRequests) => {
  /**
   * List an app's accessibility declarations - at most one live (`DRAFT`/`PUBLISHED`) per device family,
   * plus any `REPLACED` history a prior publish left behind. Returns [] when the app has none yet. Rows
   * Apple returns without a `deviceFamily` are dropped, since the family is the reconcile key.
   */
  const listAccessibilityDeclarations = async (
    appId: string,
  ): Promise<AccessibilityDeclarationResource[]> => {
    const declarations = await api.requestAll<AccessibilityDeclarationAttributes>(
      `/apps/${appId}/accessibilityDeclarations?limit=200`,
    );
    return declarations.flatMap((declaration) => {
      const deviceFamily = declaration.attributes.deviceFamily;
      if (deviceFamily === undefined) return [];
      let state = declaration.attributes.state;
      if (state === undefined) state = 'DRAFT';
      return [
        {
          id: declaration.id,
          deviceFamily,
          state,
          support: pickAccessibilitySupport(declaration.attributes),
        },
      ];
    });
  };

  /** Create a `DRAFT` accessibility declaration for one device family with the given support flags. */
  const createAccessibilityDeclaration = async (
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Promise<AccessibilityDeclarationResource> => {
    const { data: appleResources } = await api.request<{
      data: {
        id: string;
        attributes?: AccessibilityDeclarationAttributes;
      };
    }>('POST', '/accessibilityDeclarations', {
      data: {
        type: 'accessibilityDeclarations',
        attributes: { deviceFamily, ...support },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    });
    let declarationAttributes = appleResources.attributes;
    if (declarationAttributes === undefined) declarationAttributes = {};
    let state = declarationAttributes.state;
    if (state === undefined) state = 'DRAFT';
    return {
      id: appleResources.id,
      deviceFamily,
      state,
      support: pickAccessibilitySupport(declarationAttributes),
    };
  };

  /**
   * Update an accessibility declaration's support flags and/or publish it. `publish: true` moves a `DRAFT`
   * live; only the supplied keys change. Apple keeps the publish flag separate from the support booleans,
   * so a caller can publish an unchanged draft by passing `{ publish: true }` alone.
   */
  const updateAccessibilityDeclaration = async (
    declarationId: string,
    changes: AccessibilitySupport & {
      publish?: boolean;
    },
  ): Promise<void> => {
    await api.updateResource(`/accessibilityDeclarations/${declarationId}`, {
      type: 'accessibilityDeclarations',
      id: declarationId,
      attributes: changes,
    });
  };

  return {
    listAccessibilityDeclarations,
    createAccessibilityDeclaration,
    updateAccessibilityDeclaration,
  };
};
