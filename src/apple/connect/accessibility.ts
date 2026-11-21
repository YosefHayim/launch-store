import type { AccessibilityDeclarationAttributes } from './shared.js';
import type {
  AccessibilityDeclarationResource,
  AccessibilitySupport,
  DeviceFamily,
} from '@/types/appleCatalog.js';
import type { AscHost } from './host.js';
import { pickAccessibilitySupport } from './shared.js';

export class ConnectAccessibility {
  constructor(private readonly client: AscHost) {}

  async listAccessibilityDeclarations(appId: string): Promise<AccessibilityDeclarationResource[]> {
    const declarations = await this.client.requestAll<AccessibilityDeclarationAttributes>(
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
  }

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
    if (declarationAttributes === undefined) declarationAttributes = {};
    let state = declarationAttributes.state;
    if (state === undefined) state = 'DRAFT';
    return {
      id: appleResources.id,
      deviceFamily,
      state,
      support: pickAccessibilitySupport(declarationAttributes),
    };
  }

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
