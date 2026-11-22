import type { components } from '@/generated/apple/schema.js';
import { AppStoreToken } from '@/apple/app-store-token.js';

type AppList = components['schemas']['AppsResponse'];
type BuildUploadResponse = components['schemas']['BuildUploadResponse'];
type BuildUploadCreateRequest = components['schemas']['BuildUploadCreateRequest'];

interface AppleResource {
  id?: string;
  attributes?: {
    name?: string;
    productId?: string;
    versionString?: string;
    bundleId?: string;
  };
}

interface ApplePage {
  data?: readonly AppleResource[];
}

interface BuildUploadRequest {
  appId: string;
  version: string;
  buildNumber: number;
}

export class AppStoreConnect {
  constructor(private readonly token = new AppStoreToken()) {}

  /**
   * Lists the apps this key can see.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps
   */
  async listApps(): Promise<AppList> {
    const page = await this.send('GET', '/v1/apps', null);

    return page as AppList;
  }

  /**
   * Opens a build upload for one version of an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builduploads
   */
  async createBuildUpload(buildUpload: BuildUploadRequest): Promise<string> {
    const requestDocument: BuildUploadCreateRequest = {
      data: {
        type: 'buildUploads',
        attributes: {
          cfBundleShortVersionString: buildUpload.version,
          cfBundleVersion: String(buildUpload.buildNumber),
          platform: 'IOS',
        },
        relationships: {
          app: { data: { type: 'apps', id: buildUpload.appId } },
        },
      },
    };
    const created = (await this.send(
      'POST',
      '/v1/buildUploads',
      requestDocument,
    )) as BuildUploadResponse;
    const uploadId = created.data.id;
    const isMissing = uploadId == null;

    if (isMissing) {
      throw new Error('App Store Connect did not return a build upload id');
    }

    return uploadId;
  }

  /**
   * Lists App Store versions for one app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions
   */
  async listVersions(appId: string): Promise<readonly string[]> {
    const page = await this.readPage(`/v1/apps/${appId}/appStoreVersions`);

    return namesFrom(page, 'versionString');
  }

  /**
   * Lists in-app purchases for one app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchasesv2
   */
  async listInAppPurchases(appId: string): Promise<readonly string[]> {
    const page = await this.readPage(`/v1/apps/${appId}/inAppPurchasesV2`);

    return namesFrom(page, 'productId');
  }

  /**
   * Lists the app info records that hold the privacy details.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos
   */
  async listAppInfo(appId: string): Promise<readonly string[]> {
    const page = await this.readPage(`/v1/apps/${appId}/appInfos`);

    return namesFrom(page, 'name');
  }

  async findAppId(bundleId: string): Promise<string | null> {
    const apps = await this.listApps();

    function isThisApp(app: AppList['data'][number]): boolean {
      return app.attributes?.bundleId == bundleId;
    }

    const app = apps.data.find(isThisApp);
    const isMissing = app == null;

    if (isMissing) {
      return null;
    }

    return app.id;
  }

  private async readPage(path: string): Promise<ApplePage> {
    const page = await this.send('GET', path, null);

    return page as ApplePage;
  }

  private async send(method: string, path: string, document: unknown): Promise<unknown> {
    const signedToken = await this.token.sign();
    const hasDocument = document != null;
    let requestInit: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${signedToken}` },
    };

    if (hasDocument) {
      requestInit = {
        method,
        headers: {
          Authorization: `Bearer ${signedToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(document),
      };
    }

    try {
      var appleReply = await fetch(`https://api.appstoreconnect.apple.com${path}`, requestInit);
    } catch (error) {
      throw new Error(`App Store Connect did not answer ${method} ${path}`, { cause: error });
    }

    const isRefused = appleReply.ok == false;

    if (isRefused) {
      throw new Error(`App Store Connect refused ${method} ${path}`, { cause: appleReply.status });
    }

    try {
      var appleDocument = await appleReply.json();
    } catch (error) {
      throw new Error('App Store Connect sent a page that is not JSON', { cause: error });
    }

    return appleDocument;
  }
}

function namesFrom(page: ApplePage, field: 'name' | 'productId' | 'versionString'): string[] {
  const rows = page.data;
  const isMissing = rows == null;

  if (isMissing) {
    return [];
  }

  const names: string[] = [];

  for (const row of rows) {
    const attributes = row.attributes;
    const isBlankAttributes = attributes == null;

    if (isBlankAttributes) {
      continue;
    }

    const name = attributes[field];
    const isBlank = name == null;

    if (isBlank) {
      continue;
    }

    names.push(name);
  }

  return names;
}
