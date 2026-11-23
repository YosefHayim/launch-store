// Reads and writes accessibility nutrition labels for an app on App Store Connect.

import type { AccessibilityDeclarationAttributes } from './shared.ts';
import type {
  AccessibilityDeclarationResource,
  AccessibilitySupport,
  DeviceFamily,
} from '../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import { pickAccessibilitySupport } from './shared.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectAccessibility {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of the accessibility declarations for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-accessibilitydeclarations
   */
  async listAccessibilityDeclarations(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AccessibilityDeclarationResource[]> {
    const declarations = await this.client.requestAll<AccessibilityDeclarationAttributes>(
      applyAppleListQuery(`/apps/${appId}/accessibilityDeclarations`, listQuery, APPLE_PAGE_LIMIT),
    );

    function readAccessibilityDeclaration(declaration: {
      id: string;
      attributes: AccessibilityDeclarationAttributes;
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const deviceFamily = declaration.attributes.deviceFamily;

      if (deviceFamily == null) return [];

      let state = declaration.attributes.state;

      if (state == null) state = 'DRAFT';

      return [
        {
          id: declaration.id,
          deviceFamily,
          state,
          support: pickAccessibilitySupport(declaration.attributes),
        },
      ];
    }

    return declarations.flatMap(readAccessibilityDeclaration);
  }

  /**
   * Add an accessibility declaration for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-accessibilitydeclarations
   */
  async createAccessibilityDeclaration(
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Promise<AccessibilityDeclarationResource> {
    const { data: appleResources } = await this.client.request<{
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

    if (declarationAttributes == null) declarationAttributes = {};

    let state = declarationAttributes.state;

    if (state == null) state = 'DRAFT';

    return {
      id: appleResources.id,
      deviceFamily,
      state,
      support: pickAccessibilitySupport(declarationAttributes),
    };
  }

  /**
   * Update the attributes of a specific accessibility declaration.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-accessibilitydeclarations-_id_
   */
  async updateAccessibilityDeclaration(
    declarationId: string,
    changes: AccessibilitySupport & {
      publish?: boolean;
    },
  ): Promise<void> {
    await this.client.updateResource(`/accessibilityDeclarations/${declarationId}`, {
      type: 'accessibilityDeclarations',
      id: declarationId,
      attributes: changes,
    });
  }
}
